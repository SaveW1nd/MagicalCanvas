/**
 * AssetAdmin.tsx — 管理员「素材库」。
 *
 * 跨用户浏览所有库素材，可按用户/可见性/分类/关键词筛选，
 * 切换素材公开/私有、删除素材，并管理用户发布的公共工作流。
 * 数据来自 GET /api/admin/assets 与 GET /api/admin/public-workflows（requireAdmin）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, RefreshCw, Globe, Trash2, LayoutGrid } from 'lucide-react';
import { showToast } from '../Toast';
import { Select } from '../ui/Select';
import { Tip } from '../ui/Tip';
import { showAppConfirm } from '../ui/AppDialog';

interface Asset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
    ownerId: string;
    ownerName: string;
    visibility: 'private' | 'public';
    sourceAssetId?: string;
    createdAt: string;
}
interface AdminUserLite { id: string; username: string; role: 'admin' | 'user' }
interface AssetsResp {
    assets: Asset[];
    total: number;
    users: AdminUserLite[];
    categories: string[];
}
interface PublicWorkflow {
    id: string;
    title: string;
    nodeCount: number;
    coverUrl: string | null;
    publishedBy: string;
    publishedByName: string;
    publishedAt: string;
}

// 资源 URL 是后端绝对路径(/library/...)，开发时前端跑在 5173，需要指到 3501。
const MEDIA_BASE = (typeof window !== 'undefined' && window.location.port === '5173')
    ? `${window.location.protocol}//${window.location.hostname}:3501`
    : '';

async function adminFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

function fmtDate(s: string | null): string {
    if (!s) return '';
    const d = new Date(s);
    if (isNaN(d.getTime())) return '';
    const p = (n: number) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

export const AssetAdmin: React.FC = () => {
    const [resp, setResp] = useState<AssetsResp | null>(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState('');
    const [visibility, setVisibility] = useState('');
    const [category, setCategory] = useState('');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');

    const [workflows, setWorkflows] = useState<PublicWorkflow[]>([]);
    const [wfLoading, setWfLoading] = useState(true);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (userId) params.set('userId', userId);
            if (visibility) params.set('visibility', visibility);
            if (category) params.set('category', category);
            if (debouncedQ) params.set('q', debouncedQ);
            setResp(await adminFetch(`/api/admin/assets?${params.toString()}`));
        } catch (e) {
            showToast(e instanceof Error ? e.message : '加载失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, visibility, category, debouncedQ]);

    useEffect(() => { load(); }, [load]);

    const loadWorkflows = useCallback(async () => {
        setWfLoading(true);
        try {
            const data = await adminFetch('/api/admin/public-workflows');
            setWorkflows(data.workflows || []);
        } catch (e) {
            showToast(e instanceof Error ? e.message : '加载公共工作流失败', 'error');
        } finally {
            setWfLoading(false);
        }
    }, []);

    useEffect(() => { loadWorkflows(); }, [loadWorkflows]);

    const userOptions = useMemo(() => ([
        { value: '', label: '全部用户' },
        ...((resp?.users || []).map(u => ({ value: u.id, label: `${u.username}${u.role === 'admin' ? ' · 管理员' : ''}` }))),
    ]), [resp?.users]);

    const categoryOptions = useMemo(() => ([
        { value: '', label: '全部分类' },
        ...((resp?.categories || []).map(c => ({ value: c, label: c }))),
    ]), [resp?.categories]);

    const visibilityOptions = useMemo(() => ([
        { value: '', label: '全部可见性' },
        { value: 'private', label: '私有' },
        { value: 'public', label: '公共' },
    ]), []);

    const assets = resp?.assets || [];
    const total = resp?.total || 0;
    const mediaUrl = (u?: string | null) => (u ? `${MEDIA_BASE}${u}` : '');

    const toggleVisibility = useCallback(async (a: Asset) => {
        const next = a.visibility === 'public' ? 'private' : 'public';
        try {
            const data = await adminFetch(`/api/admin/assets/${a.id}/visibility`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ visibility: next }),
            });
            const updated: Asset = data.asset || { ...a, visibility: next };
            setResp(prev => prev ? { ...prev, assets: prev.assets.map(x => x.id === a.id ? updated : x) } : prev);
            showToast(next === 'public' ? '已发布到公共' : '已下架为私有', 'success');
        } catch (e) {
            showToast(e instanceof Error ? e.message : '操作失败', 'error');
        }
    }, []);

    const deleteAsset = useCallback(async (a: Asset) => {
        const ok = await showAppConfirm(`确定删除素材「${a.name}」吗？此操作不可撤销。`, { title: '删除素材', danger: true, confirmText: '删除' });
        if (!ok) return;
        try {
            await adminFetch(`/api/admin/assets/${a.id}`, { method: 'DELETE' });
            setResp(prev => prev ? { ...prev, assets: prev.assets.filter(x => x.id !== a.id), total: Math.max(0, prev.total - 1) } : prev);
            showToast('素材已删除', 'success');
        } catch (e) {
            showToast(e instanceof Error ? e.message : '删除失败', 'error');
        }
    }, []);

    const deleteWorkflow = useCallback(async (w: PublicWorkflow) => {
        const ok = await showAppConfirm(`确定删除公共工作流「${w.title}」吗？此操作不可撤销。`, { title: '删除公共工作流', danger: true, confirmText: '删除' });
        if (!ok) return;
        try {
            await adminFetch(`/api/admin/public-workflows/${w.id}`, { method: 'DELETE' });
            showToast('公共工作流已删除', 'success');
            loadWorkflows();
        } catch (e) {
            showToast(e instanceof Error ? e.message : '删除失败', 'error');
        }
    }, [loadWorkflows]);

    return (
        <div className="max-w-6xl">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-white">素材库</h2>
                <button onClick={() => load()} disabled={loading}
                    className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-neutral-900 transition-colors disabled:opacity-50">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
                </button>
            </div>
            <p className="text-xs text-neutral-500 mb-4">浏览所有用户的库素材，可切换公开 / 私有、删除，并管理公共工作流。</p>

            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Select value={userId} options={userOptions} onChange={setUserId} className="w-44" />
                <Select value={visibility} options={visibilityOptions} onChange={setVisibility} className="w-36" />
                <Select value={category} options={categoryOptions} onChange={setCategory} className="w-40" />
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索名称 / 用户"
                        className="w-full rounded-lg bg-neutral-950 border border-neutral-700 text-sm text-neutral-200 pl-8 pr-2.5 py-1.5 outline-none focus:border-neutral-500 transition-colors" />
                </div>
                <span className="text-xs text-neutral-500 ml-auto">共 {total} 条</span>
            </div>

            {/* 素材网格 */}
            {loading ? (
                <div className="flex items-center justify-center py-20 text-neutral-500"><Loader2 size={24} className="animate-spin" /></div>
            ) : assets.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 p-12 text-center text-neutral-500 text-sm">
                    没有符合条件的素材
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {assets.map(a => (
                        <div key={a.id}
                            className="group rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden flex flex-col hover:border-neutral-600 transition-colors">
                            {/* 预览区 */}
                            <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden">
                                {a.type === 'video' ? (
                                    <video src={mediaUrl(a.url)} className="w-full h-full object-cover" muted
                                        onMouseEnter={e => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
                                        onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                                ) : (
                                    <img src={mediaUrl(a.url)} alt="" className="w-full h-full object-cover" loading="lazy" />
                                )}
                                {/* 可见性徽标 */}
                                <span className={`absolute top-1.5 left-1.5 px-1.5 py-0.5 rounded-md text-[10px] backdrop-blur-sm ${a.visibility === 'public' ? 'bg-emerald-600/80 text-white' : 'bg-black/70 text-neutral-300'}`}>
                                    {a.visibility === 'public' ? '公共' : '私有'}
                                </span>
                                {/* hover 操作 */}
                                <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                    <Tip label={a.visibility === 'public' ? '下架为私有' : '发布到公共'}>
                                        <button onClick={() => toggleVisibility(a)}
                                            className="p-1 rounded-md bg-black/70 text-neutral-300 hover:text-white backdrop-blur-sm">
                                            <Globe size={14} />
                                        </button>
                                    </Tip>
                                    <Tip label="删除">
                                        <button onClick={() => deleteAsset(a)}
                                            className="p-1 rounded-md bg-black/70 text-neutral-300 hover:text-red-400 backdrop-blur-sm">
                                            <Trash2 size={14} />
                                        </button>
                                    </Tip>
                                </div>
                            </div>
                            {/* 信息区 */}
                            <div className="p-2.5 flex flex-col gap-1 min-w-0">
                                <div className="text-sm text-neutral-200 truncate" title={a.name}>{a.name}</div>
                                <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                                    <span className="truncate" title={`归属：${a.ownerName}`}>{a.ownerName}</span>
                                    <span className="shrink-0">{fmtDate(a.createdAt)}</span>
                                </div>
                                <div className="text-[10px] text-neutral-600 truncate">{a.category}</div>
                            </div>
                        </div>
                    ))}
                </div>
            )}

            {/* 公共工作流 */}
            <div className="mt-10">
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold text-white">公共工作流</h3>
                    <button onClick={() => loadWorkflows()} disabled={wfLoading}
                        className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-neutral-900 transition-colors disabled:opacity-50">
                        <RefreshCw size={13} className={wfLoading ? 'animate-spin' : ''} /> 刷新
                    </button>
                </div>
                <p className="text-xs text-neutral-500 mb-4">用户发布的公共工作流，可删除下架。</p>

                {wfLoading ? (
                    <div className="flex items-center justify-center py-12 text-neutral-500"><Loader2 size={24} className="animate-spin" /></div>
                ) : workflows.length === 0 ? (
                    <div className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 p-10 text-center text-neutral-500 text-sm">
                        暂无公共工作流
                    </div>
                ) : (
                    <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                        {workflows.map(w => (
                            <div key={w.id}
                                className="group rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden flex flex-col hover:border-neutral-600 transition-colors">
                                <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden">
                                    {w.coverUrl ? (
                                        <img src={mediaUrl(w.coverUrl)} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="text-neutral-700 scale-[1.9]"><LayoutGrid size={13} /></div>
                                    )}
                                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                                        <Tip label="删除">
                                            <button onClick={() => deleteWorkflow(w)}
                                                className="p-1 rounded-md bg-black/70 text-neutral-300 hover:text-red-400 backdrop-blur-sm">
                                                <Trash2 size={14} />
                                            </button>
                                        </Tip>
                                    </div>
                                </div>
                                <div className="p-2.5 flex flex-col gap-1 min-w-0">
                                    <div className="text-sm text-neutral-200 truncate" title={w.title}>{w.title}</div>
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                                        <span className="truncate" title={`发布者：${w.publishedByName}`}>{w.publishedByName}</span>
                                        <span className="shrink-0">{w.nodeCount} 个节点</span>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                )}
            </div>
        </div>
    );
};
