/**
 * UserManagement.tsx — admin user CRUD (list / create / role / disable / reset pw / delete).
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Loader2, UserPlus, Trash2, KeyRound, ShieldCheck, ShieldOff, Ban, CheckCircle2 } from 'lucide-react';

interface AdminUser {
    id: string;
    email: string;
    username: string;
    role: 'admin' | 'user';
    status: 'active' | 'disabled';
    createdAt: string;
    lastLoginAt?: string | null;
}

async function adminFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export const UserManagement: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
    const [users, setUsers] = useState<AdminUser[]>([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    // create form
    const [email, setEmail] = useState('');
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'user' | 'admin'>('user');
    const [creating, setCreating] = useState(false);

    const load = useCallback(async () => {
        setLoading(true); setError(null);
        try { setUsers((await adminFetch('/api/admin/users')).users); }
        catch (e) { setError(e instanceof Error ? e.message : '加载失败'); }
        finally { setLoading(false); }
    }, []);

    useEffect(() => { load(); }, [load]);

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        if (creating) return;
        setCreating(true); setError(null);
        try {
            await adminFetch('/api/admin/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ email: email.trim(), username: username.trim(), password, role }),
            });
            setEmail(''); setUsername(''); setPassword(''); setRole('user');
            await load();
        } catch (e) { setError(e instanceof Error ? e.message : '创建失败'); }
        finally { setCreating(false); }
    };

    const act = async (fn: () => Promise<unknown>) => {
        setError(null);
        try { await fn(); await load(); }
        catch (e) { setError(e instanceof Error ? e.message : '操作失败'); }
    };

    const toggleRole = (u: AdminUser) => act(() => adminFetch(`/api/admin/users/${u.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }),
    }));
    const toggleStatus = (u: AdminUser) => act(() => adminFetch(`/api/admin/users/${u.id}`, {
        method: 'PUT', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: u.status === 'active' ? 'disabled' : 'active' }),
    }));
    const resetPw = (u: AdminUser) => {
        const np = window.prompt(`为 ${u.email} 设置新密码（至少 8 位）`);
        if (!np) return;
        act(() => adminFetch(`/api/admin/users/${u.id}/reset-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ newPassword: np }),
        }).then(() => window.alert('密码已重置')));
    };
    const del = (u: AdminUser) => {
        if (!window.confirm(`确认删除用户 ${u.email}？该用户的数据归属仍保留在磁盘。`)) return;
        act(() => adminFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' }));
    };

    return (
        <div className="max-w-4xl">
            <h2 className="text-lg font-semibold text-white mb-4">用户管理</h2>

            {/* Create */}
            <form onSubmit={create} className="flex flex-wrap items-end gap-2 mb-5 p-3 rounded-xl bg-neutral-900 border border-neutral-800">
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">邮箱</span>
                    <input type="email" required value={email} onChange={e => setEmail(e.target.value)} placeholder="user@local"
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60 w-48" />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">用户名</span>
                    <input value={username} onChange={e => setUsername(e.target.value)} placeholder="（可选）"
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60 w-32" />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">密码(≥8)</span>
                    <input type="text" required value={password} onChange={e => setPassword(e.target.value)} placeholder="初始密码"
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60 w-36" />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">角色</span>
                    <select value={role} onChange={e => setRole(e.target.value as 'user' | 'admin')}
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60">
                        <option value="user">普通用户</option>
                        <option value="admin">管理员</option>
                    </select>
                </div>
                <button type="submit" disabled={creating}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3 py-1.5 transition-colors disabled:opacity-60">
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} 新建用户
                </button>
            </form>

            {error && <div className="text-xs text-red-300 bg-red-950/50 border border-red-900 rounded-lg px-3 py-2 mb-3">{error}</div>}

            {/* Table */}
            {loading ? (
                <div className="flex items-center gap-2 text-neutral-500 text-sm py-8"><Loader2 size={16} className="animate-spin" /> 加载中…</div>
            ) : (
                <div className="rounded-xl border border-neutral-800 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-neutral-900 text-neutral-400 text-xs">
                            <tr>
                                <th className="text-left font-medium px-3 py-2">用户</th>
                                <th className="text-left font-medium px-3 py-2">角色</th>
                                <th className="text-left font-medium px-3 py-2">状态</th>
                                <th className="text-left font-medium px-3 py-2">最近登录</th>
                                <th className="text-right font-medium px-3 py-2">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t border-neutral-800 text-neutral-200">
                                    <td className="px-3 py-2">
                                        <div className="font-medium">{u.username || u.email.split('@')[0]}{u.id === currentUserId && <span className="ml-1 text-[10px] text-blue-400">(我)</span>}</div>
                                        <div className="text-[11px] text-neutral-500">{u.email}</div>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={u.role === 'admin' ? 'text-amber-400' : 'text-neutral-400'}>{u.role === 'admin' ? '管理员' : '普通用户'}</span>
                                    </td>
                                    <td className="px-3 py-2">
                                        <span className={u.status === 'active' ? 'text-green-400' : 'text-red-400'}>{u.status === 'active' ? '正常' : '已禁用'}</span>
                                    </td>
                                    <td className="px-3 py-2 text-[11px] text-neutral-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                                    <td className="px-3 py-2">
                                        <div className="flex items-center justify-end gap-1">
                                            <button onClick={() => toggleRole(u)} title={u.role === 'admin' ? '降为普通用户' : '升为管理员'}
                                                className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                {u.role === 'admin' ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                                            </button>
                                            <button onClick={() => toggleStatus(u)} title={u.status === 'active' ? '禁用' : '启用'}
                                                className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                {u.status === 'active' ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                                            </button>
                                            <button onClick={() => resetPw(u)} title="重置密码"
                                                className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white"><KeyRound size={15} /></button>
                                            <button onClick={() => del(u)} disabled={u.id === currentUserId} title={u.id === currentUserId ? '不能删除自己' : '删除'}
                                                className="p-1.5 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent"><Trash2 size={15} /></button>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}
        </div>
    );
};
