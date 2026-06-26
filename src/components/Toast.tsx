/**
 * Toast.tsx
 *
 * 轻量全局 toast：模块级发布/订阅，无需 Context。
 * 用法：在任意组件里 `import { showToast } from '.../Toast'; showToast('xxx', 'error')`；
 * 在 App 根部挂一个 <ToastHost />。
 */

import React, { useEffect, useState } from 'react';

type ToastType = 'error' | 'success' | 'info';
interface ToastItem { id: number; message: string; type: ToastType; }
type Listener = (items: ToastItem[]) => void;

let items: ToastItem[] = [];
let listeners: Listener[] = [];
let seq = 0;

function emit() {
    const snapshot = [...items];
    listeners.forEach(l => l(snapshot));
}

/** 弹出一条 toast，duration 毫秒后自动消失 */
export function showToast(message: string, type: ToastType = 'info', durationMs = 3000) {
    const id = ++seq;
    items = [...items, { id, message, type }];
    emit();
    setTimeout(() => {
        items = items.filter(i => i.id !== id);
        emit();
    }, durationMs);
}

export const ToastHost: React.FC = () => {
    const [list, setList] = useState<ToastItem[]>([]);
    useEffect(() => {
        const l: Listener = (next) => setList(next);
        listeners.push(l);
        return () => { listeners = listeners.filter(x => x !== l); };
    }, []);

    if (!list.length) return null;
    return (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-[200] flex flex-col items-center gap-2 pointer-events-none">
            {list.map(t => (
                <div
                    key={t.id}
                    className={`pointer-events-auto px-4 py-2 rounded-lg text-sm shadow-xl border animate-in fade-in slide-in-from-bottom-2 duration-200 ${
                        t.type === 'error'
                            ? 'bg-red-950 border-red-800 text-red-200'
                            : t.type === 'success'
                                ? 'bg-green-950 border-green-800 text-green-200'
                                : 'bg-neutral-900 border-neutral-700 text-neutral-200'
                    }`}
                >
                    {t.message}
                </div>
            ))}
        </div>
    );
};
