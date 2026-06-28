/**
 * HistoryPanel.tsx
 * 
 * Panel for browsing generated image and video history.
 * Assets are grouped by date and displayed in a grid.
 * Clicking an asset applies it to the selected node.
 * 
 * Uses infinite scroll with pagination for performance.
 */

import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Loader2, Trash2, Maximize2, Minimize2, Image as ImageIcon, Video, Plus, FolderPlus } from 'lucide-react';
import { ExpandedMediaModal } from './modals/ExpandedMediaModal';

// ============================================================================
// CONSTANTS
// ============================================================================

const PAGE_SIZE = 18; // 6 columns × 3 rows

// ============================================================================
// TYPES
// ============================================================================

interface AssetMetadata {
    id: string;
    filename: string;
    prompt: string;
    createdAt: string;
    type: string;
    url: string;
    model?: string;
}

interface HistoryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (type: 'images' | 'videos', url: string, prompt: string, model?: string) => void;
    /** 上传到素材库；返回是否成功（用于显示状态/提示） */
    onSaveToLibrary?: (type: 'images' | 'videos', url: string, prompt: string, name?: string) => Promise<boolean>;
    panelY?: number;
    canvasTheme?: 'dark' | 'light';
}

// ============================================================================
// COMPONENT
// ============================================================================

export const HistoryPanel: React.FC<HistoryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    onSaveToLibrary,
    panelY = 200,
    canvasTheme = 'dark'
}) => {
    // --- State ---
    const [activeTab, setActiveTab] = useState<'images' | 'videos'>('images');
    const [assets, setAssets] = useState<AssetMetadata[]>([]);
    const [loading, setLoading] = useState(false);
    const [loadingMore, setLoadingMore] = useState(false);
    const [hasMore, setHasMore] = useState(true);
    const [offset, setOffset] = useState(0);
    const [deleteConfirm, setDeleteConfirm] = useState<string | null>(null);
    const [imageTotalCount, setImageTotalCount] = useState<number>(0);
    const [videoTotalCount, setVideoTotalCount] = useState<number>(0);
    const [cleanConfirm, setCleanConfirm] = useState<'old' | 'all' | null>(null); // 批量清理确认
    const [isExpanded, setIsExpanded] = useState(false); // 放大：占据更大区域以看全历史

    // —— 可拖拽 + 可缩放的浮动窗口（像 PPT 里操作矩形）——
    const ZOOM_BAR_RESERVE = 96; // 底部缩放条留白，避免被遮挡
    const MIN_W = 380, MIN_H = 260, EDGE = 8;
    const [rect, setRect] = useState(() => {
        const vw = typeof window !== 'undefined' ? window.innerWidth : 1280;
        const vh = typeof window !== 'undefined' ? window.innerHeight : 800;
        const w = 700, h = 480;
        const x = 80;
        const y = Math.max(64, Math.min(panelY, vh - ZOOM_BAR_RESERVE - h));
        return { x, y, w: Math.min(w, vw - x - EDGE), h };
    });
    const preExpandRef = useRef<typeof rect | null>(null);

    /** 拖动表头移动整窗（点到按钮上则不触发，让按钮正常工作） */
    const startDrag = (e: React.PointerEvent) => {
        if ((e.target as HTMLElement).closest('button')) return;
        e.preventDefault();
        const sx = e.clientX, sy = e.clientY, orig = { ...rect };
        const onMove = (ev: PointerEvent) => {
            const vw = window.innerWidth, vh = window.innerHeight;
            const maxX = Math.max(EDGE, vw - orig.w - EDGE);
            const maxY = Math.max(56, vh - ZOOM_BAR_RESERVE - orig.h);
            const nx = Math.max(EDGE, Math.min(orig.x + (ev.clientX - sx), maxX));
            const ny = Math.max(56, Math.min(orig.y + (ev.clientY - sy), maxY));
            setRect(r => ({ ...r, x: nx, y: ny }));
        };
        const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    /** 拖右下角缩放 */
    const startResize = (e: React.PointerEvent) => {
        e.preventDefault(); e.stopPropagation();
        const sx = e.clientX, sy = e.clientY, orig = { ...rect };
        const onMove = (ev: PointerEvent) => {
            const vw = window.innerWidth, vh = window.innerHeight;
            const nw = Math.max(MIN_W, Math.min(orig.w + (ev.clientX - sx), vw - orig.x - EDGE));
            const nh = Math.max(MIN_H, Math.min(orig.h + (ev.clientY - sy), vh - ZOOM_BAR_RESERVE - orig.y));
            setRect(r => ({ ...r, w: nw, h: nh }));
        };
        const onUp = () => { document.removeEventListener('pointermove', onMove); document.removeEventListener('pointerup', onUp); };
        document.addEventListener('pointermove', onMove);
        document.addEventListener('pointerup', onUp);
    };

    /** 放大/还原：放大 = 占满可用区域（留底部缩放条），还原 = 回到放大前大小 */
    const toggleExpand = () => {
        if (isExpanded) {
            if (preExpandRef.current) setRect(preExpandRef.current);
            setIsExpanded(false);
        } else {
            preExpandRef.current = rect;
            const vw = window.innerWidth, vh = window.innerHeight;
            setRect({ x: 72, y: 64, w: Math.min(1200, vw - 144), h: vh - ZOOM_BAR_RESERVE - 64 });
            setIsExpanded(true);
        }
    };
    const [cleaning, setCleaning] = useState(false);

    // --- Refs ---
    const scrollContainerRef = useRef<HTMLDivElement>(null);
    const loadMoreTriggerRef = useRef<HTMLDivElement>(null);

    // Theme helper
    const isDark = canvasTheme === 'dark';

    // --- Fetch initial page and counts when panel opens ---
    useEffect(() => {
        if (isOpen) {
            // Reset pagination state for current tab
            setAssets([]);
            setOffset(0);
            setHasMore(true);
            fetchAssets(0, true);

            // Fetch total counts for both tabs
            fetchCounts();
        }
    }, [isOpen, activeTab]);

    /**
     * Fetch total counts for both images and videos
     */
    const fetchCounts = async () => {
        try {
            // Fetch counts in parallel
            const [imgRes, vidRes] = await Promise.all([
                fetch('/api/assets/images?limit=1'),
                fetch('/api/assets/videos?limit=1')
            ]);

            if (imgRes.ok) {
                const imgData = await imgRes.json();
                setImageTotalCount(imgData.total);
            }

            if (vidRes.ok) {
                const vidData = await vidRes.json();
                setVideoTotalCount(vidData.total);
            }
        } catch (error) {
            console.error('Failed to fetch asset counts:', error);
        }
    };

    // --- Intersection Observer for infinite scroll ---
    useEffect(() => {
        if (!loadMoreTriggerRef.current || loading) return;

        const observer = new IntersectionObserver(
            (entries) => {
                const target = entries[0];
                if (target.isIntersecting && hasMore && !loadingMore && !loading) {
                    loadMoreAssets();
                }
            },
            { threshold: 0.1, root: scrollContainerRef.current }
        );

        observer.observe(loadMoreTriggerRef.current);
        return () => observer.disconnect();
    }, [hasMore, loadingMore, loading, offset]);

    /**
     * Fetch assets with pagination
     * @param pageOffset - Offset to fetch from
     * @param isInitial - Whether this is the initial fetch (shows full loader)
     */
    const fetchAssets = async (pageOffset: number, isInitial: boolean = false) => {
        if (isInitial) {
            setLoading(true);
        } else {
            setLoadingMore(true);
        }

        try {
            const response = await fetch(
                `/api/assets/${activeTab}?limit=${PAGE_SIZE}&offset=${pageOffset}`
            );
            if (response.ok) {
                const data = await response.json();

                if (isInitial) {
                    setAssets(data.assets);
                } else {
                    setAssets(prev => [...prev, ...data.assets]);
                }

                setHasMore(data.hasMore);
                setOffset(pageOffset + data.assets.length);

                // Update total counts
                if (activeTab === 'images') {
                    setImageTotalCount(data.total);
                } else {
                    setVideoTotalCount(data.total);
                }
            }
        } catch (error) {
            console.error('Failed to fetch assets:', error);
        } finally {
            setLoading(false);
            setLoadingMore(false);
        }
    };

    /**
     * Load more assets when scrolling
     */
    const loadMoreAssets = useCallback(() => {
        if (!loadingMore && hasMore) {
            fetchAssets(offset, false);
        }
    }, [offset, loadingMore, hasMore, activeTab]);

    const handleDelete = async (id: string) => {
        try {
            const response = await fetch(`/api/assets/${activeTab}/${id}`, {
                method: 'DELETE'
            });
            if (response.ok) {
                setAssets(prev => prev.filter(a => a.id !== id));
                // Update counts
                if (activeTab === 'images') {
                    setImageTotalCount(prev => prev - 1);
                } else {
                    setVideoTotalCount(prev => prev - 1);
                }
            }
        } catch (error) {
            console.error('Failed to delete asset:', error);
        }
        setDeleteConfirm(null);
    };

    /** 批量清理当前标签页的历史：'old' = 3 天前，'all' = 全部 */
    const handleClean = async (mode: 'old' | 'all') => {
        setCleaning(true);
        try {
            const response = await fetch(`/api/assets/${activeTab}/clean`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify(mode === 'old' ? { olderThanDays: 3 } : {}),
            });
            if (response.ok) {
                // 重新拉取当前页与计数
                setAssets([]);
                setOffset(0);
                setHasMore(true);
                await fetchAssets(0, true);
                await fetchCounts();
            }
        } catch (error) {
            console.error('Failed to clean assets:', error);
        } finally {
            setCleaning(false);
            setCleanConfirm(null);
        }
    };

    const handleSelectAsset = (asset: AssetMetadata) => {
        // Construct full URL for the asset
        const fullUrl = `${asset.url}`;
        onSelectAsset(activeTab, fullUrl, asset.prompt || '', asset.model);
    };

    // 查看大图/视频
    const [previewUrl, setPreviewUrl] = useState<string | null>(null);
    // 上传到素材库（带 per-item 进行中状态）
    const [savingId, setSavingId] = useState<string | null>(null);
    const handleSaveToLibrary = async (asset: AssetMetadata) => {
        if (!onSaveToLibrary || savingId) return;
        setSavingId(asset.id);
        try {
            await onSaveToLibrary(activeTab, `${asset.url}`, asset.prompt || '');
        } finally {
            setSavingId(null);
        }
    };

    // Group assets by date
    const groupedAssets = assets.reduce((groups, asset) => {
        const date = new Date(asset.createdAt).toLocaleDateString('en-CA'); // YYYY-MM-DD format
        if (!groups[date]) {
            groups[date] = [];
        }
        groups[date].push(asset);
        return groups;
    }, {} as Record<string, AssetMetadata[]>);

    const sortedDates = Object.keys(groupedAssets).sort((a, b) =>
        new Date(b).getTime() - new Date(a).getTime()
    );

    if (!isOpen) return null;

    return (
        <>
            {/* Main Panel —— 可拖拽 + 可缩放浮动窗口 */}
            <div
                className={`fixed backdrop-blur-xl border rounded-2xl shadow-2xl z-40 flex flex-col overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a]/95 border-neutral-800' : 'bg-white/95 border-neutral-200'}`}
                style={{ left: rect.x, top: rect.y, width: rect.w, height: rect.h }}
            >
                {/* Header（拖动区） */}
                <div
                    onPointerDown={startDrag}
                    className={`flex items-center justify-between px-5 py-4 border-b cursor-move select-none ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}
                >
                    <div className="flex items-center gap-6">
                        <button
                            className={`text-sm font-medium transition-colors pb-1 flex items-center gap-2 ${activeTab === 'images'
                                ? isDark ? 'text-white border-b-2 border-white' : 'text-neutral-900 border-b-2 border-neutral-900'
                                : isDark ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-neutral-900'
                                }`}
                            onClick={() => setActiveTab('images')}
                        >
                            <ImageIcon size={16} />
                            图像历史 ({imageTotalCount})
                        </button>
                        <button
                            className={`text-sm font-medium transition-colors pb-1 flex items-center gap-2 ${activeTab === 'videos'
                                ? isDark ? 'text-white border-b-2 border-white' : 'text-neutral-900 border-b-2 border-neutral-900'
                                : isDark ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-neutral-900'
                                }`}
                            onClick={() => setActiveTab('videos')}
                        >
                            <Video size={16} />
                            视频历史 ({videoTotalCount})
                        </button>
                    </div>
                    <div className="flex items-center gap-2">
                        <button
                            onClick={() => setCleanConfirm('old')}
                            disabled={cleaning || (activeTab === 'images' ? imageTotalCount : videoTotalCount) === 0}
                            className={`px-2.5 py-1 rounded-full text-xs border transition-colors disabled:opacity-40 disabled:cursor-not-allowed ${isDark ? 'text-neutral-400 border-neutral-700 hover:text-white hover:border-neutral-500' : 'text-neutral-500 border-neutral-300 hover:text-neutral-900 hover:border-neutral-400'}`}
                            title={`清理 3 天前的${activeTab === 'images' ? '图像' : '视频'}历史`}
                        >
                            清理3天前
                        </button>
                        <button
                            onClick={() => setCleanConfirm('all')}
                            disabled={cleaning || (activeTab === 'images' ? imageTotalCount : videoTotalCount) === 0}
                            className="px-2.5 py-1 rounded-full text-xs border border-red-500/40 text-red-400 hover:bg-red-500/10 hover:border-red-500 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                            title={`清空全部${activeTab === 'images' ? '图像' : '视频'}历史`}
                        >
                            清空全部
                        </button>
                        <button
                            onClick={toggleExpand}
                            className={`ml-1 transition-colors ${isDark ? 'text-neutral-500 hover:text-white' : 'text-neutral-400 hover:text-neutral-900'}`}
                            title={isExpanded ? '还原大小' : '放大'}
                        >
                            {isExpanded ? <Minimize2 size={18} /> : <Maximize2 size={18} />}
                        </button>
                    </div>
                </div>

                {/* Content */}
                <div
                    ref={scrollContainerRef}
                    className="flex-1 overflow-y-auto p-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading ? (
                        <div className="flex items-center justify-center h-40">
                            <Loader2 className="animate-spin text-neutral-500" size={24} />
                        </div>
                    ) : assets.length === 0 ? (
                        <div className={`flex flex-col items-center justify-center h-40 ${isDark ? 'text-neutral-500' : 'text-neutral-400'}`}>
                            <div className={`w-16 h-16 rounded-full flex items-center justify-center mb-3 ${isDark ? 'bg-neutral-800' : 'bg-neutral-100'}`}>
                                {activeTab === 'images' ? <ImageIcon size={24} /> : <Video size={24} />}
                            </div>
                            <p>{activeTab === 'images' ? '未找到图像' : '未找到视频'}</p>
                            <p className="text-xs mt-1">{activeTab === 'images' ? '生成的图像会显示在这里' : '生成的视频会显示在这里'}</p>
                        </div>
                    ) : (
                        <div className="space-y-6">
                            {sortedDates.map(date => (
                                <div key={date}>
                                    <h3 className={`text-xs mb-2 ${isDark ? 'text-neutral-400' : 'text-neutral-500'}`}>{date}</h3>
                                    <div className="grid grid-cols-6 gap-2">
                                        {groupedAssets[date].map(asset => (
                                            <div
                                                key={asset.id}
                                                onClick={() => setPreviewUrl(asset.url)}
                                                className={`aspect-square rounded-lg overflow-hidden transition-all group relative cursor-pointer ${isDark ? 'bg-neutral-900' : 'bg-neutral-100'}`}
                                            >
                                                {activeTab === 'images' ? (
                                                    <img
                                                        src={`${asset.url}`}
                                                        alt={asset.prompt || '生成的图像'}
                                                        className="w-full h-full object-cover"
                                                        loading="lazy"
                                                    />
                                                ) : (
                                                    <video
                                                        src={`${asset.url}`}
                                                        className="w-full h-full object-cover"
                                                        muted
                                                        preload="metadata"
                                                        onMouseEnter={(e) => e.currentTarget.play()}
                                                        onMouseLeave={(e) => {
                                                            e.currentTarget.pause();
                                                            e.currentTarget.currentTime = 0;
                                                        }}
                                                    />
                                                )}
                                                {/* Hover 操作层加暗，让底部图标按钮更清晰 */}
                                                <div className="absolute inset-0 bg-black/30 opacity-0 group-hover:opacity-100 transition-opacity pointer-events-none" />
                                                {/* 操作按钮（图标 + hover 原生提示，风格与删除一致） */}
                                                <div className="absolute bottom-1 left-1 flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-all">
                                                    <button
                                                        onClick={(e) => { e.stopPropagation(); handleSelectAsset(asset); }}
                                                        className="p-1 bg-black/50 hover:bg-blue-500 rounded-md transition-all"
                                                        title="添加到画布"
                                                    >
                                                        <Plus size={12} className="text-white" />
                                                    </button>
                                                    {onSaveToLibrary && (
                                                        <button
                                                            onClick={(e) => { e.stopPropagation(); handleSaveToLibrary(asset); }}
                                                            disabled={savingId === asset.id}
                                                            className="p-1 bg-black/50 hover:bg-green-600 rounded-md transition-all disabled:opacity-60"
                                                            title="上传到素材库"
                                                        >
                                                            {savingId === asset.id ? <Loader2 size={12} className="animate-spin text-white" /> : <FolderPlus size={12} className="text-white" />}
                                                        </button>
                                                    )}
                                                </div>
                                                {/* Delete button（置于操作层之上） */}
                                                <button
                                                    onClick={(e) => {
                                                        e.stopPropagation();
                                                        setDeleteConfirm(asset.id);
                                                    }}
                                                    className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-500 rounded-md opacity-0 group-hover:opacity-100 transition-all z-10"
                                                    title="删除"
                                                >
                                                    <Trash2 size={12} className="text-white" />
                                                </button>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            ))}

                            {/* Load more trigger for infinite scroll */}
                            {hasMore && (
                                <div
                                    ref={loadMoreTriggerRef}
                                    className="flex items-center justify-center py-4"
                                >
                                    {loadingMore && (
                                        <Loader2 className="animate-spin text-neutral-500" size={20} />
                                    )}
                                </div>
                            )}
                        </div>
                    )}
                </div>

                {/* 右下角缩放手柄（拖拽调整大小） */}
                <div
                    onPointerDown={startResize}
                    className="absolute bottom-0 right-0 w-5 h-5 cursor-nwse-resize flex items-end justify-end p-1 group"
                    title="拖拽调整大小"
                >
                    <svg width="9" height="9" viewBox="0 0 10 10" className={isDark ? 'text-neutral-600 group-hover:text-neutral-300' : 'text-neutral-400 group-hover:text-neutral-600'} fill="currentColor">
                        <path d="M9 1 L9 9 L1 9 Z" />
                    </svg>
                </div>
            </div>

            {/* Clean Confirmation Modal */}
            {cleanConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className={`border rounded-2xl p-6 w-[360px] shadow-2xl ${isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-neutral-200'}`}>
                        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>
                            {cleanConfirm === 'old' ? '清理 3 天前的历史' : '清空全部历史'}
                        </h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            {cleanConfirm === 'old'
                                ? `将删除 3 天前生成的所有${activeTab === 'images' ? '图像' : '视频'}文件，此操作无法撤销。`
                                : `将删除全部 ${activeTab === 'images' ? imageTotalCount + ' 个图像' : videoTotalCount + ' 个视频'}文件，此操作无法撤销。`}
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setCleanConfirm(null)}
                                disabled={cleaning}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900'}`}
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleClean(cleanConfirm)}
                                disabled={cleaning}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-60"
                            >
                                {cleaning && <Loader2 size={14} className="animate-spin" />}
                                {cleanConfirm === 'old' ? '清理' : '清空'}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* Delete Confirmation Modal */}
            {deleteConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-50">
                    <div className={`border rounded-2xl p-6 w-[340px] shadow-2xl ${isDark ? 'bg-[#1a1a1a] border-neutral-700' : 'bg-white border-neutral-200'}`}>
                        <h3 className={`text-lg font-semibold mb-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>删除素材</h3>
                        <p className={`text-sm mb-6 ${isDark ? 'text-neutral-400' : 'text-neutral-600'}`}>
                            确定要删除此{activeTab === 'images' ? '图像' : '视频'}吗？此操作无法撤销。
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setDeleteConfirm(null)}
                                className={`px-4 py-2 rounded-lg text-sm transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900'}`}
                            >
                                取消
                            </button>
                            <button
                                onClick={() => handleDelete(deleteConfirm)}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors"
                            >
                                删除
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 查看大图/视频（缩放 + 平移） */}
            <ExpandedMediaModal mediaUrl={previewUrl} onClose={() => setPreviewUrl(null)} />
        </>
    );
};
