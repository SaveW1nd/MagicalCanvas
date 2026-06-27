/**
 * routes/admin.js — admin-only management API (mounted at /api/admin).
 *
 * P3 (this increment): user management. Model registry + cross-user history
 * endpoints land in later increments under the same requireAdmin guard.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import crypto from 'crypto';
import {
    listUsers, getUserById, getUserByUsername, createUser, updateUser, deleteUser,
    countActiveAdmins, publicUser,
} from '../db/index.js';

const DEFAULT_PASSWORD = '12345678';
import { hashPassword } from '../auth/passwords.js';
import { libUrlToPath } from '../utils/imageHelpers.js';
import { requireAdmin } from '../auth/middleware.js';
import {
    listProviders, getProvider, createProvider, updateProvider, deleteProvider,
    countModelsForProvider, publicProvider,
    listModels, getModel, createModel, updateModel, deleteModel,
    CATEGORIES, PROVIDER_KINDS,
} from '../db/registry.js';

const router = express.Router();
router.use(requireAdmin);

// --- Users ---
router.get('/users', (_req, res) => {
    res.json({ users: listUsers() });
});

router.post('/users', (req, res) => {
    const { username, password, role } = req.body || {};
    if (!username || !String(username).trim()) return res.status(400).json({ error: '请输入用户名' });
    // 密码留空 → 用默认密码 12345678；若填了则至少 8 位
    if (password && String(password).length < 8) return res.status(400).json({ error: '密码至少 8 位' });
    const pw = password && String(password) ? String(password) : DEFAULT_PASSWORD;
    if (getUserByUsername(username)) return res.status(409).json({ error: '该用户名已存在' });
    const u = createUser({
        username: String(username).trim(),
        passwordHash: hashPassword(pw),
        role: role === 'admin' ? 'admin' : 'user',
    });
    res.status(201).json({ user: publicUser(u), defaultPassword: password ? undefined : DEFAULT_PASSWORD });
});

router.put('/users/:id', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { username, role, status } = req.body || {};
    const fields = {};
    if (username !== undefined) fields.username = String(username).slice(0, 40);
    if (role !== undefined) fields.role = role === 'admin' ? 'admin' : 'user';
    if (status !== undefined) fields.status = status === 'disabled' ? 'disabled' : 'active';
    // 防止移除最后一个在用管理员（降级或禁用）
    const removesAdmin =
        (fields.role && fields.role !== 'admin' && u.role === 'admin') ||
        (fields.status === 'disabled' && u.role === 'admin' && u.status === 'active');
    if (removesAdmin && countActiveAdmins() <= 1) {
        return res.status(400).json({ error: '不能移除最后一个管理员' });
    }
    res.json({ user: publicUser(updateUser(req.params.id, fields)) });
});

router.post('/users/:id/reset-password', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    const { newPassword } = req.body || {};
    if (newPassword && String(newPassword).length < 8) return res.status(400).json({ error: '新密码至少 8 位' });
    const pw = newPassword && String(newPassword) ? String(newPassword) : DEFAULT_PASSWORD;
    updateUser(req.params.id, { passwordHash: hashPassword(pw) });
    res.json({ success: true, defaultPassword: newPassword ? undefined : DEFAULT_PASSWORD });
});

router.delete('/users/:id', (req, res) => {
    const u = getUserById(req.params.id);
    if (!u) return res.status(404).json({ error: '用户不存在' });
    if (req.user.id === req.params.id) return res.status(400).json({ error: '不能删除自己' });
    if (u.role === 'admin' && countActiveAdmins() <= 1) return res.status(400).json({ error: '不能删除最后一个管理员' });
    deleteUser(req.params.id);
    res.json({ success: true });
});

// ===========================================================================
// MODEL REGISTRY (P2) — providers + models
// ===========================================================================

// --- Providers ---
router.get('/providers', (_req, res) => {
    res.json({ providers: listProviders().map(publicProvider) });
});

router.post('/providers', (req, res) => {
    const { name, kind, baseUrl, apiKey } = req.body || {};
    if (!name || !String(name).trim()) return res.status(400).json({ error: '请输入名称' });
    if (kind && !PROVIDER_KINDS.includes(kind)) return res.status(400).json({ error: '未知类型' });
    const p = createProvider({ name, kind, baseUrl, apiKey });
    res.status(201).json({ provider: publicProvider(p) });
});

router.put('/providers/:id', (req, res) => {
    if (!getProvider(req.params.id)) return res.status(404).json({ error: '接入点不存在' });
    const { name, kind, baseUrl, apiKey } = req.body || {};
    const fields = {};
    if (name !== undefined) fields.name = name;
    if (kind !== undefined) fields.kind = kind;
    if (baseUrl !== undefined) fields.baseUrl = baseUrl;
    // apiKey 留空字符串表示「不修改」，避免误清空；要清空需显式传 null
    if (apiKey !== undefined && apiKey !== '') fields.apiKey = apiKey;
    if (apiKey === null) fields.apiKey = '';
    res.json({ provider: publicProvider(updateProvider(req.params.id, fields)) });
});

router.delete('/providers/:id', (req, res) => {
    if (!getProvider(req.params.id)) return res.status(404).json({ error: '接入点不存在' });
    const n = countModelsForProvider(req.params.id);
    if (n > 0) return res.status(400).json({ error: `该接入点下还有 ${n} 个模型，请先删除或改绑这些模型` });
    deleteProvider(req.params.id);
    res.json({ success: true });
});

// 测试连通：用接入点的 baseUrl+apiKey 调 GET {baseUrl}/models（不消耗额度）。
router.post('/providers/:id/test', async (req, res) => {
    const p = getProvider(req.params.id);
    if (!p) return res.status(404).json({ error: '接入点不存在' });
    const url = (p.baseUrl || '').replace(/\/+$/, '');
    if (!url) return res.status(400).json({ success: false, error: '未配置 baseUrl' });
    if (!p.apiKey) return res.status(400).json({ success: false, error: '未配置 apiKey' });
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let r;
        try {
            r = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${p.apiKey}` }, signal: ctrl.signal });
        } finally { clearTimeout(timer); }
        if (!r.ok) {
            const txt = await r.text().catch(() => '');
            return res.json({ success: false, error: `HTTP ${r.status}: ${txt.slice(0, 200)}` });
        }
        const data = await r.json().catch(() => ({}));
        const ids = Array.isArray(data?.data) ? data.data.map(m => m.id).filter(Boolean) : [];
        res.json({ success: true, modelCount: ids.length, message: `连接成功，上游可见 ${ids.length} 个模型` });
    } catch (e) {
        res.json({ success: false, error: e.name === 'AbortError' ? '请求超时' : e.message });
    }
});

// 拉取上游模型列表（供管理员从中挑选添加）。
router.get('/providers/:id/upstream-models', async (req, res) => {
    const p = getProvider(req.params.id);
    if (!p) return res.status(404).json({ error: '接入点不存在' });
    const url = (p.baseUrl || '').replace(/\/+$/, '');
    if (!url || !p.apiKey) return res.status(400).json({ error: '该接入点未配置 baseUrl / apiKey' });
    try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 15000);
        let r;
        try {
            r = await fetch(`${url}/models`, { headers: { Authorization: `Bearer ${p.apiKey}` }, signal: ctrl.signal });
        } finally { clearTimeout(timer); }
        if (!r.ok) {
            const txt = await r.text().catch(() => '');
            return res.status(502).json({ error: `上游返回 HTTP ${r.status}: ${txt.slice(0, 200)}` });
        }
        const data = await r.json().catch(() => ({}));
        const ids = Array.isArray(data?.data) ? data.data.map(m => m.id).filter(Boolean) : [];
        res.json({ models: ids });
    } catch (e) {
        res.status(502).json({ error: e.name === 'AbortError' ? '请求超时' : e.message });
    }
});

// --- Models ---
router.get('/models', (_req, res) => {
    res.json({ models: listModels(), providers: listProviders().map(publicProvider) });
});

router.post('/models', (req, res) => {
    const { modelId, label, category, providerId, enabled, isDefault, capabilities, sortOrder } = req.body || {};
    if (!modelId || !String(modelId).trim()) return res.status(400).json({ error: '请输入模型 ID' });
    if (!CATEGORIES.includes(category)) return res.status(400).json({ error: '未知类别' });
    if (!getProvider(providerId)) return res.status(400).json({ error: '请选择有效的接入点' });
    const m = createModel({ modelId, label, category, providerId, enabled, isDefault, capabilities, sortOrder });
    res.status(201).json({ model: m });
});

router.put('/models/:id', (req, res) => {
    if (!getModel(req.params.id)) return res.status(404).json({ error: '模型不存在' });
    const { category, providerId } = req.body || {};
    if (category !== undefined && !CATEGORIES.includes(category)) return res.status(400).json({ error: '未知类别' });
    if (providerId !== undefined && !getProvider(providerId)) return res.status(400).json({ error: '请选择有效的接入点' });
    const m = updateModel(req.params.id, req.body || {});
    res.json({ model: m });
});

router.delete('/models/:id', (req, res) => {
    if (!getModel(req.params.id)) return res.status(404).json({ error: '模型不存在' });
    deleteModel(req.params.id);
    res.json({ success: true });
});

// --- 全部历史（P3）：跨用户浏览生成历史/画布/对话/剪辑 ---
// 数据是文件型(library/{type}/*.json)，每条带 ownerId。只读浏览 + 按用户/类型/关键词筛选。
const HISTORY_TYPES = {
    images: '图片',
    videos: '视频',
    chats: '对话',
    workflows: '画布',
    'edit-projects': '剪辑',
};

function readDirJson(dir) {
    if (!fs.existsSync(dir)) return [];
    const out = [];
    for (const f of fs.readdirSync(dir)) {
        if (!f.endsWith('.json')) continue;
        try { out.push(JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'))); }
        catch { /* 跳过损坏文件 */ }
    }
    return out;
}

