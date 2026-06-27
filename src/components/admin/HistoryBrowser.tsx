/**
 * HistoryBrowser.tsx — 管理员「全部历史」(P3)。
 *
 * 跨用户浏览所有生成历史/画布/对话/剪辑，可按用户、类型、关键词筛选。只读浏览。
 * 数据来自 GET /api/admin/history（requireAdmin）。
 */
import React, { useCallback, useEffect, useMemo, useState } from 'react';
import { Loader2, Search, RefreshCw, Image as ImageIcon, Film, MessageSquare, LayoutGrid, Scissors, ExternalLink } from 'lucide-react';
import { showToast } from '../Toast';
import { Select } from '../ui/Select';

interface HistoryItem {
    id: string;
    type: 'images' | 'videos' | 'chats' | 'workflows' | 'edit-projects';
    ownerId: string | null;
    ownerName: string;
    createdAt: string | null;
    updatedAt: string | null;
    title: string;
    prompt?: string;
    model?: string;
    url?: string | null;
    cover?: string | null;
    extra?: string;
    count?: number;
}
interface AdminUserLite { id: string; username: string; role: 'admin' | 'user' }
interface HistoryResp {
    items: HistoryItem[];
    total: number;
    hasMore: boolean;
    users: AdminUserLite[];
    typeCounts: Record<string, number>;
}

const TYPE_META: Record<HistoryItem['type'], { label: string; icon: React.ReactNode }> = {
    images: { label: '图片', icon: <ImageIcon size={13} /> },
    videos: { label: '视频', icon: <Film size={13} /> },
    chats: { label: '对话', icon: <MessageSquare size={13} /> },
    workflows: { label: '画布', icon: <LayoutGrid size={13} /> },
    'edit-projects': { label: '剪辑', icon: <Scissors size={13} /> },
};

const PAGE = 60;
// 资源 URL 是后端绝对路径(/library/...)，开发时前端跑在 5173，需要指到 3501。
const MEDIA_BASE = (typeof window !== 'undefined' && window.location.port === '5173')
    ? `${window.location.protocol}//${window.location.hostname}:3501`
    : '';

