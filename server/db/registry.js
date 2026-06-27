/**
 * db/registry.js
 *
 * Dynamic model registry (P2). Two levels:
 *   providers — an upstream endpoint: { kind, baseUrl, apiKey }. The unit you
 *               fetch an upstream model list from and configure credentials on.
 *   models    — a selectable model: { modelId(wire id), label, category,
 *               providerId, enabled, isDefault, capabilities(JSON) }.
 *
 * Generation resolves a model -> its provider -> baseUrl/apiKey. The canvas
 * loads enabled models (sanitized, no keys) from /api/models. Admins manage
 * both via /api/admin/providers and /api/admin/models.
 *
 * Seeded once from the legacy per-category config (IMAGE/VIDEO -> fp,
 * TEXT -> DeepSeek, VISION -> MiMo) so an existing install keeps working.
 */

import crypto from 'crypto';
import { db } from './index.js';
import { getKey } from '../config.js';

export const CATEGORIES = ['image', 'video', 'text', 'vision', 'asr'];
export const PROVIDER_KINDS = ['fp', 'openai']; // fp = Flow gateway, openai = OpenAI-compatible

// ---------------------------------------------------------------------------
// Schema (idempotent)
// ---------------------------------------------------------------------------
db.exec(`
    CREATE TABLE IF NOT EXISTS providers (
        id        TEXT PRIMARY KEY,
        name      TEXT NOT NULL,
        kind      TEXT NOT NULL DEFAULT 'openai',
        baseUrl   TEXT NOT NULL DEFAULT '',
        apiKey    TEXT NOT NULL DEFAULT '',
        createdAt TEXT NOT NULL,
        updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS models (
        id           TEXT PRIMARY KEY,
        modelId      TEXT NOT NULL,
        label        TEXT NOT NULL,
        category     TEXT NOT NULL,
        providerId   TEXT NOT NULL REFERENCES providers(id) ON DELETE CASCADE,
        enabled      INTEGER NOT NULL DEFAULT 1,
        isDefault    INTEGER NOT NULL DEFAULT 0,
        capabilities TEXT NOT NULL DEFAULT '{}',
        sortOrder    INTEGER NOT NULL DEFAULT 0,
        createdAt    TEXT NOT NULL,
        updatedAt    TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_models_category ON models(category);
    CREATE INDEX IF NOT EXISTS idx_models_provider ON models(providerId);
`);

// ---------------------------------------------------------------------------
// Row mappers
// ---------------------------------------------------------------------------
function rowToModel(r) {
    if (!r) return null;
    let caps = {};
    try { caps = JSON.parse(r.capabilities || '{}'); } catch { caps = {}; }
    return {
        id: r.id,
        modelId: r.modelId,
        label: r.label,
        category: r.category,
        providerId: r.providerId,
        enabled: !!r.enabled,
        isDefault: !!r.isDefault,
        capabilities: caps,
        sortOrder: r.sortOrder,
        createdAt: r.createdAt,
        updatedAt: r.updatedAt,
    };
}

/** Strip the apiKey before sending a provider to any non-admin caller. */
export function publicProvider(p) {
    if (!p) return null;
    const { apiKey, ...rest } = p;
    return { ...rest, hasKey: !!apiKey };
}

// ---------------------------------------------------------------------------
// providers repo
// ---------------------------------------------------------------------------
const _insProvider = db.prepare(`
    INSERT INTO providers(id, name, kind, baseUrl, apiKey, createdAt, updatedAt)
    VALUES(@id, @name, @kind, @baseUrl, @apiKey, @createdAt, @updatedAt)
`);
const _allProviders = db.prepare('SELECT * FROM providers ORDER BY createdAt ASC');
const _providerById = db.prepare('SELECT * FROM providers WHERE id = ?');

export function listProviders() { return _allProviders.all(); }
export function getProvider(id) { return _providerById.get(id); }

export function createProvider({ name, kind = 'openai', baseUrl = '', apiKey = '' }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    _insProvider.run({ id, name: String(name || '').trim() || 'Provider', kind: PROVIDER_KINDS.includes(kind) ? kind : 'openai', baseUrl: String(baseUrl || '').trim(), apiKey: String(apiKey || '').trim(), createdAt: now, updatedAt: now });
    return getProvider(id);
}

export function updateProvider(id, fields) {
    const allowed = ['name', 'kind', 'baseUrl', 'apiKey'];
    const sets = [];
    const vals = { id };
    for (const k of allowed) {
        if (k in fields && fields[k] !== undefined) {
            if (k === 'kind' && !PROVIDER_KINDS.includes(fields[k])) continue;
            sets.push(`${k} = @${k}`);
            vals[k] = String(fields[k] ?? '').trim();
        }
    }
    if (!sets.length) return getProvider(id);
    vals.updatedAt = new Date().toISOString();
    db.prepare(`UPDATE providers SET ${sets.join(', ')}, updatedAt = @updatedAt WHERE id = @id`).run(vals);
    return getProvider(id);
}

