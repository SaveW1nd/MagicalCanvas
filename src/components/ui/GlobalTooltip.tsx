/**
 * GlobalTooltip.tsx — 全局 hover 提示。
 *
 * 在 root 挂载一次。委托监听任意带 `title` 属性的元素:hover 时读出 title、
 * 用 portal 浮层(fixed 定位,z 最高,不被任何 overflow-hidden 裁剪)即时显示,
 * 并临时移除原生 title 防止系统再弹一个。离开/滚动时恢复并隐藏。
 *
 * 这样全 app 所有 icon 按钮的 `title="…"` 都变成稳定、即时、统一风格的提示,
 * 无需逐个改组件。(部分环境原生 title 不渲染,这个组件兜底。)
 */
import React, { useEffect, useState, useRef } from 'react';
import { createPortal } from 'react-dom';

export const GlobalTooltip: React.FC = () => {
    const [tip, setTip] = useState<{ label: string; x: number; y: number } | null>(null);
    const current = useRef<HTMLElement | null>(null);
    const stashed = useRef<string>('');

    useEffect(() => {
        const findTitled = (start: EventTarget | null): HTMLElement | null => {
            let el = start as HTMLElement | null;
            while (el && el !== document.body) {
                if (el.nodeType === 1 && el.getAttribute && el.getAttribute('title')) return el;
                el = el.parentElement;
            }
            return null;
        };

        const restore = () => {
            if (current.current) {
                // 仅当我们临时移除过才恢复(避免覆盖期间组件重渲染设置的新值)
                if (!current.current.getAttribute('title') && stashed.current) {
                    current.current.setAttribute('title', stashed.current);
                }
                current.current = null;
                stashed.current = '';
            }
        };
        const hide = () => { restore(); setTip(null); };

        const onOver = (e: MouseEvent) => {
            const el = findTitled(e.target);
            if (!el) { if (current.current) hide(); return; }
            if (el === current.current) return;
            restore();
            const label = (el.getAttribute('title') || '').trim();
            if (!label) return;
            current.current = el;
            stashed.current = label;
            el.removeAttribute('title'); // 抑制原生延迟提示
            const r = el.getBoundingClientRect();
            setTip({ label, x: r.left + r.width / 2, y: r.top });
        };

        const onOut = (e: MouseEvent) => {
            if (!current.current) return;
            const related = e.relatedTarget as Node | null;
            if (related && current.current.contains(related)) return; // 还在元素内部
            hide();
        };

        document.addEventListener('mouseover', onOver, true);
        document.addEventListener('mouseout', onOut, true);
        window.addEventListener('scroll', hide, true);
        window.addEventListener('wheel', hide, true);
        return () => {
            restore();
            document.removeEventListener('mouseover', onOver, true);
            document.removeEventListener('mouseout', onOut, true);
            window.removeEventListener('scroll', hide, true);
            window.removeEventListener('wheel', hide, true);
        };
    }, []);

    if (!tip) return null;
    return createPortal(
        <div
            style={{ position: 'fixed', left: tip.x, top: tip.y - 8, transform: 'translate(-50%, -100%)' }}
            className="pointer-events-none z-[10000] px-2 py-1 rounded-md text-[11px] leading-none whitespace-nowrap bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-lg"
        >
            {tip.label}
        </div>,
        document.body,
    );
};
