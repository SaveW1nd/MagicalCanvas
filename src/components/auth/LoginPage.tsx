/**
 * LoginPage.tsx — email/password login gate.
 */
import React, { useState } from 'react';
import { Loader2 } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export const LoginPage: React.FC = () => {
    const { login } = useAuth();
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [error, setError] = useState<string | null>(null);
    const [busy, setBusy] = useState(false);

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        setError(null);
        setBusy(true);
        try {
            await login(username.trim(), password);
        } catch (err) {
            setError(err instanceof Error ? err.message : '登录失败');
        } finally {
            setBusy(false);
        }
    };

    return (
        <div className="fixed inset-0 flex items-center justify-center bg-neutral-100 dark:bg-[#0a0a0a] text-neutral-800 dark:text-neutral-200 p-4">
            <form
                onSubmit={submit}
                className="w-full max-w-sm bg-white dark:bg-[#161616] border border-neutral-200 dark:border-neutral-800 rounded-2xl shadow-2xl p-7 flex flex-col gap-4"
            >
                <div className="flex flex-col items-center gap-2 mb-1">
                    <img src="/logo.png" alt="Magical Canvas" className="w-12 h-12 rounded-xl object-contain bg-black/20" />
                    <h1 className="text-lg font-semibold text-neutral-900 dark:text-white">魔法画布</h1>
                    <p className="text-xs text-neutral-400 dark:text-neutral-500">请登录以继续</p>
                </div>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">用户名</span>
                    <input
                        type="text"
                        autoFocus
                        value={username}
                        onChange={(e) => setUsername(e.target.value)}
                        className="bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                        placeholder="用户名"
                        required
                    />
                </label>

                <label className="flex flex-col gap-1">
                    <span className="text-xs text-neutral-500 dark:text-neutral-400">密码</span>
                    <input
                        type="password"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                        className="bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm outline-none focus:border-blue-500/60"
                        placeholder="••••••••"
                        required
                    />
                </label>

                {error && (
                    <div className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2">
                        {error}
                    </div>
                )}

                <button
                    type="submit"
                    disabled={busy}
                    className="mt-1 flex items-center justify-center gap-2 bg-white text-black font-medium rounded-lg px-4 py-2.5 text-sm hover:bg-neutral-200 transition-colors disabled:opacity-60"
                >
                    {busy ? <Loader2 size={16} className="animate-spin" /> : null}
                    登录
                </button>
            </form>
        </div>
    );
};
