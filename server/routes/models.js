/**
 * routes/models.js — read-only model registry for the canvas (any logged-in user).
 *
 * GET /api/models[?category=image]
 *   -> { models: {image:[...], video:[...], text:[...], vision:[...]}, defaults }
 *   Sanitized: no apiKey/baseUrl leak — only what the UI needs to render dropdowns
 *   (modelId, label, capabilities, isDefault, providerKind).
 */

import express from 'express';
import { listModelsByCategory, getProvider, CATEGORIES } from '../db/registry.js';

const router = express.Router();

function publicModel(m) {
    const prov = getProvider(m.providerId);
    return {
        id: m.modelId,            // wire id the canvas sends back on generate
        label: m.label,
        category: m.category,
        isDefault: m.isDefault,
        providerKind: prov ? prov.kind : null,
        ...m.capabilities,        // recommended / resolutions / aspectRatios / durations / supports*
    };
}

router.get('/', (req, res) => {
    try {
        const wanted = req.query.category && CATEGORIES.includes(String(req.query.category))
            ? [String(req.query.category)] : CATEGORIES;
        const models = {};
        const defaults = {};
        for (const cat of wanted) {
            const enabled = listModelsByCategory(cat).filter(m => m.enabled).map(publicModel);
            models[cat] = enabled;
            const def = enabled.find(m => m.isDefault) || enabled[0];
            if (def) defaults[cat] = def.id;
        }
        res.json({ success: true, models, defaults });
    } catch (e) {
        res.status(500).json({ success: false, error: e.message });
    }
});

export default router;
