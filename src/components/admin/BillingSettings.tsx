/**
 * BillingSettings.tsx — 管理员：积分计费总开关 + 各类别兜底价。
 * 兜底价：模型没单独配 pricing.base 时按类别用此价（积分）。
 */
import React, { useEffect, useState } from 'react';
import { Loader2 } from 'lucide-react';
import { showToast } from '../Toast';

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const CATS: { key: string; label: string }[] = [
    { key: 'image', label: '图片' },
    { key: 'video', label: '视频' },
    { key: 'vision', label: '看图(视觉)' },
    { key: 'text', label: '文字/对话' },
];

export const BillingSettings: React.FC = () => {
    const [loading, setLoading] = useState(true);
    const [saving, setSaving] = useState(false);
    const [enabled, setEnabled] = useState(false);
    const [prices, setPrices] = useState<Record<string, number>>({});

    useEffect(() => {
        (async () => {
            try {
                const d = await api('/api/admin/billing-config');
                setEnabled(!!d.enabled);
                setPrices(d.defaultPrice || {});
            } catch (e) { showToast(e instanceof Error ? e.message : '加载失败', 'error'); }
            finally { setLoading(false); }
        })();
    }, []);

    const save = async () => {
        setSaving(true);
        try {
            const d = await api('/api/admin/billing-config', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ enabled, defaultPrice: prices }),
            });
            setEnabled(!!d.enabled);
            setPrices(d.defaultPrice || {});
            showToast('已保存', 'success');
        } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
        finally { setSaving(false); }
    };

    if (loading) return <div className="flex items-center gap-2 text-neutral-500 text-sm py-8"><Loader2 size={16} className="animate-spin" /> 加载中…</div>;

    return (
        <div className="max-w-md flex flex-col gap-5">
            <div>
                <h2 className="text-base font-semibold text-white mb-1">积分设置</h2>
                <p className="text-xs text-neutral-500">总开关关闭时不扣任何用户积分（管理员始终不扣）。配好价格后再开启。</p>
            </div>

            <label className="flex items-center justify-between bg-neutral-900 border border-neutral-800 rounded-xl px-4 py-3">
                <span className="text-sm text-neutral-200">启用积分计费</span>
                <button onClick={() => setEnabled(v => !v)}
                    className={`relative w-11 h-6 rounded-full transition-colors ${enabled ? 'bg-blue-600' : 'bg-neutral-700'}`}>
                    <span className={`absolute top-0.5 left-0.5 w-5 h-5 rounded-full bg-white transition-transform ${enabled ? 'translate-x-5' : ''}`} />
                </button>
            </label>

            <div>
                <h3 className="text-sm font-medium text-neutral-300 mb-2">类别兜底价（积分，支持小数）</h3>
                <div className="grid grid-cols-2 gap-3">
                    {CATS.map(c => (
                        <label key={c.key} className="text-xs text-neutral-400">
                            {c.label}
                            <input type="number" step="0.01" min="0" value={prices[c.key] ?? ''}
                                onChange={e => setPrices(p => ({ ...p, [c.key]: e.target.value === '' ? 0 : Number(e.target.value) }))}
                                placeholder="0"
                                className="mt-1 w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                        </label>
                    ))}
                </div>
                <p className="text-[11px] text-neutral-500 mt-2">模型单独配了价格时优先用模型价；没配才用这里的兜底价。</p>
            </div>

            <div>
                <button onClick={save} disabled={saving}
                    className="px-4 py-2 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50">
                    {saving && <Loader2 size={14} className="animate-spin" />}保存
                </button>
            </div>
        </div>
    );
};
