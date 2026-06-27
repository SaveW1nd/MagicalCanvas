/**
 * SetPasswordModal.tsx — admin sets/resets a user's password.
 * 留空 = 使用默认密码 12345678（后端处理）。
 */
import React, { useState } from 'react';
import { Loader2, X } from 'lucide-react';

export const SetPasswordModal: React.FC<{
    open: boolean;
    username: string;
    onClose: () => void;
    onSubmit: (newPassword: string) => Promise<void>;
}> = ({ open, username, onClose, onSubmit }) => {
    const [pw, setPw] = useState('');
    const [busy, setBusy] = useState(false);
    const [err, setErr] = useState<string | null>(null);

    if (!open) return null;

    const close = () => { if (busy) return; setPw(''); setErr(null); onClose(); };
    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        if (pw && pw.length < 8) { setErr('密码至少 8 位'); return; }
        setBusy(true); setErr(null);
        try { await onSubmit(pw); setPw(''); onClose(); }
        catch (e) { setErr(e instanceof Error ? e.message : '设置失败'); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130]" onClick={close}>
            <form onClick={e => e.stopPropagation()} onSubmit={submit}
                className="w-full max-w-sm bg-[#1a1a1a] border border-neutral-700 rounded-2xl shadow-2xl p-6 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">设置「{username}」的密码</h3>
                    <button type="button" onClick={close} className="text-neutral-500 hover:text-white"><X size={18} /></button>
                </div>
                <input type="text" value={pw} onChange={e => setPw(e.target.value)} autoFocus placeholder="留空 = 默认 12345678"
                    className="bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60" />
                {err && <div className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">{err}</div>}
                <div className="flex justify-end gap-2 mt-1">
                    <button type="button" onClick={close} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-white disabled:opacity-50">取消</button>
                    <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50">
                        {busy && <Loader2 size={14} className="animate-spin" />}确认
                    </button>
                </div>
            </form>
        </div>
    );
};
