/**
 * WorkflowPreview.tsx — 公共工作流「只读预览」。
 *
 * 不复用主画布(其表面内联在 App.tsx、CanvasNode 交互过重),改为自包含的轻量
 * 只读渲染:固定尺寸节点卡按 node.x/node.y 摆位、SVG 自绘 parent→child 连线,
 * 支持只读 pan/zoom。底部「复制到我的工作流并编辑」→ fork → 回调加载副本。
 */
import React, { useEffect, useMemo, useRef, useState } from 'react';
import { X, Loader2, GitFork, Image as ImageIcon, Film, Type as TypeIcon, Layers } from 'lucide-react';
import { showToast } from '../Toast';

const NODE_W = 200;
const NODE_H = 130;

// 开发环境(5173)资源指向后端 3501
const MEDIA_BASE = (typeof window !== 'undefined' && window.location.port === '5173')
    ? `${window.location.protocol}//${window.location.hostname}:3501`
    : '';
const mediaUrl = (u?: string) => (u && u.startsWith('/library/') ? `${MEDIA_BASE}${u}` : (u || ''));

interface PreviewNode {
    id: string;
    type?: string;
    title?: string;
    x: number;
    y: number;
    resultUrl?: string;
    prompt?: string;
    parentIds?: string[];
}

async function apiFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export const WorkflowPreview: React.FC<{
    fetchUrl: string;                                  // GET 返回 { title, nodes } 的端点
    onClose: () => void;
    fork?: { publicId: string; onForked: (newWorkflowId: string) => void }; // 提供则显示「复制到我的工作流」
    badge?: string;                                    // 头部徽标(如「公共」);不传则不显示
}> = ({ fetchUrl, onClose, fork, badge }) => {
    const [loading, setLoading] = useState(true);
    const [title, setTitle] = useState('');
    const [nodes, setNodes] = useState<PreviewNode[]>([]);
    const [forking, setForking] = useState(false);
    const [view, setView] = useState({ x: 0, y: 0, zoom: 1 });
    const stageRef = useRef<HTMLDivElement>(null);
    const drag = useRef<{ sx: number; sy: number; ox: number; oy: number } | null>(null);

    useEffect(() => {
        let alive = true;
        setLoading(true);
        apiFetch(fetchUrl)
            .then(wf => {
                if (!alive) return;
                setTitle(wf.title || '未命名');
                setNodes(Array.isArray(wf.nodes) ? wf.nodes : []);
            })
            .catch(e => { if (alive) showToast(e instanceof Error ? e.message : '加载失败', 'error'); })
            .finally(() => { if (alive) setLoading(false); });
        return () => { alive = false; };
    }, [fetchUrl]);

    // 内容包围盒
    const bbox = useMemo(() => {
        if (nodes.length === 0) return null;
        let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
        for (const n of nodes) {
            minX = Math.min(minX, n.x); minY = Math.min(minY, n.y);
            maxX = Math.max(maxX, n.x + NODE_W); maxY = Math.max(maxY, n.y + NODE_H);
        }
        return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    }, [nodes]);

    // 首次/数据变化时 fit-to-content
    useEffect(() => {
        if (!bbox || !stageRef.current) return;
        const { clientWidth: cw, clientHeight: ch } = stageRef.current;
        const zoom = Math.min(cw / (bbox.w + 120), ch / (bbox.h + 120), 1);
        const x = (cw - bbox.w * zoom) / 2 - bbox.minX * zoom;
        const y = (ch - bbox.h * zoom) / 2 - bbox.minY * zoom;
        setView({ x, y, zoom });
    }, [bbox]);

    const onWheel = (e: React.WheelEvent) => {
        e.stopPropagation();
        const factor = e.deltaY < 0 ? 1.1 : 1 / 1.1;
        setView(v => ({ ...v, zoom: Math.min(2, Math.max(0.1, v.zoom * factor)) }));
    };
    const onDown = (e: React.MouseEvent) => { drag.current = { sx: e.clientX, sy: e.clientY, ox: view.x, oy: view.y }; };
    const onMove = (e: React.MouseEvent) => {
        if (!drag.current) return;
        setView(v => ({ ...v, x: drag.current!.ox + (e.clientX - drag.current!.sx), y: drag.current!.oy + (e.clientY - drag.current!.sy) }));
    };
    const onUp = () => { drag.current = null; };

    const handleFork = async () => {
        if (forking || !fork) return;
        setForking(true);
        try {
            const r = await apiFetch('/api/workflows/fork', {
                method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ publicId: fork.publicId }),
            });
            showToast('已复制到我的工作流', 'success');
            fork.onForked(r.id);
        } catch (e) {
            showToast(e instanceof Error ? e.message : '复制失败', 'error');
        } finally {
            setForking(false);
        }
    };

    const nodeById = useMemo(() => new Map(nodes.map(n => [n.id, n])), [nodes]);
    const typeIcon = (t?: string) => {
        const s = String(t || '').toLowerCase();
        if (s.includes('video')) return <Film size={20} />;
        if (s.includes('text')) return <TypeIcon size={20} />;
        if (s.includes('image')) return <ImageIcon size={20} />;
        return <Layers size={20} />;
    };

    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 backdrop-blur-sm p-6" onClick={onClose}>
            <div
                className="w-full max-w-5xl h-[80vh] flex flex-col bg-[#0a0a0a] border border-neutral-800 rounded-2xl shadow-2xl overflow-hidden"
                onClick={e => e.stopPropagation()}
            >
                {/* Header */}
                <div className="flex items-center justify-between px-5 h-14 border-b border-neutral-800 shrink-0">
                    <div className="flex items-center gap-2 min-w-0">
                        {badge && <span className="px-1.5 py-0.5 rounded bg-green-600/80 text-white text-[10px]">{badge}</span>}
                        <h2 className="text-white font-medium truncate">{title || '工作流预览'}</h2>
                        <span className="text-neutral-500 text-xs shrink-0">· 只读预览</span>
                    </div>
                    <button onClick={onClose} className="p-1.5 rounded-lg text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors">
                        <X size={18} />
                    </button>
                </div>

                {/* Stage */}
                <div
                    ref={stageRef}
                    className="relative flex-1 overflow-hidden bg-[#0d0d0d] cursor-grab active:cursor-grabbing select-none"
                    onWheel={onWheel}
                    onMouseDown={onDown}
                    onMouseMove={onMove}
                    onMouseUp={onUp}
                    onMouseLeave={onUp}
                    style={{
                        backgroundImage: 'radial-gradient(rgba(255,255,255,0.05) 1px, transparent 1px)',
                        backgroundSize: '24px 24px',
                    }}
                >
                    {loading ? (
                        <div className="absolute inset-0 flex items-center justify-center text-neutral-500"><Loader2 size={26} className="animate-spin" /></div>
                    ) : nodes.length === 0 ? (
                        <div className="absolute inset-0 flex items-center justify-center text-neutral-500 text-sm">该工作流没有节点</div>
                    ) : (
                        <div style={{ transform: `translate(${view.x}px, ${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0', position: 'absolute', inset: 0, pointerEvents: 'none' }}>
                            {/* 连线 */}
                            <svg className="absolute overflow-visible" style={{ left: 0, top: 0 }} width={1} height={1}>
                                {nodes.flatMap(n => (n.parentIds || []).map(pid => {
                                    const p = nodeById.get(pid);
                                    if (!p) return null;
                                    const x1 = p.x + NODE_W, y1 = p.y + NODE_H / 2;
                                    const x2 = n.x, y2 = n.y + NODE_H / 2;
                                    const dx = Math.max(40, Math.abs(x2 - x1) / 2);
                                    return (
                                        <path key={`${pid}-${n.id}`} d={`M ${x1} ${y1} C ${x1 + dx} ${y1}, ${x2 - dx} ${y2}, ${x2} ${y2}`}
                                            fill="none" stroke="rgba(255,255,255,0.25)" strokeWidth={2} />
                                    );
                                }))}
                            </svg>
                            {/* 节点卡 */}
                            {nodes.map(n => (
                                <div key={n.id} className="absolute rounded-xl border border-neutral-700 bg-neutral-900 overflow-hidden flex flex-col"
                                    style={{ left: n.x, top: n.y, width: NODE_W, height: NODE_H }}>
                                    <div className="flex-1 bg-neutral-950 flex items-center justify-center overflow-hidden">
                                        {n.resultUrl && /\.(mp4|webm|mov)(\?|$)/i.test(n.resultUrl) ? (
                                            <video src={mediaUrl(n.resultUrl)} className="w-full h-full object-cover" muted />
                                        ) : n.resultUrl ? (
                                            <img src={mediaUrl(n.resultUrl)} alt="" className="w-full h-full object-cover" loading="lazy" />
                                        ) : (
                                            <div className="text-neutral-600">{typeIcon(n.type)}</div>
                                        )}
                                    </div>
                                    <div className="px-2 py-1 border-t border-neutral-800 flex items-center gap-1 shrink-0">
                                        <span className="text-neutral-500">{typeIcon(n.type)}</span>
                                        <span className="text-[11px] text-neutral-300 truncate">{n.title || n.type || '节点'}</span>
                                    </div>
                                </div>
                            ))}
                        </div>
                    )}
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between px-5 h-16 border-t border-neutral-800 shrink-0">
                    <span className="text-xs text-neutral-500">{nodes.length} 个节点 · 滚轮缩放 / 拖拽平移</span>
                    {fork ? (
                        <button
                            onClick={handleFork}
                            disabled={forking || loading}
                            className="flex items-center gap-2 px-4 py-2 rounded-lg bg-white text-black text-sm font-medium hover:bg-neutral-200 transition-colors disabled:opacity-50"
                        >
                            {forking ? <Loader2 size={15} className="animate-spin" /> : <GitFork size={15} />}
                            复制到我的工作流并编辑
                        </button>
                    ) : (
                        <button onClick={onClose} className="px-4 py-2 rounded-lg border border-neutral-700 text-neutral-300 text-sm hover:bg-neutral-800 transition-colors">关闭</button>
                    )}
                </div>
            </div>
        </div>
    );
};
