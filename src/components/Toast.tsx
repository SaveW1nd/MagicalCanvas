/**
 * Toast.tsx — 右上角悬浮通知（右侧滑入 + 进度条 + 自动滑出消失）。
 * 自适应宽度（贴合内容，超过上限换行）。滑入用核心 transition 实现，不依赖动画插件。
 * 用法：showToast('xxx', 'success')；根部挂 <ToastHost />。
 */
import React, { useEffect, useState } from 'react';
import { CheckCircle2, XCircle, AlertTriangle, Info, X } from 'lucide-react';

type ToastType = 'success' | 'error' | 'warning' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; duration: number; leaving?: boolean; }
type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: Listener[] = [];
let seq = 0;

function emit() { const snap = [...items]; listeners.forEach(l => l(snap)); }
function remove(id: number) { items = items.filter(i => i.id !== id); emit(); }
function startLeave(id: number) {
    if (!items.some(i => i.id === id && !i.leaving)) return;
    items = items.map(i => (i.id === id ? { ...i, leaving: true } : i));
    emit();
    setTimeout(() => remove(id), 320); // 等滑出动画结束
}

/** 弹一条 toast：duration 毫秒后自动滑出消失 */
export function showToast(message: string, type: ToastType = 'info', durationMs = 4000) {
    const id = ++seq;
    items = [...items, { id, message, type, duration: durationMs }];
    emit();
    setTimeout(() => startLeave(id), durationMs);
}

const STYLES: Record<ToastType, { border: string; icon: string; bar: string; Icon: React.ComponentType<{ size?: number; className?: string }> }> = {
    success: { border: 'border-l-green-500', icon: 'text-green-400', bar: 'bg-green-500', Icon: CheckCircle2 },
    error: { border: 'border-l-red-500', icon: 'text-red-400', bar: 'bg-red-500', Icon: XCircle },
    warning: { border: 'border-l-amber-500', icon: 'text-amber-400', bar: 'bg-amber-500', Icon: AlertTriangle },
    info: { border: 'border-l-blue-500', icon: 'text-blue-400', bar: 'bg-blue-500', Icon: Info },
};

const ToastCard: React.FC<{ t: ToastItem }> = ({ t }) => {
    const [shown, setShown] = useState(false);
    useEffect(() => {
        const r = requestAnimationFrame(() => setShown(true)); // 下一帧触发进入动画
        return () => cancelAnimationFrame(r);
    }, []);
    const s = STYLES[t.type];
    const Ic = s.Icon;
    const off = t.leaving || !shown; // 进入前/离开时移到右侧外+透明
    return (
        <div
            className={`pointer-events-auto w-fit max-w-[min(90vw,380px)] overflow-hidden rounded-lg shadow-2xl bg-neutral-900 border-neutral-800 border border-l-4 ${s.border} transition-all duration-300 ease-out ${off ? 'opacity-0 translate-x-[120%]' : 'opacity-100 translate-x-0'}`}
        >
            <div className="px-3 py-2.5 flex items-center gap-2.5">
                <Ic size={18} className={`shrink-0 ${s.icon}`} />
                <p className="min-w-0 flex-1 text-sm text-neutral-200 leading-snug break-words">{t.message}</p>
                <button
                    onClick={() => startLeave(t.id)}
                    className="-mr-1 p-1 shrink-0 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                    aria-label="关闭"
                >
                    <X size={14} />
                </button>
            </div>
            {t.duration > 0 && !t.leaving && (
                <div className="h-0.5 bg-neutral-800/60">
                    <div className={`h-full ${s.bar}`} style={{ animation: `mcToastBar ${t.duration}ms linear forwards` }} />
                </div>
            )}
        </div>
    );
};

export const ToastHost: React.FC = () => {
    const [list, setList] = useState<ToastItem[]>([]);
    useEffect(() => {
        const l: Listener = (next) => setList(next);
        listeners.push(l);
        return () => { listeners = listeners.filter(x => x !== l); };
    }, []);

    if (!list.length) return null;
    return (
        <div className="pointer-events-none fixed top-4 right-4 z-[200] flex flex-col items-end gap-2.5">
            <style>{'@keyframes mcToastBar{from{width:100%}to{width:0%}}'}</style>
            {list.map(t => <ToastCard key={t.id} t={t} />)}
        </div>
    );
};