function normalizeHistory(type, d) {
    const base = {
        id: d.id,
        type,
        ownerId: d.ownerId || null,
        createdAt: d.createdAt || d.updatedAt || null,
        updatedAt: d.updatedAt || d.createdAt || null,
    };
    if (type === 'images' || type === 'videos') {
        return {
            ...base,
            title: d.title || d.prompt || '(无标题)',
            prompt: d.prompt || '',
            model: d.model || '',
            url: d.url || (d.filename ? `/library/${type}/${d.filename}` : null),
            extra: [d.aspectRatio, d.resolution].filter(Boolean).join(' · '),
        };
    }
    if (type === 'chats') {
        return { ...base, title: d.topic || '(未命名对话)', count: Array.isArray(d.messages) ? d.messages.length : 0 };
    }
    if (type === 'workflows') {
        const nodes = d.nodes;
        const count = Array.isArray(nodes) ? nodes.length : (nodes && typeof nodes === 'object' ? Object.keys(nodes).length : 0);
        return { ...base, title: d.title || '未命名', cover: d.coverUrl || null, count };
    }
    if (type === 'edit-projects') {
        return { ...base, title: d.name || d.title || '未命名剪辑' };
    }
    return base;
}

router.get('/history', (req, res) => {
    try {
        const LIBRARY_DIR = req.app.locals.LIBRARY_DIR;
        if (!LIBRARY_DIR) return res.status(500).json({ error: '资源目录未配置' });

        const wantType = HISTORY_TYPES[req.query.type] ? String(req.query.type) : null;
        const userId = req.query.userId ? String(req.query.userId) : null;
        const q = String(req.query.q || '').trim().toLowerCase();
        const limit = Math.min(Math.max(parseInt(req.query.limit) || 60, 1), 500);
        const offset = Math.max(parseInt(req.query.offset) || 0, 0);

        const users = listUsers();
        const nameById = new Map(users.map(u => [u.id, u.username]));

        const types = wantType ? [wantType] : Object.keys(HISTORY_TYPES);
        let items = [];
        for (const t of types) {
            for (const d of readDirJson(path.join(LIBRARY_DIR, t))) {
                const it = normalizeHistory(t, d);
                it.ownerName = it.ownerId ? (nameById.get(it.ownerId) || '(已删除用户)') : '(无归属)';
                items.push(it);
            }
        }

        // 每种类型的总量（不受当前筛选影响，给前端做概览徽标）
        const typeCounts = {};
        for (const it of items) typeCounts[it.type] = (typeCounts[it.type] || 0) + 1;

        if (userId) items = items.filter(it => it.ownerId === userId);
        if (q) items = items.filter(it =>
            (it.title || '').toLowerCase().includes(q) ||
            (it.prompt || '').toLowerCase().includes(q) ||
            (it.ownerName || '').toLowerCase().includes(q));

        items.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());

        const total = items.length;
        const page = items.slice(offset, offset + limit);
        res.json({ items: page, total, hasMore: offset + limit < total, users, typeCounts });
    } catch (e) {
        console.error('admin history error:', e);
        res.status(500).json({ error: e.message });
    }
});

