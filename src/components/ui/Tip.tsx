/**
 * Tip.tsx — lightweight hover tooltip.
 * Renders into a body-level portal with fixed positioning so it floats above
 * everything (never clipped by parents with overflow-hidden, e.g. tables/cards).
 */
import React, { useRef, useState, useCallback } from 'react';
import { createPortal } from 'react-dom';

export const Tip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => {
    const ref = useRef<HTMLSpanElement>(null);
    const [pos, setPos] = useState<{ x: number; y: number } | null>(null);

    const show = useCallback(() => {
        const el = ref.current;
        if (!el) return;
        const r = el.getBoundingClientRect();
        setPos({ x: r.left + r.width / 2, y: r.top });
    }, []);
    const hide = useCallback(() => setPos(null), []);

    return (
        <span ref={ref} className="relative inline-flex" onMouseEnter={show} onMouseLeave={hide} onClick={hide}>
            {children}
            {pos && createPortal(
                <span
                    style={{ position: 'fixed', left: pos.x, top: pos.y - 6, transform: 'translate(-50%, -100%)' }}
                    className="pointer-events-none z-[9999] px-2 py-1 rounded-md text-[11px] whitespace-nowrap bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-lg"
                >
                    {label}
                </span>,
                document.body,
            )}
        </span>
    );
};
