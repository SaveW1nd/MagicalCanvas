/**
 * HistoryBrowser.tsx — 管理员「全部历史」(P3)。
 *
 * 跨用户浏览所有生成历史/画布/对话/剪辑，可按用户、类型、关键词筛选。只读浏览。
 * 数据来自 GET /api/admin/history（requireAdmin）。
 */
import React, { useEffect, useMemo, useState } from 'react';
import { Loader2, Search, RefreshCw, Image as ImageIcon, Film, MessageSquare, LayoutGrid, Scissors, ExternalLink, Globe, Check } from 'lucide-react';
import { showToast } from '../Toast';
import { useSWR, invalidateCache } from '../../utils/swrCache';
import { Select } from '../ui/Select';
import { Tip } from '../ui/Tip';
import { ExpandedMediaModal } from '../modals/ExpandedMediaModal';
import { WorkflowPreview } from '../canvas/WorkflowPreview';
import { RenameModal } from './RenameModal';
import { Pencil } from 'lucide-react';

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

export const HistoryBrowser: React.FC = () => {
    const [userId, setUserId] = useState('');
    const [type, setType] = useState('');
    const [q, setQ] = useState('');
    const [debouncedQ, setDebouncedQ] = useState('');
    const [offset, setOffset] = useState(0);
    const [published, setPublished] = useState<Set<string>>(new Set());
    const [publishingKey, setPublishingKey] = useState<string | null>(null);
    const [previewMedia, setPreviewMedia] = useState<string | null>(null);
    const [previewWorkflowId, setPreviewWorkflowId] = useState<string | null>(null);
    const [renameItem, setRenameItem] = useState<HistoryItem | null>(null);

    // 点卡片预览:图片/视频→放大模态,画布→只读图预览
    const openPreview = (it: HistoryItem) => {
        if ((it.type === 'images' || it.type === 'videos') && it.url) setPreviewMedia(mediaUrl(it.url));
        else if (it.type === 'workflows') setPreviewWorkflowId(it.id);
    };

    useEffect(() => {
        const t = setTimeout(() => setDebouncedQ(q.trim()), 300);
        return () => clearTimeout(t);
    }, [q]);

    // 把历史里的素材(图片/视频)发布到公共素材库,或把画布(工作流)发布到公共工作流
    const itemKey = (it: HistoryItem) => `${it.type}-${it.id}`;
    const handlePublish = async (it: HistoryItem) => {
        const k = itemKey(it);
        if (publishingKey) return;
        setPublishingKey(k);
        try {
            const isWf = it.type === 'workflows';
            const res = await fetch(isWf ? '/api/public-workflows' : '/api/admin/assets/publish', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(isWf ? { workflowId: it.id } : { type: it.type, id: it.id }),
            });
            const d = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(d.error || '发布失败');
            setPublished(prev => new Set(prev).add(k));
            // 发布到公共会影响公共工作流 / 公共素材库列表,失效相应缓存
            invalidateCache(isWf ? 'admin:public-workflows' : 'admin:assets:');
            showToast(isWf ? '已发布到公共工作流' : '已发布到公共素材库', 'success');
        } catch (e) {
            showToast(e instanceof Error ? e.message : '发布失败', 'error');
        } finally {
            setPublishingKey(null);
        }
    };

    // 筛选条件变化时回到第一页
    useEffect(() => { setOffset(0); }, [userId, type, debouncedQ]);

    const params = useMemo(() => {
        const p = new URLSearchParams();
        if (userId) p.set('userId', userId);
        if (type) p.set('type', type);
        if (debouncedQ) p.set('q', debouncedQ);
        p.set('limit', String(PAGE));
        p.set('offset', String(offset));
        return p;
    }, [userId, type, debouncedQ, offset]);

    const histKey = `admin:history:${params.toString()}`;
    const { data: resp, loading, refetch: refetchHist } = useSWR<HistoryResp>(histKey, () => adminFetch(`/api/admin/history?${params.toString()}`));
    const load = refetchHist;

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
                                <div
                                    className={`relative aspect-video bg-neutral-950 flex items-center justify-center overflow-hidden ${(it.type === 'images' || it.type === 'videos' || it.type === 'workflows') ? 'cursor-pointer' : ''}`}
                                    onClick={() => openPreview(it)}
                                >
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
                                    <div className="absolute top-1.5 right-1.5 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity" onClick={e => e.stopPropagation()}>
                                        {/* 重命名 */}
                                        <Tip label="重命名">
                                            <button onClick={(e) => { e.stopPropagation(); setRenameItem(it); }}
                                                className="p-1 rounded-md bg-black/70 text-neutral-300 hover:text-white backdrop-blur-sm transition-colors">
                                                <Pencil size={12} />
                                            </button>
                                        </Tip>
                                        {/* 发布到公共(图片/视频→公共素材库;画布→公共工作流) */}
                                        {(it.type === 'images' || it.type === 'videos' || it.type === 'workflows') && (
                                            published.has(itemKey(it)) ? (
                                                <Tip label="已发布到公共">
                                                    <span className="p-1 rounded-md bg-green-600/80 text-white backdrop-blur-sm"><Check size={12} /></span>
                                                </Tip>
                                            ) : (
                                                <Tip label={it.type === 'workflows' ? '发布到公共工作流' : '发布到公共素材库'}>
                                                    <button onClick={() => handlePublish(it)} disabled={publishingKey === itemKey(it)}
                                                        className="p-1 rounded-md bg-black/70 text-neutral-300 hover:text-white hover:bg-green-600/80 backdrop-blur-sm transition-colors disabled:opacity-50">
                                                        {publishingKey === itemKey(it) ? <Loader2 size={12} className="animate-spin" /> : <Globe size={12} />}
                                                    </button>
                                                </Tip>
                                            )
                                        )}
                                        {it.url && (it.type === 'images' || it.type === 'videos') && (
                                            <Tip label="新标签打开">
                                                <a href={mediaUrl(it.url)} target="_blank" rel="noreferrer"
                                                    className="block p-1 rounded-md bg-black/70 text-neutral-300 hover:text-white backdrop-blur-sm">
                                                    <ExternalLink size={12} />
                                                </a>
                                            </Tip>
                                        )}
                                    </div>
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

            {/* 预览:图片/视频放大、画布只读图 */}
            <ExpandedMediaModal mediaUrl={previewMedia} onClose={() => setPreviewMedia(null)} />
            {previewWorkflowId && (
                <WorkflowPreview
                    fetchUrl={`/api/admin/workflows/${previewWorkflowId}`}
                    onClose={() => setPreviewWorkflowId(null)}
                />
            )}

            <RenameModal open={!!renameItem} initial={renameItem?.title || ''} label="标题"
                onClose={() => setRenameItem(null)}
                onSave={async (title) => {
                    if (!renameItem) return;
                    await adminFetch(`/api/admin/history/${renameItem.type}/${renameItem.id}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
                    invalidateCache('admin:history:'); refetchHist();
                }} />
        </div>
    );
};