async function adminFetch(url: string) {
    const res = await fetch(url);
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

export const HistoryBrowser: React.FC = () => {
    const [resp, setResp] = useState<HistoryResp | null>(null);
    const [loading, setLoading] = useState(true);
    const [userId, setUserId] = useState('');
    const [type, setType] = useState('');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [offset, setOffset] = useState(0);

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    // 筛选条件变化时回到第一页
    useEffect(() => { setOffset(0); }, [userId, type, debouncedQ]);

    const load = useCallback(async () => {
        setLoading(true);
        try {
            const params = new URLSearchParams();
            if (userId) params.set('userId', userId);
            if (type) params.set('type', type);
            if (debouncedQ) params.set('q', debouncedQ);
            params.set('limit', String(PAGE));
            params.set('offset', String(offset));
            setResp(await adminFetch(`/api/admin/history?${params.toString()}`));
        } catch (e) {
            showToast(e instanceof Error ? e.message : '加载失败', 'error');
        } finally {
            setLoading(false);
        }
    }, [userId, type, debouncedQ, offset]);

    useEffect(() => { load(); }, [load]);

    const userOptions = useMemo(() => ([
        { value: '', label: '全部用户' },
        ...((resp?.users || []).map(u => ({ value: u.id, label: `${u.username}${u.role === 'admin' ? ' · 管理员' : ''}` }))),
    ]), [resp?.users]);

    const typeOptions = useMemo(() => ([
        { value: '', label: '全部类型' },
        ...(Object.keys(TYPE_META) as HistoryItem['type'][]).map(t => ({
            value: t,
            label: `${TYPE_META[t].label}${resp?.typeCounts?.[t] ? ` (${resp.typeCounts[t]})` : ''}`,
        })),
    ]), [resp?.typeCounts]);

    const items = resp?.items || [];
    const total = resp?.total || 0;
    const mediaUrl = (u?: string | null) => (u ? `${MEDIA_BASE}${u}` : '');

    return (
        <div className="max-w-6xl">
            <div className="flex items-center justify-between mb-1">
                <h2 className="text-lg font-semibold text-white">全部历史记录</h2>
                <button onClick={() => load()} disabled={loading}
                    className="flex items-center gap-1.5 text-xs text-neutral-400 hover:text-white px-2.5 py-1.5 rounded-lg hover:bg-neutral-900 transition-colors disabled:opacity-50">
                    <RefreshCw size={13} className={loading ? 'animate-spin' : ''} /> 刷新
                </button>
            </div>
            <p className="text-xs text-neutral-500 mb-4">浏览所有用户的生成历史 / 画布 / 对话 / 剪辑，可按用户与类型筛选。</p>

            {/* 筛选栏 */}
            <div className="flex flex-wrap items-center gap-2 mb-4">
                <Select value={userId} options={userOptions} onChange={setUserId} className="w-44" />
                <Select value={type} options={typeOptions} onChange={setType} className="w-40" />
                <div className="relative flex-1 min-w-[180px] max-w-xs">
                    <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-neutral-500" />
                    <input value={q} onChange={e => setQ(e.target.value)} placeholder="搜索标题 / 提示词 / 用户"
                        className="w-full rounded-lg bg-neutral-950 border border-neutral-700 text-sm text-neutral-200 pl-8 pr-2.5 py-1.5 outline-none focus:border-neutral-500 transition-colors" />
                </div>
                <span className="text-xs text-neutral-500 ml-auto">共 {total} 条</span>
            </div>

            {/* 列表 */}
            {loading ? (
                <div className="flex items-center justify-center py-20 text-neutral-500"><Loader2 size={24} className="animate-spin" /></div>
            ) : items.length === 0 ? (
                <div className="rounded-xl border border-dashed border-neutral-700 bg-neutral-900/50 p-12 text-center text-neutral-500 text-sm">
                    没有符合条件的历史记录
                </div>
            ) : (
                <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-3">
                    {items.map(it => {
                        const tm = TYPE_META[it.type];
                        const thumb = it.type === 'images' ? mediaUrl(it.url)
                            : it.type === 'workflows' ? mediaUrl(it.cover) : '';
                        return (
                            <div key={`${it.type}-${it.id}`}
                                className="group rounded-xl border border-neutral-800 bg-neutral-900/40 overflow-hidden flex flex-col hover:border-neutral-600 transition-colors">
                                {/* 预览区 */}
                                <div className="relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden">
                                    {it.type === 'videos' && it.url ? (
                                        <video src={mediaUrl(it.url)} className="w-full h-full object-cover" muted
                                            onMouseEnter={e => { (e.currentTarget as HTMLVideoElement).play().catch(() => {}); }}
                                            onMouseLeave={e => { const v = e.currentTarget as HTMLVideoElement; v.pause(); v.currentTime = 0; }} />
                                    ) : thumb ? (
                                        <img src={thumb} alt="" className="w-full h-full object-cover" loading="lazy" />
                                    ) : (
                                        <div className="text-neutral-700 scale-[1.9]">{tm.icon}</div>
                                    )}
                                    <span className="absolute top-1.5 left-1.5 flex items-center gap-1 px-1.5 py-0.5 rounded-md bg-black/70 text-[10px] text-neutral-200 backdrop-blur-sm">
                                        {tm.icon}{tm.label}
                                    </span>
                                    {it.url && (it.type === 'images' || it.type === 'videos') && (
                                        <a href={mediaUrl(it.url)} target="_blank" rel="noreferrer"
                                            className="absolute top-1.5 right-1.5 p-1 rounded-md bg-black/70 text-neutral-300 hover:text-white opacity-0 group-hover:opacity-100 transition-opacity backdrop-blur-sm"
                                            title="新标签打开">
                                            <ExternalLink size={12} />
                                        </a>
                                    )}
                                </div>
                                {/* 信息区 */}
                                <div className="p-2.5 flex flex-col gap-1 min-w-0">
                                    <div className="text-sm text-neutral-200 truncate" title={it.prompt || it.title}>{it.title}</div>
                                    <div className="flex items-center justify-between gap-2 text-[11px] text-neutral-500">
                                        <span className="truncate" title={`归属：${it.ownerName}`}>{it.ownerName}</span>
                                        <span className="shrink-0">{fmtDate(it.createdAt)}</span>
                                    </div>
                                    {(it.model || it.extra || it.count != null) && (
                                        <div className="text-[10px] text-neutral-600 truncate">
                                            {[it.model, it.extra,
                                                it.type === 'chats' && it.count != null ? `${it.count} 条消息`
                                                    : it.type === 'workflows' && it.count != null ? `${it.count} 个节点` : ''
                                            ].filter(Boolean).join(' · ')}
                                        </div>
                                    )}
                                </div>
                            </div>
                        );
                    })}
                </div>
            )}

            {/* 分页 */}
            {!loading && total > PAGE && (
                <div className="flex items-center justify-center gap-3 mt-6 text-sm">
                    <button disabled={offset === 0} onClick={() => setOffset(o => Math.max(0, o - PAGE))}
                        className="px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        上一页
                    </button>
                    <span className="text-neutral-500 text-xs">
                        {offset + 1}–{Math.min(offset + PAGE, total)} / {total}
                    </span>
                    <button disabled={!resp?.hasMore} onClick={() => setOffset(o => o + PAGE)}
                        className="px-3 py-1.5 rounded-lg border border-neutral-700 text-neutral-300 hover:bg-neutral-900 disabled:opacity-40 disabled:cursor-not-allowed transition-colors">
                        下一页
                    </button>
                </div>
            )}
        </div>
    );
};
