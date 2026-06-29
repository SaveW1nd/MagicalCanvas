/**
 * PricingTable.tsx — 管理员：所有模型 × 所有档位 的统一定价页（含计费总开关 + 保存按钮）。
 * 直接填绝对积分（支持小数）：图片按分辨率、视频按时长、文字/视觉单价。
 * 留空 = 该档不收费（免费）。改完点右上角「保存」统一保存。
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

const CAT_LABEL: Record<string, string> = { image: '图片', video: '视频', vision: '看图（视觉）', text: '文字' };
const CAT_ORDER = ['image', 'video', 'vision', 'text'];

const numCls = 'w-[68px] bg-neutral-900/80 border border-neutral-700/80 rounded-lg px-2 py-1.5 text-sm text-white text-center outline-none transition-colors focus:border-blue-500 hover:border-neutral-600 [appearance:textfield] [&::-webkit-outer-spin-button]:appearance-none [&::-webkit-inner-spin-button]:appearance-none placeholder:text-neutral-600';

// 模块级组件：必须放在 PricingTable 外面，否则每次输入 re-render 会重建输入框、丢失焦点（无法连续输入）。
const TierField: React.FC<{ label: string; value: any; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
    <div className="flex flex-col items-center gap-1">
        <span className="text-[11px] text-neutral-500">{label}</span>
        <input type="number" step="0.01" min="0" placeholder={placeholder ?? '免费'} value={value ?? ''}
            onChange={e => onChange(e.target.value)} className={numCls} />
    </div>
);

export const PricingTable: React.FC = () => {
    const { data, loading, refetch } = useSWR<{ models: RegistryModel[] }>('admin:models', () => api('/api/admin/models'));
    const cfg = useSWR<{ enabled: boolean }>('admin:billing-config', () => api('/api/admin/billing-config'));
    const models = data?.models || [];

    const [draft, setDraft] = useState<Record<string, any>>({});
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [togBusy, setTogBusy] = useState(false);
    React.useEffect(() => { if (cfg.data) setEnabled(!!cfg.data.enabled); }, [cfg.data]);

    const dirty = Object.keys(draft).length > 0;
    const pricingOf = (m: RegistryModel): any => draft[m.id] ?? (m.pricing && typeof m.pricing === 'object' ? m.pricing : {});

    const editTier = (m: RegistryModel, group: 'byResolution' | 'byDuration', key: string, v: string) => {
        setDraft(d => {
            const p = { ...pricingOf(m) };
            const g = { ...(p[group] || {}) };
            if (v === '') delete g[key]; else g[key] = Number(v);
            if (Object.keys(g).length) p[group] = g; else delete p[group];
            return { ...d, [m.id]: p };
        });
    };
    const editBase = (m: RegistryModel, v: string) => {
        setDraft(d => { const p = { ...pricingOf(m) }; if (v === '') delete p.base; else p.base = Number(v); return { ...d, [m.id]: p }; });
    };

    const saveAll = async () => {
        const ids = Object.keys(draft);
        if (!ids.length) return;
        setSaving(true);
        try {
            for (const id of ids) {
                await api(`/api/admin/models/${id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ pricing: draft[id] }) });
            }
            invalidateCache('admin:models');
            await refetch();
            setDraft({});
            showToast(`已保存 ${ids.length} 个模型的价格`, 'success');
        } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
        finally { setSaving(false); }
    };

    const toggleBilling = async () => {
        const next = !enabled;
        setEnabled(next); setTogBusy(true);
        try {
            await api('/api/admin/billing-config', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: next }) });
            invalidateCache('admin:billing-config'); cfg.refetch();
            showToast(next ? '已开启计费' : '已关闭计费', 'success');
        } catch (e) { setEnabled(!next); showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
        finally { setTogBusy(false); }
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
        <div className="flex flex-col gap-5 max-w-3xl">
            {/* 顶部：标题 + 保存 + 计费总开关 */}
            <div className="flex items-start justify-between gap-4">
                <div>
                    <h2 className="text-base font-semibold text-white mb-1 flex items-center gap-2">
                        模型价格 {loading && !data && <Loader2 size={14} className="animate-spin text-neutral-500" />}
                    </h2>
                    <p className="text-xs text-neutral-500 leading-relaxed">
                        最终积分 = <span className="text-neutral-400">基础价 × 命中倍率</span>。倍率留空 = ×1，基础价留空 = 免费。改完点右侧「保存」。
                    </p>
                </div>
                <div className="shrink-0 flex items-center gap-2">
                    <button onClick={saveAll} disabled={!dirty || saving}
                        className={`flex items-center gap-1.5 px-3.5 py-2 rounded-xl text-sm transition-colors ${dirty ? 'bg-blue-600 hover:bg-blue-500 text-white' : 'bg-neutral-800 text-neutral-500'} disabled:opacity-60`}>
                        {saving ? <Loader2 size={14} className="animate-spin" /> : <Save size={14} />}保存{dirty ? ` (${Object.keys(draft).length})` : ''}
                    </button>
                    <div className="flex items-center gap-2.5 bg-neutral-900 border border-neutral-800 rounded-xl px-3.5 py-2.5">
                        <span className="text-xs text-neutral-300 whitespace-nowrap">启用计费</span>
                        <button onClick={toggleBilling} disabled={togBusy}
                            className={`relative w-10 h-[22px] rounded-full transition-colors disabled:opacity-60 ${enabled ? 'bg-blue-600' : 'bg-neutral-700'}`}>
                            <span className={`absolute top-0.5 left-0.5 w-[18px] h-[18px] rounded-full bg-white transition-transform ${enabled ? 'translate-x-[18px]' : ''}`} />
                        </button>
                    </div>
                </div>
            </div>

            {!enabled && (
                <div className="text-xs text-amber-300/90 bg-amber-500/10 border border-amber-500/20 rounded-lg px-3 py-2">
                    计费当前<span className="font-medium">未开启</span>，不会扣任何用户积分。配好价格后打开右上角开关即可生效（管理员始终不扣）。
                </div>
            )}

            {CAT_ORDER.map(cat => {
                const list = models.filter(m => m.category === cat);
                if (!list.length) return null;
                return (
                    <section key={cat} className="flex flex-col gap-2">
                        <h3 className="text-xs font-semibold tracking-wide text-neutral-400 uppercase">{CAT_LABEL[cat] || cat}</h3>
                        <div className="rounded-xl border border-neutral-800 bg-neutral-950/40 divide-y divide-neutral-800/70">
                            {list.map(m => {
                                const p = pricingOf(m);
                                return (
                                    <div key={m.id} className="flex items-center gap-5 px-4 py-3.5 flex-wrap">
                                        <div className="min-w-[150px] flex-1">
                                            <div className="text-sm text-neutral-100 font-medium flex items-center gap-2">
                                                {m.label}
                                                {draft[m.id] && <span className="w-1.5 h-1.5 rounded-full bg-amber-400" title="未保存" />}
                                            </div>
                                            <div className="text-[11px] text-neutral-600 font-mono">{m.modelId}</div>
                                        </div>
                                        <div className="flex items-end gap-3 flex-wrap">
                                            <TierField label="基础价" value={p.base} onChange={v => editBase(m, v)} />
                                            {cat === 'image' && resolutionsOf(m).map(r => (
                                                <TierField key={r} label={`${r} ×`} placeholder="1" value={p.byResolution?.[r.toLowerCase()]}
                                                    onChange={v => editTier(m, 'byResolution', r.toLowerCase(), v)} />
                                            ))}
                                            {cat === 'video' && durationsOf(m).map(n => (
                                                <TierField key={n} label={`${n}s ×`} placeholder="1" value={p.byDuration?.[`${n}s`]}
                                                    onChange={v => editTier(m, 'byDuration', `${n}s`, v)} />
                                            ))}
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </section>
                );
            })}

            {!loading && !models.length && <p className="text-sm text-neutral-500">还没有模型，请先到「模型配置」添加。</p>}
        </div>
    );
};