export function deleteProvider(id) { db.prepare('DELETE FROM providers WHERE id = ?').run(id); }
export function countModelsForProvider(id) { return db.prepare('SELECT COUNT(*) AS n FROM models WHERE providerId = ?').get(id).n; }

// ---------------------------------------------------------------------------
// models repo
// ---------------------------------------------------------------------------
const _insModel = db.prepare(`
    INSERT INTO models(id, modelId, label, category, providerId, enabled, isDefault, capabilities, sortOrder, createdAt, updatedAt)
    VALUES(@id, @modelId, @label, @category, @providerId, @enabled, @isDefault, @capabilities, @sortOrder, @createdAt, @updatedAt)
`);
const _allModels = db.prepare('SELECT * FROM models ORDER BY category ASC, sortOrder ASC, createdAt ASC');
const _modelsByCategory = db.prepare('SELECT * FROM models WHERE category = ? ORDER BY sortOrder ASC, createdAt ASC');
const _modelById = db.prepare('SELECT * FROM models WHERE id = ?');
const _clearDefault = db.prepare('UPDATE models SET isDefault = 0, updatedAt = ? WHERE category = ? AND id != ?');

export function listModels() { return _allModels.all().map(rowToModel); }
export function listModelsByCategory(cat) { return _modelsByCategory.all(cat).map(rowToModel); }
export function getModel(id) { return rowToModel(_modelById.get(id)); }

export function createModel({ modelId, label, category, providerId, enabled = true, isDefault = false, capabilities = {}, sortOrder = 0 }) {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    _insModel.run({
        id,
        modelId: String(modelId || '').trim(),
        label: String(label || modelId || '').trim(),
        category,
        providerId,
        enabled: enabled ? 1 : 0,
        isDefault: isDefault ? 1 : 0,
        capabilities: JSON.stringify(capabilities || {}),
        sortOrder: Number(sortOrder) || 0,
        createdAt: now,
        updatedAt: now,
    });
    if (isDefault) _clearDefault.run(now, category, id);
    return getModel(id);
}

export function updateModel(id, fields) {
    const existing = _modelById.get(id);
    if (!existing) return null;
    const allowed = ['modelId', 'label', 'category', 'providerId', 'enabled', 'isDefault', 'sortOrder'];
    const sets = [];
    const vals = { id };
    for (const k of allowed) {
        if (!(k in fields) || fields[k] === undefined) continue;
        if (k === 'enabled' || k === 'isDefault') { sets.push(`${k} = @${k}`); vals[k] = fields[k] ? 1 : 0; }
        else if (k === 'sortOrder') { sets.push(`${k} = @${k}`); vals[k] = Number(fields[k]) || 0; }
        else { sets.push(`${k} = @${k}`); vals[k] = String(fields[k] ?? '').trim(); }
    }
    if ('capabilities' in fields && fields.capabilities !== undefined) {
        sets.push('capabilities = @capabilities');
        vals.capabilities = JSON.stringify(fields.capabilities || {});
    }
    if (!sets.length) return getModel(id);
    const now = new Date().toISOString();
    vals.updatedAt = now;
    db.prepare(`UPDATE models SET ${sets.join(', ')}, updatedAt = @updatedAt WHERE id = @id`).run(vals);
    // Enforce single default per category.
    const after = _modelById.get(id);
    if (after && after.isDefault) _clearDefault.run(now, after.category, id);
    return getModel(id);
}

export function deleteModel(id) { db.prepare('DELETE FROM models WHERE id = ?').run(id); }

/**
 * Resolve a model for generation: by wire modelId within a category, falling
 * back to the category default. Returns { model, provider } or null.
 */
export function resolveModel(category, modelId) {
    const rows = _modelsByCategory.all(category).map(rowToModel).filter(m => m.enabled);
    if (!rows.length) return null;
    let m = modelId ? rows.find(r => r.modelId === modelId) : null;
    if (!m) m = rows.find(r => r.isDefault) || rows[0];
    const provider = getProvider(m.providerId);
    if (!provider) return null;
    return { model: m, provider };
}

// ---------------------------------------------------------------------------
// Seed once from legacy per-category config.
// ---------------------------------------------------------------------------
const IMAGE_RATIOS = ['Auto', '1:1', '9:16', '16:9', '3:4', '4:3', '3:2', '2:3', '5:4', '4:5', '21:9'];
const IMAGE_RES = ['1K', '2K', '4K'];