// --- 管理员·素材库管理(计划 4) ---
function assetsJsonPath(req) { return path.join(req.app.locals.LIBRARY_DIR, 'assets', 'assets.json'); }
function readAssets(req) {
    const p = assetsJsonPath(req);
    if (!fs.existsSync(p)) return [];
    try { return JSON.parse(fs.readFileSync(p, 'utf8')); } catch { return []; }
}
function writeAssets(req, rows) { fs.writeFileSync(assetsJsonPath(req), JSON.stringify(rows, null, 2)); }

// 全表素材 + ownerName,支持按用户/可见性/分类/关键词筛选
router.get('/assets', (req, res) => {
    try {
        const users = listUsers();
        const nameById = new Map(users.map(u => [u.id, u.username]));
        let rows = readAssets(req).map(a => ({ ...a, ownerName: a.ownerId ? (nameById.get(a.ownerId) || '(已删除用户)') : '(无归属)' }));
        const categories = Array.from(new Set(rows.map(a => a.category).filter(Boolean)));
        const { userId, visibility, category } = req.query;
        const q = String(req.query.q || '').trim().toLowerCase();
        if (userId) rows = rows.filter(a => a.ownerId === userId);
        if (visibility) rows = rows.filter(a => (a.visibility || 'private') === visibility);
        if (category) rows = rows.filter(a => a.category === category);
        if (q) rows = rows.filter(a => (a.name || '').toLowerCase().includes(q) || (a.ownerName || '').toLowerCase().includes(q));
        rows.sort((a, b) => new Date(b.createdAt || 0).getTime() - new Date(a.createdAt || 0).getTime());
        res.json({ assets: rows, total: rows.length, users, categories });
    } catch (e) {
        console.error('admin assets list error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 强制设置可见性(公开/下架任意素材)
router.post('/assets/:id/visibility', (req, res) => {
    try {
        const visibility = req.body?.visibility === 'public' ? 'public' : 'private';
        const rows = readAssets(req);
        const asset = rows.find(a => a.id === req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });
        asset.visibility = visibility;
        if (visibility === 'public') { asset.publishedAt = asset.publishedAt || new Date().toISOString(); asset.publishedBy = asset.publishedBy || asset.ownerId; }
        writeAssets(req, rows);
        res.json({ success: true, asset });
    } catch (e) {
        console.error('admin set visibility error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 管理员删除素材(物理文件经引用护栏:被他人/公开引用则只删行)
router.delete('/assets/:id', (req, res) => {
    try {
        const rows = readAssets(req);
        const idx = rows.findIndex(a => a.id === req.params.id);
        if (idx === -1) return res.status(404).json({ error: 'Asset not found' });
        const asset = rows[idx];
        rows.splice(idx, 1);
        const isUploaded = typeof asset.url === 'string' && asset.url.includes('/assets/');
        const referencedElsewhere = rows.some(a => a.url === asset.url);
        if (!asset.sourceAssetId && isUploaded && !referencedElsewhere) {
            const fp = libUrlToPath(req.app.locals.LIBRARY_DIR, asset.url);
            if (fp && fs.existsSync(fp)) { try { fs.unlinkSync(fp); } catch { /* ignore */ } }
        }
        writeAssets(req, rows);
        res.json({ success: true });
    } catch (e) {
        console.error('admin delete asset error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 从「全部历史」把一张生成图/视频发布到公共素材库(引用模型,零拷贝;幂等)
router.post('/assets/publish', (req, res) => {
    try {
        const { type, id } = req.body || {};
        if (!['images', 'videos'].includes(type) || !id) return res.status(400).json({ error: '参数错误' });
        const LIBRARY_DIR = req.app.locals.LIBRARY_DIR;
        const metaPath = path.join(LIBRARY_DIR, type, `${id}.json`);
        if (!fs.existsSync(metaPath)) return res.status(404).json({ error: '历史素材不存在' });
        const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
        const url = meta.url || `/library/${type}/${meta.filename}`;
        const rows = readAssets(req);
        // 幂等:已有指向同一文件的素材行 → 直接置为 public
        let row = rows.find(a => a.url === url);
        if (row) {
            row.visibility = 'public';
            row.publishedAt = row.publishedAt || new Date().toISOString();
            row.publishedBy = row.publishedBy || req.user.id;
        } else {
            row = {
                id: crypto.randomUUID(),
                ownerId: meta.ownerId || null,
                name: meta.title || meta.prompt || '未命名',
                category: 'Others',
                url,
                type: type === 'videos' ? 'video' : 'image',
                visibility: 'public',
                sourceAssetId: null,
                publishedBy: req.user.id,
                publishedAt: new Date().toISOString(),
                createdAt: new Date().toISOString(),
            };
            rows.push(row);
        }
        writeAssets(req, rows);
        res.json({ success: true, asset: row });
    } catch (e) {
        console.error('admin publish media error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 列用户发布的公共工作流 + ownerName
router.get('/public-workflows', (req, res) => {
    try {
        const dir = path.join(req.app.locals.LIBRARY_DIR, 'public-workflows');
        if (!fs.existsSync(dir)) return res.json({ workflows: [] });
        const nameById = new Map(listUsers().map(u => [u.id, u.username]));
        const workflows = [];
        for (const f of fs.readdirSync(dir).filter(x => x.endsWith('.json'))) {
            try {
                const w = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                workflows.push({
                    id: f.replace('.json', ''), title: w.title || '未命名',
                    nodeCount: w.nodes?.length || 0, coverUrl: w.coverUrl || null,
                    publishedBy: w.publishedBy || null, publishedByName: w.publishedBy ? (nameById.get(w.publishedBy) || '(已删除用户)') : '(未知)',
                    publishedAt: w.publishedAt || null,
                });
            } catch { /* skip */ }
        }
        workflows.sort((a, b) => (b.publishedAt || '').localeCompare(a.publishedAt || ''));
        res.json({ workflows });
    } catch (e) {
        console.error('admin public-workflows list error:', e);
        res.status(500).json({ error: e.message });
    }
});

// 删除某公共工作流 + 其 assets 目录
router.delete('/public-workflows/:id', (req, res) => {
    try {
        const dir = path.join(req.app.locals.LIBRARY_DIR, 'public-workflows');
        const fp = path.join(dir, `${req.params.id}.json`);
        if (!fs.existsSync(fp)) return res.status(404).json({ error: '公共工作流不存在' });
        fs.unlinkSync(fp);
        const assetsDir = path.join(dir, 'assets', req.params.id);
        if (fs.existsSync(assetsDir)) fs.rmSync(assetsDir, { recursive: true, force: true });
        res.json({ success: true });
    } catch (e) {
        console.error('admin delete public-workflow error:', e);
        res.status(500).json({ error: e.message });
    }
});

export default router;
