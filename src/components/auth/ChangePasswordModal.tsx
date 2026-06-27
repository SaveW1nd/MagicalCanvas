/**
 * ChangePasswordModal.tsx — current user changes their own password.
 */
import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';

export const ChangePasswordModal: React.FC<{ isOpen: boolean; onClose: () => void }> = ({ isOpen, onClose }) => {
    const [current, setCurrent] = useState('');
    const [next, setNext] = useState('');
    const [confirm, setConfirm] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [ok, setOk] = useState(false);
    const [busy, setBusy] = useState(false);

    if (!isOpen) return null;

    const reset = () => { setCurrent(''); setNext(''); setConfirm(''); setError(null); setOk(false); };
    const close = () => { reset(); onClose(); };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError(null);
        if (next !== confirm) { setError('两次输入的新密码不一致'); return; }
        if (next.length < 8) { setError('新密码至少 8 位'); return; }
        setBusy(true);
        try {
            const res = await fetch('/api/auth/change-password', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ currentPassword: current, newPassword: next }),
            });
            const data = await res.json().catch(() => ({}));
            if (!res.ok) throw new Error(data.error || '修改失败');
            setOk(true);
            setTimeout(close, 1200);
        } catch (err) {
            setError(err instanceof Error ? err.message : '修改失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120]" onClick={close}>
            <form
                onClick={(e) => e.stopPropagation()}
                onSubmit={submit}
                className="w-full max-w-sm bg-[#1a1a1a] border border-neutral-700 rounded-2xl shadow-2xl p-6 flex flex-col gap-3"
            >
                <div className="flex items-center justify-between mb-1">
                    <h3 className="text-base font-semibold text-white">修改密码</h3>
                    <button type="button" onClick={close} className="text-neutral-500 hover:text-white"><X size={18} /></button>
                </div>
                <input type="password" value={current} onChange={(e) => setCurrent(e.target.value)} placeholder="当前密码"
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60" required />
                <input type="password" value={next} onChange={(e) => setNext(e.target.value)} placeholder="新密码（至少 8 位）"
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60" required />
                <input type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} placeholder="确认新密码"
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60" required />
                {error && <div className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">{error}</div>}
                {ok && <div className="text-xs text-green-300 bg-green-950/50 border border-green-900 rounded-lg px-3 py-2">已修改</div>}
                <button type="submit" disabled={busy}
                    className="mt-1 flex items-center justify-center gap-2 bg-blue-600 hover:bg-blue-500 text-white font-medium rounded-lg px-4 py-2.5 text-sm transition-colors disabled:opacity-60">
                    {busy ? <Loader2 size={16} className="animate-spin" /> : null}确认修改
                </button>
            </form>
        </div>
    );
};
