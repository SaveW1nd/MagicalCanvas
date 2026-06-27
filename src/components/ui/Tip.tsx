/**
 * Tip.tsx — lightweight hover tooltip (appears above the wrapped element).
 */
import React from 'react';

export const Tip: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <span className="relative inline-flex group/tip">
        {children}
        <span className="pointer-events-none absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md text-[11px] whitespace-nowrap bg-neutral-800 text-neutral-100 border border-neutral-700 shadow-lg opacity-0 group-hover/tip:opacity-100 transition-opacity duration-150 z-50">
            {label}
        </span>
    </span>
);
