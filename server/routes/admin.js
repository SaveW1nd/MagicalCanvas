/**
 * routes/admin.js — admin-only management API (mounted at /api/admin).
 *
 * P3 (this increment): user management. Model registry + cross-user history
 * endpoints land in later increments under the same requireAdmin guard.
 */
import express from 'express';
import fs from 'fs';
import path from 'path';
import {
    listUsers, getUserById, getUserByUsername, createUser, updateUser, deleteUser,
    countActiveAdmins, publicUser,
} from '../db/index.js';

const DEFAULT_PASSWORD = '12345678';
import { hashPassword } from '../auth/passwords.js';
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

export default router;