export function seedRegistryFromConfig() {
    if (listProviders().length > 0) return false; // already seeded / managed

    const now = new Date().toISOString();
    const fp = createProvider({ name: 'Flow (fp)', kind: 'fp', baseUrl: getKey('IMAGE_API_URL'), apiKey: getKey('IMAGE_API_KEY') });
    const deepseek = createProvider({ name: 'DeepSeek', kind: 'openai', baseUrl: getKey('TEXT_API_URL'), apiKey: getKey('TEXT_API_KEY') });
    const mimo = createProvider({ name: 'MiMo (视觉)', kind: 'openai', baseUrl: getKey('VISION_API_URL'), apiKey: getKey('VISION_API_KEY') });

    const seed = [
        // image (fp)
        { modelId: 'nana-banana-pro', label: 'Nano Banana Pro', category: 'image', providerId: fp.id, isDefault: true, sortOrder: 0,
          capabilities: { recommended: true, supportsImageToImage: true, supportsMultiImage: true, resolutions: IMAGE_RES, aspectRatios: IMAGE_RATIOS } },
        { modelId: 'nana-banana-2', label: 'Nano Banana 2', category: 'image', providerId: fp.id, sortOrder: 1,
          capabilities: { supportsImageToImage: true, supportsMultiImage: true, resolutions: IMAGE_RES, aspectRatios: IMAGE_RATIOS } },
        // video (fp)
        { modelId: 'veo-omni-flash', label: 'Omni Flash', category: 'video', providerId: fp.id, isDefault: true, sortOrder: 0,
          capabilities: { recommended: true, supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLastFrame: false, durations: [4, 6, 8, 10], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] } },
        { modelId: 'veo-3-1-fast', label: 'VEO 3.1 Fast', category: 'video', providerId: fp.id, sortOrder: 1,
          capabilities: { supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLastFrame: true, durations: [8], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] } },
        { modelId: 'veo-3-1-lite', label: 'VEO 3.1 Lite', category: 'video', providerId: fp.id, sortOrder: 2,
          capabilities: { supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: true, supportsFirstLastFrame: true, durations: [8], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] } },
        { modelId: 'veo-3-1-quality', label: 'VEO 3.1 Quality', category: 'video', providerId: fp.id, sortOrder: 3,
          capabilities: { supportsTextToVideo: true, supportsImageToVideo: true, supportsMultiImage: false, supportsFirstLastFrame: true, durations: [8], resolutions: ['720p', '1080p'], aspectRatios: ['16:9', '9:16'] } },
        // text (deepseek)
        { modelId: getKey('TEXT_MODEL') || 'deepseek-v4-pro', label: 'DeepSeek v4 Pro', category: 'text', providerId: deepseek.id, isDefault: true, sortOrder: 0,
          capabilities: { supportsFunctionCalling: true, supportsThinking: true } },
        // vision (mimo)
        { modelId: getKey('VISION_MODEL') || 'mimo-v2.5', label: 'MiMo v2.5', category: 'vision', providerId: mimo.id, isDefault: true, sortOrder: 0,
          capabilities: { supportsVision: true } },
    ];
    for (const m of seed) createModel(m);
    ensureAsrSeed();
    console.log(`[Registry] Seeded ${listProviders().length} providers + ${listModels().length} models from config.`);
    return true;
}

/**
 * Ensure an ASR (语音识别/智能字幕) model exists. Idempotent — also runs on
 * already-seeded DBs so the ASR slot appears after upgrade. Seeds with an empty
 * endpoint (legacy ASR config points at the dead gpt2api gateway); admin fills
 * in a real Whisper-compatible baseUrl/apiKey.
 */
export function ensureAsrSeed() {
    if (listModelsByCategory('asr').length > 0) return false;
    // 优先复用 MiMo 接入点（自带 mimo-v2.5-asr 语音识别，开箱即用）。
    const mimo = listProviders().find(p => /mimo|axiomcode/i.test(p.name) || /axiomcode\.dev/i.test(p.baseUrl));
    if (mimo) {
        createModel({ modelId: 'mimo-v2.5-asr', label: 'MiMo ASR', category: 'asr', providerId: mimo.id, isDefault: true, sortOrder: 0, capabilities: {} });
        return true;
    }
    // 否则建一个空的 Whisper 接入点占位（旧 ASR 指向已死 gpt2api，故留空待管理员填）。
    const rawUrl = getKey('ASR_API_URL');
    const baseUrl = rawUrl && !/gpt2api\.com/i.test(rawUrl) ? rawUrl : '';
    const prov = createProvider({ name: '语音识别 (Whisper)', kind: 'openai', baseUrl, apiKey: baseUrl ? getKey('ASR_API_KEY') : '' });
    createModel({ modelId: getKey('ASR_MODEL') || 'whisper-1', label: 'Whisper', category: 'asr', providerId: prov.id, isDefault: true, sortOrder: 0, capabilities: {} });
    return true;
}
