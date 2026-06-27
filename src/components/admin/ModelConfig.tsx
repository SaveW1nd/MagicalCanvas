/**
 * ModelConfig.tsx — admin 模型配置 (P2 dynamic registry).
 *
 * Two sections:
 *   接入点 (providers) — baseUrl / apiKey / kind; 测试连通 + 拉取上游模型列表.
 *   模型清单 (models)  — per-category list; 增改删 / 启用 / 设为默认 / 能力配置.
 *
 * The canvas reads the enabled models from /api/models; generation resolves
 * each model's provider for baseUrl + apiKey.
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, Plus, Trash2, Pencil, Plug, ListChecks, Star, CheckCircle2, Circle } from 'lucide-react';
import { showToast } from '../Toast';
import { Tip } from '../ui/Tip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { ProviderModal } from './ProviderModal';
import { ModelModal, type RegistryModel } from './ModelModal';

export interface Provider {
    id: string; name: string; kind: 'fp' | 'openai'; baseUrl: string; hasKey: boolean;
}

const CATEGORY_LABEL: Record<string, string> = { image: '图片', video: '视频', text: '文字 / Agent', vision: '视觉 (看图)' };
const CATEGORY_ORDER = ['image', 'video', 'text', 'vision'];

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export const ModelConfig: React.FC = () => {
    const [providers, setProviders] = useState<Provider[]>([]);
    const [models, setModels] = useState<RegistryModel[]>([]);
    const [loading, setLoading] = useState(true);
    const [testingId, setTestingId] = useState<string | null>(null);

    const [providerModal, setProviderModal] = useState<{ open: boolean; provider?: Provider }>({ open: false });
    const [modelModal, setModelModal] = useState<{ open: boolean; model?: RegistryModel; category?: string }>({ open: false });
    const [confirm, setConfirm] = useState<{ title: string; message: string; run: () => Promise<string> } | null>(null);
    const [confirmBusy, setConfirmBusy] = useState(false);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const d = await api('/api/admin/models');
            setModels(d.models); setProviders(d.providers);
        } catch (e) { showToast(e instanceof Error ? e.message : '加载失败', 'error'); }
        finally { setLoading(false); }
    }, []);
    useEffect(() => { load(); }, [load]);

    const providerName = (id: string) => providers.find(p => p.id === id)?.name || '—';

    const testProvider = async (p: Provider) => {
        setTestingId(p.id);
        try {
            const r = await api(`/api/admin/providers/${p.id}/test`, { method: 'POST' });
            showToast(r.success ? r.message : (r.error || '连接失败'), r.success ? 'success' : 'error');
        } catch (e) { showToast(e instanceof Error ? e.message : '测试失败', 'error'); }
        finally { setTestingId(null); }
    };

    const runConfirm = async () => {
        if (!confirm) return;
        setConfirmBusy(true);
        try { const msg = await confirm.run(); await load(); setConfirm(null); showToast(msg, 'success'); }
        catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
        finally { setConfirmBusy(false); }
    };

    const askDeleteProvider = (p: Provider) => setConfirm({
        title: '删除接入点', message: `确认删除接入点「${p.name}」？`,
        run: async () => { await api(`/api/admin/providers/${p.id}`, { method: 'DELETE' }); return '已删除'; },
    });
    const askDeleteModel = (m: RegistryModel) => setConfirm({
        title: '删除模型', message: `确认从清单中删除模型「${m.label}」(${m.modelId})？`,
        run: async () => { await api(`/api/admin/models/${m.id}`, { method: 'DELETE' }); return '已删除'; },
    });

    const toggleEnabled = async (m: RegistryModel) => {
        try { await api(`/api/admin/models/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ enabled: !m.enabled }) }); await load(); }
        catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
    };
    const setDefault = async (m: RegistryModel) => {
        if (m.isDefault) return;
        try { await api(`/api/admin/models/${m.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ isDefault: true }) }); await load(); showToast(`已将「${m.label}」设为${CATEGORY_LABEL[m.category]}默认`, 'success'); }
        catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
    };

    if (loading) return <div className="flex items-center gap-2 text-neutral-500 text-sm py-8"><Loader2 size={16} className="animate-spin" /> 加载中…</div>;

    return (
        <div className="max-w-5xl">
            {/* ---------- Providers ---------- */}
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2"><Plug size={18} /> 接入点</h2>
                <button onClick={() => setProviderModal({ open: true })}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 transition-colors">
                    <Plus size={14} /> 新建接入点
                </button>
            </div>
            <div className="rounded-xl border border-neutral-800 overflow-hidden mb-8">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-900 text-neutral-400 text-xs">
                        <tr>
                            <th className="text-left font-medium px-4 py-2.5">名称</th>
                            <th className="text-left font-medium px-4 py-2.5">类型</th>
                            <th className="text-left font-medium px-4 py-2.5">Base URL</th>
                            <th className="text-left font-medium px-4 py-2.5">密钥</th>
                            <th className="text-right font-medium px-4 py-2.5">操作</th>
                        </tr>
                    </thead>
                    <tbody>
                        {providers.map(p => (
                            <tr key={p.id} className="border-t border-neutral-800 text-neutral-200">
                                <td className="px-4 py-2.5 font-medium">{p.name}</td>
                                <td className="px-4 py-2.5"><span className="text-[11px] px-1.5 py-0.5 rounded bg-neutral-800 text-neutral-300">{p.kind === 'fp' ? 'Flow (fp)' : 'OpenAI 兼容'}</span></td>
                                <td className="px-4 py-2.5 text-[12px] text-neutral-400 font-mono truncate max-w-[260px]">{p.baseUrl || '—'}</td>
                                <td className="px-4 py-2.5">{p.hasKey ? <span className="text-green-400 text-xs">已配置</span> : <span className="text-red-400 text-xs">未配置</span>}</td>
                                <td className="px-4 py-2.5">
                                    <div className="flex items-center justify-end gap-1.5">
                                        <Tip label="测试连通"><button onClick={() => testProvider(p)} disabled={testingId === p.id} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white disabled:opacity-50">{testingId === p.id ? <Loader2 size={15} className="animate-spin" /> : <Plug size={15} />}</button></Tip>
                                        <Tip label="编辑"><button onClick={() => setProviderModal({ open: true, provider: p })} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white"><Pencil size={15} /></button></Tip>
                                        <Tip label="删除"><button onClick={() => askDeleteProvider(p)} className="p-1.5 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400"><Trash2 size={15} /></button></Tip>
                                    </div>
                                </td>
                            </tr>
                        ))}
                        {!providers.length && <tr><td colSpan={5} className="px-4 py-6 text-center text-neutral-500 text-sm">暂无接入点</td></tr>}
                    </tbody>
                </table>
            </div>

            {/* ---------- Models by category ---------- */}
            <div className="flex items-center justify-between mb-3">
                <h2 className="text-lg font-semibold text-white flex items-center gap-2"><ListChecks size={18} /> 模型清单</h2>
            </div>
            <div className="space-y-6">
                {CATEGORY_ORDER.map(cat => {
                    const list = models.filter(m => m.category === cat);
                    return (
                        <div key={cat}>
                            <div className="flex items-center justify-between mb-2">
                                <h3 className="text-sm font-semibold text-neutral-300">{CATEGORY_LABEL[cat]}<span className="ml-2 text-[11px] text-neutral-500">{list.length} 个</span></h3>
                                <button onClick={() => setModelModal({ open: true, category: cat })}
                                    className="flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300"><Plus size={13} /> 添加模型</button>
                            </div>
                            <div className="rounded-xl border border-neutral-800 overflow-hidden">
                                <table className="w-full text-sm">
                                    <tbody>
                                        {list.map(m => (
                                            <tr key={m.id} className={`border-b border-neutral-800 last:border-0 ${m.enabled ? 'text-neutral-200' : 'text-neutral-600'}`}>
                                                <td className="px-4 py-2.5 w-8">
                                                    <Tip label={m.isDefault ? '默认模型' : '设为默认'}>
                                                        <button onClick={() => setDefault(m)} className={m.isDefault ? 'text-amber-400' : 'text-neutral-600 hover:text-neutral-300'}><Star size={15} fill={m.isDefault ? 'currentColor' : 'none'} /></button>
                                                    </Tip>
                                                </td>
                                                <td className="px-2 py-2.5">
                                                    <div className="font-medium flex items-center gap-2">{m.label}{m.capabilities?.recommended && <span className="text-[10px] text-green-400 border border-green-700/50 rounded px-1">推荐</span>}</div>
                                                    <div className="text-[11px] text-neutral-500 font-mono">{m.modelId}</div>
                                                </td>
                                                <td className="px-2 py-2.5 text-[12px] text-neutral-400">{providerName(m.providerId)}</td>
                                                <td className="px-2 py-2.5 text-right">
                                                    <div className="flex items-center justify-end gap-1.5">
                                                        <Tip label={m.enabled ? '已启用（点击停用）' : '已停用（点击启用）'}>
                                                            <button onClick={() => toggleEnabled(m)} className={m.enabled ? 'text-green-400' : 'text-neutral-600 hover:text-neutral-300'}>{m.enabled ? <CheckCircle2 size={16} /> : <Circle size={16} />}</button>
                                                        </Tip>
                                                        <Tip label="编辑"><button onClick={() => setModelModal({ open: true, model: m })} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white"><Pencil size={15} /></button></Tip>
                                                        <Tip label="删除"><button onClick={() => askDeleteModel(m)} className="p-1.5 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400"><Trash2 size={15} /></button></Tip>
                                                    </div>
                                                </td>
                                            </tr>
                                        ))}
                                        {!list.length && <tr><td className="px-4 py-4 text-center text-neutral-500 text-xs">暂无模型</td></tr>}
                                    </tbody>
                                </table>
                            </div>
                        </div>
                    );
                })}
            </div>

            <ProviderModal
                open={providerModal.open}
                provider={providerModal.provider}
                onClose={() => setProviderModal({ open: false })}
                onSaved={async () => { setProviderModal({ open: false }); await load(); }}
            />
            <ModelModal
                open={modelModal.open}
                model={modelModal.model}
                presetCategory={modelModal.category}
                providers={providers}
                onClose={() => setModelModal({ open: false })}
                onSaved={async () => { setModelModal({ open: false }); await load(); }}
            />
            <ConfirmDialog
                open={!!confirm}
                title={confirm?.title || ''}
                message={confirm?.message}
                confirmText="确认"
                danger
                loading={confirmBusy}
                onConfirm={runConfirm}
                onClose={() => { if (!confirmBusy) setConfirm(null); }}
            />
        </div>
    );
};
