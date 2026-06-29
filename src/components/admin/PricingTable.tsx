/**
 * PricingTable.tsx — 管理员：所有模型 × 所有档位 的统一定价页。
 * 直接填绝对积分（支持小数）：图片按分辨率、视频按时长、文字/视觉单价。
 * 留空=该档不单独定价（回退模型单价 / 类别兜底价）。
 */
import React, { useState } from 'react';
import { Loader2, Save } from 'lucide-react';
import { showToast } from '../Toast';
import { useSWR, invalidateCache } from '../../utils/swrCache';
import type { RegistryModel } from './ModelModal';

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const CAT_LABEL: Record<string, string> = { image: '图片', video: '视频', vision: '看图(视觉)', text: '文字' };
const CAT_ORDER = ['image', 'video', 'vision', 'text'];

const inputCls = 'w-20 bg-neutral-900 border border-neutral-700 rounded-md px-2 py-1 text-sm text-white text-right outline-none focus:border-blue-500';

export const PricingTable: React.FC = () => {
    const { data, loading, refetch } = useSWR<{ models: RegistryModel[] }>('admin:models', () => api('/api/admin/models'));
    const models = data?.models || [];
    const [draft, setDraft] = useState<Record<string, any>>({});
    const [savingId, setSavingId] = useState<string | null>(null);

    const pricingOf = (m: RegistryModel): any => draft[m.id] ?? (m.pricing && typeof m.pricing === 'object' ? m.pricing : {});
    const setTier = (m: RegistryModel, group: 'byResolution' | 'byDuration', key: string, v: string) => {
        setDraft(d => {
            const p = { ...pricingOf(m) };
            const g = { ...(p[group] || {}) };
            if (v === '') delete g[key]; else g[key] = Number(v);
            if (Object.keys(g).length) p[group] = g; else delete p[group];
            return { ...d, [m.id]: p };
        });
    };
    const setBase = (m: RegistryModel, v: string) => {
        setDraft(d => { const p = { ...pricingOf(m) }; if (v === '') delete p.base; else p.base = Number(v); return { ...d, [m.id]: p }; });
    };

    const save = async (m: RegistryModel) => {
        setSavingId(m.id);
        try {
            await api(`/api/admin/models/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pricing: pricingOf(m) }) });
            invalidateCache('admin:models');
            await refetch();
            setDraft(d => { const n = { ...d }; delete n[m.id]; return n; }); // 用服务端最新值
            showToast('已保存', 'success');
        } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
        finally { setSavingId(null); }
    };

    const resolutionsOf = (m: RegistryModel): string[] => {
        const r = (m.capabilities as any)?.resolutions;
        return Array.isArray(r) && r.length ? r : ['1K', '2K', '4K'];
    };
    const durationsOf = (m: RegistryModel): number[] => {
        const d = (m.capabilities as any)?.durations;
        return Array.isArray(d) && d.length ? d : [5, 10];
    };

    return (
        <div className="flex flex-col gap-5">
            <div>
                <h2 className="text-base font-semibold text-white mb-1">模型价格</h2>
                <p className="text-xs text-neutral-500">
                    直接填每次生成扣多少积分（支持小数）。图片按分辨率、视频按时长、文字/视觉单价；留空=该档回退模型单价/类别兜底价。
                    {loading && !data && <span className="ml-2 text-neutral-400">加载中…</span>}
                </p>
            </div>

            {CAT_ORDER.map(cat => {
                const list = models.filter(m => m.category === cat);
                if (!list.length) return null;
                return (
                    <div key={cat}>
                        <h3 className="text-sm font-medium text-neutral-300 mb-2">{CAT_LABEL[cat] || cat}</h3>
                        <div className="rounded-xl border border-neutral-800 overflow-hidden divide-y divide-neutral-800">
                            {list.map(m => {
                                const p = pricingOf(m);
                                const dirty = !!draft[m.id];
                                return (
                                    <div key={m.id} className="flex items-center gap-4 px-4 py-3 flex-wrap">
                                        <div className="min-w-[160px]">
                                            <div className="text-sm text-neutral-200">{m.label}</div>
                                            <div className="text-[11px] text-neutral-500 font-mono">{m.modelId}</div>
                                        </div>
                                        <div className="flex items-center gap-3 flex-wrap flex-1">
                                            {cat === 'image' && resolutionsOf(m).map(r => (
                                                <label key={r} className="text-xs text-neutral-400 flex items-center gap-1">
                                                    {r}
                                                    <input type="number" step="0.01" min="0" placeholder="—"
                                                        value={p.byResolution?.[r.toLowerCase()] ?? ''}
                                                        onChange={e => setTier(m, 'byResolution', r.toLowerCase(), e.target.value)}
                                                        className={inputCls} />
                                                </label>
                                            ))}
                                            {cat === 'video' && durationsOf(m).map(n => (
                                                <label key={n} className="text-xs text-neutral-400 flex items-center gap-1">
                                                    {n}s
                                                    <input type="number" step="0.01" min="0" placeholder="—"
                                                        value={p.byDuration?.[`${n}s`] ?? ''}
                                                        onChange={e => setTier(m, 'byDuration', `${n}s`, e.target.value)}
                                                        className={inputCls} />
                                                </label>
                                            ))}
                                            {(cat === 'text' || cat === 'vision') && (
                                                <label className="text-xs text-neutral-400 flex items-center gap-1">
                                                    单价
                                                    <input type="number" step="0.01" min="0" placeholder="—"
                                                        value={p.base ?? ''}
                                                        onChange={e => setBase(m, e.target.value)}
                                                        className={inputCls} />
                                                </label>
                                            )}
                                        </div>
                                        <button onClick={() => save(m)} disabled={!dirty || savingId === m.id}
                                            className={`shrink-0 flex items-center gap-1 px-3 py-1.5 rounded-lg text-xs ${dirty ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-neutral-800 text-neutral-500'} disabled:opacity-50`}>
                                            {savingId === m.id ? <Loader2 size={13} className="animate-spin" /> : <Save size={13} />}保存
                                        </button>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                );
            })}

            {!loading && !models.length && <p className="text-sm text-neutral-500">还没有模型，请先到「模型配置」添加。</p>}
        </div>
    );
};
