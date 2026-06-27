/**
 * ConfirmDialog.tsx — generic confirm modal for destructive/important actions.
 */
import React from 'react';
import { Loader2 } from 'lucide-react';

export const ConfirmDialog: React.FC<{
    open: boolean;
    title: string;
    message?: string;
    confirmText?: string;
    danger?: boolean;
    loading?: boolean;
    onConfirm: () => void;
    onClose: () => void;
}> = ({ open, title, message, confirmText = '确定', danger, loading, onConfirm, onClose }) => {
    if (!open) return null;
    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130]" onClick={loading ? undefined : onClose}>
            <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-[#1a1a1a] border border-neutral-700 rounded-2xl shadow-2xl p-6">
                <h3 className="text-base font-semibold text-white mb-2">{title}</h3>
                {message && <p className="text-sm text-neutral-400 mb-5 whitespace-pre-wrap">{message}</p>}
                <div className="flex justify-end gap-2">
                    <button onClick={onClose} disabled={loading}
                        className="px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-white transition-colors disabled:opacity-50">取消</button>
                    <button onClick={onConfirm} disabled={loading}
                        className={`px-3 py-1.5 rounded-lg text-sm text-white flex items-center gap-1.5 transition-colors disabled:opacity-50 ${danger ? 'bg-red-600 hover:bg-red-500' : 'bg-blue-600 hover:bg-blue-500'}`}>
                        {loading && <Loader2 size={14} className="animate-spin" />}{confirmText}
                    </button>
                </div>
            </div>
        </div>
    );
};
