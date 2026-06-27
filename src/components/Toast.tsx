/**
 * Toast.tsx — 右上角悬浮通知（滑入 + 进度条 + 自动消失），模块级发布订阅，无需 Context。
 * 结构参考 Wei-Shaw/sub2api 的 Toast.vue，配色换成本项目深色风格。
 * 用法：showToast('xxx', 'success')；在根部挂 <ToastHost />。
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
    items = items.map(i => (i.id === id ? { ...i, leaving: true } : i));
    emit();
    setTimeout(() => remove(id), 200);
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

export const ToastHost: React.FC = () => {
    const [list, setList] = useState<ToastItem[]>([]);
    useEffect(() => {
        const l: Listener = (next) => setList(next);
        listeners.push(l);
        return () => { listeners = listeners.filter(x => x !== l); };
    }, []);

    if (!list.length) return null;
    return (
        <div className="pointer-events-none fixed top-4 right-4 z-[200] flex flex-col gap-3 w-[min(92vw,360px)]">
            <style>{'@keyframes mcToastBar{from{width:100%}to{width:0%}}'}</style>
            {list.map(t => {
                const s = STYLES[t.type];
                const Ic = s.Icon;
                return (
                    <div
                        key={t.id}
                        className={`pointer-events-auto overflow-hidden rounded-lg shadow-2xl bg-neutral-900 border border-neutral-800 border-l-4 ${s.border} ${t.leaving ? 'animate-out fade-out slide-out-to-right-5 duration-200' : 'animate-in fade-in slide-in-from-right-5 duration-300'}`}
                    >
                        <div className="p-3 flex items-start gap-2.5">
                            <Ic size={18} className={`mt-0.5 shrink-0 ${s.icon}`} />
                            <p className="min-w-0 flex-1 text-sm text-neutral-200 leading-relaxed break-words">{t.message}</p>
                            <button
                                onClick={() => startLeave(t.id)}
                                className="-m-1 p-1 shrink-0 rounded text-neutral-500 hover:text-neutral-200 hover:bg-neutral-800 transition-colors"
                                aria-label="关闭"
                            >
                                <X size={14} />
                            </button>
                        </div>
                        {t.duration > 0 && !t.leaving && (
                            <div className="h-0.5 bg-neutral-800">
                                <div className={`h-full ${s.bar}`} style={{ animation: `mcToastBar ${t.duration}ms linear forwards` }} />
                            </div>
                        )}
                    </div>
                );
            })}
        </div>
    );
};
