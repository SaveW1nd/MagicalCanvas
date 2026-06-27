/**
 * Select — custom themed dropdown (replaces native <select>, which renders an
 * un-themable OS popup that looks wrong in dark mode).
 * Light/dark via Tailwind `dark:` variants. Closes on outside-click / Esc.
 */
import React, { useEffect, useRef, useState } from 'react';
import { ChevronDown, Check } from 'lucide-react';

export interface SelectOption { value: string; label: string }

export const Select: React.FC<{
    value: string;
    options: SelectOption[];
    onChange: (value: string) => void;
    className?: string;
    placeholder?: string;
}> = ({ value, options, onChange, className = '', placeholder = '请选择' }) => {
    const [open, setOpen] = useState(false);
    const ref = useRef<HTMLDivElement>(null);
    const current = options.find(o => o.value === value);

    useEffect(() => {
        if (!open) return;
        const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
        const onEsc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false); };
        document.addEventListener('mousedown', onDoc);
        document.addEventListener('keydown', onEsc);
        return () => { document.removeEventListener('mousedown', onDoc); document.removeEventListener('keydown', onEsc); };
    }, [open]);

    return (
        <div ref={ref} className={`relative ${className}`}>
            <button
                type="button"
                onClick={() => setOpen(o => !o)}
                className="w-full flex items-center justify-between gap-2 rounded-lg px-2.5 py-1.5 text-sm outline-none transition-colors
                           bg-white border border-neutral-300 text-neutral-800 hover:border-neutral-400
                           dark:bg-neutral-950 dark:border-neutral-700 dark:text-neutral-200 dark:hover:border-neutral-600"
            >
                <span className={current ? '' : 'text-neutral-400 dark:text-neutral-500'}>{current ? current.label : placeholder}</span>
                <ChevronDown size={14} className={`shrink-0 opacity-60 transition-transform ${open ? 'rotate-180' : ''}`} />
            </button>
            {open && (
                <div className="absolute z-[200] mt-1 w-full max-h-60 overflow-y-auto rounded-lg shadow-xl border py-1
                                bg-white border-neutral-200
                                dark:bg-neutral-900 dark:border-neutral-700">
                    {options.map(o => (
                        <button
                            key={o.value}
                            type="button"
                            onClick={() => { onChange(o.value); setOpen(false); }}
                            className={`w-full flex items-center justify-between px-3 py-1.5 text-sm text-left transition-colors
                                        hover:bg-neutral-100 dark:hover:bg-neutral-800
                                        ${o.value === value ? 'text-blue-600 dark:text-blue-400' : 'text-neutral-700 dark:text-neutral-300'}`}
                        >
                            {o.label}
                            {o.value === value && <Check size={14} />}
                        </button>
                    ))}
                </div>
            )}
        </div>
    );
};
