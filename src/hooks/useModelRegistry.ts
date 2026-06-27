/**
 * useModelRegistry — loads the admin-configured model registry from /api/models
 * once per session (module-cached; many canvas nodes share one fetch) and maps
 * it into the shape the canvas dropdowns expect.
 *
 * Falls back to the caller's hardcoded arrays until the fetch resolves (or if it
 * fails), so the UI never renders empty.
 */
import { useEffect, useState } from 'react';

export interface CanvasModel {
    id: string;
    name: string;
    provider: string; // 'gpt2api' keeps the existing dropdown grouping intact
    recommended?: boolean;
    supportsImageToImage?: boolean;
    supportsMultiImage?: boolean;
    supportsTextToVideo?: boolean;
    supportsImageToVideo?: boolean;
    supportsFirstLastFrame?: boolean;
    durations?: number[];
    resolutions?: string[];
    aspectRatios?: string[];
}

interface Registry {
    image: CanvasModel[];
    video: CanvasModel[];
    defaults: Record<string, string>;
    loaded: boolean;
}

const EMPTY: Registry = { image: [], video: [], defaults: {}, loaded: false };

let cache: Registry | null = null;
let inflight: Promise<Registry> | null = null;
const listeners = new Set<(r: Registry) => void>();

// fp/openai providerKind both map to the existing 'gpt2api' dropdown section.
function mapModel(m: Record<string, unknown>): CanvasModel {
    return {
        id: String(m.id),
        name: String(m.label || m.id),
        provider: 'gpt2api',
        recommended: !!m.recommended,
        supportsImageToImage: !!m.supportsImageToImage,
        supportsMultiImage: !!m.supportsMultiImage,
        supportsTextToVideo: !!m.supportsTextToVideo,
        supportsImageToVideo: !!m.supportsImageToVideo,
        supportsFirstLastFrame: !!m.supportsFirstLastFrame,
        durations: Array.isArray(m.durations) ? (m.durations as number[]) : undefined,
        resolutions: Array.isArray(m.resolutions) ? (m.resolutions as string[]) : undefined,
        aspectRatios: Array.isArray(m.aspectRatios) ? (m.aspectRatios as string[]) : undefined,
    };
}

async function fetchRegistry(): Promise<Registry> {
    if (cache) return cache;
    if (inflight) return inflight;
    inflight = (async () => {
        try {
            const res = await fetch('/api/models');
            const data = await res.json();
            const reg: Registry = {
                image: (data?.models?.image || []).map(mapModel),
                video: (data?.models?.video || []).map(mapModel),
                defaults: data?.defaults || {},
                loaded: true,
            };
            cache = reg;
            listeners.forEach(l => l(reg));
            return reg;
        } catch {
            const reg = { ...EMPTY, loaded: true };
            cache = reg;
            listeners.forEach(l => l(reg));
            return reg;
        } finally {
            inflight = null;
        }
    })();
    return inflight;
}

/** Force a refresh (e.g. after admin edits) so open canvases pick up changes. */
export function invalidateModelRegistry() {
    cache = null;
    fetchRegistry();
}

export function useModelRegistry(): Registry {
    const [reg, setReg] = useState<Registry>(cache || EMPTY);
    useEffect(() => {
        let active = true;
        const l = (r: Registry) => { if (active) setReg(r); };
        listeners.add(l);
        if (cache) setReg(cache);
        else fetchRegistry();
        return () => { active = false; listeners.delete(l); };
    }, []);
    return reg;
}
