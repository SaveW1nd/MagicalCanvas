/**
 * UserManagement.tsx — admin user CRUD with confirm dialogs, toasts, custom modals.
 */
import React, { useState } from 'react';
import { Loader2, UserPlus, Trash2, KeyRound, ShieldCheck, ShieldOff, Ban, CheckCircle2, Coins } from 'lucide-react';
import { showToast } from '../Toast';
import { useSWR, invalidateCache } from '../../utils/swrCache';
import { Tip } from '../ui/Tip';
import { ConfirmDialog } from '../ui/ConfirmDialog';
import { SetPasswordModal } from './SetPasswordModal';
import { Select } from '../ui/Select';

interface AdminUser {
    id: string;
    username: string;
    role: 'admin' | 'user';
    status: 'active' | 'disabled';
    createdAt: string;
    lastLoginAt?: string | null;
    balance?: number; // 百分单位整数（显示时 ÷100）
}

async function adminFetch(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

interface PendingConfirm {
    title: string;
    message: string;
    confirmText: string;
    danger: boolean;
    run: () => Promise<string>;
}

export const UserManagement: React.FC<{ currentUserId: string }> = ({ currentUserId }) => {
    const { data: usersData, loading, refetch: refetchUsers } = useSWR<{ users: AdminUser[] }>('admin:users', () => adminFetch('/api/admin/users'));
    const users = usersData?.users ?? [];
    // create form
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    const [role, setRole] = useState<'user' | 'admin'>('user');
    const [creating, setCreating] = useState(false);
    // confirm + reset modals
    const [confirmState, setConfirmState] = useState<PendingConfirm | null>(null);
    const [confirmLoading, setConfirmLoading] = useState(false);
    const [resetUser, setResetUser] = useState<AdminUser | null>(null);
    // 发放/调整积分弹框
    const [creditUser, setCreditUser] = useState<AdminUser | null>(null);
    const [creditAmount, setCreditAmount] = useState('');
    const [creditMode, setCreditMode] = useState<'grant' | 'deduct' | 'set'>('grant');
    const [creditNote, setCreditNote] = useState('');
    const [creditBusy, setCreditBusy] = useState(false);

    const openCredit = (u: AdminUser) => { setCreditUser(u); setCreditAmount(''); setCreditMode('grant'); setCreditNote(''); };
    const submitCredit = async () => {
        if (!creditUser) return;
        const amount = Number(creditAmount);
        if (!(amount >= 0)) { showToast('请输入有效金额', 'error'); return; }
        setCreditBusy(true);
        try {
            await adminFetch(`/api/admin/users/${creditUser.id}/credits`, {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ amount, mode: creditMode, note: creditNote || undefined }),
            });
            showToast('已更新积分', 'success');
            setCreditUser(null);
            reload();
        } catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
        finally { setCreditBusy(false); }
    };

    const reload = () => { invalidateCache('admin:users'); refetchUsers(); };

    const create = async (e: React.FormEvent) => {
        e.preventDefault();
        if (creating) return;
        setCreating(true);
        try {
            const r = await adminFetch('/api/admin/users', {
                method: 'POST', headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ username: username.trim(), password, role }),
            });
            showToast(r.defaultPassword ? `已创建「${username.trim()}」，初始密码：${r.defaultPassword}` : `已创建用户「${username.trim()}」`, 'success', 5000);
            setUsername(''); setPassword(''); setRole('user');
            reload();
        } catch (e) { showToast(e instanceof Error ? e.message : '创建失败', 'error'); }
        finally { setCreating(false); }
    };

    const runConfirm = async () => {
        if (!confirmState) return;
        setConfirmLoading(true);
        try {
            const msg = await confirmState.run();
            reload();
            setConfirmState(null);
            showToast(msg || '操作成功', 'success');
        } catch (e) { showToast(e instanceof Error ? e.message : '操作失败', 'error'); }
        finally { setConfirmLoading(false); }
    };

    const askToggleRole = (u: AdminUser) => setConfirmState({
        title: u.role === 'admin' ? '降为普通用户' : '升为管理员',
        message: `确认将「${u.username}」${u.role === 'admin' ? '降为普通用户' : '升为管理员'}？`,
        confirmText: '确认', danger: false,
        run: async () => {
            await adminFetch(`/api/admin/users/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ role: u.role === 'admin' ? 'user' : 'admin' }) });
            return '角色已更新';
        },
    });
    const askToggleStatus = (u: AdminUser) => setConfirmState({
        title: u.status === 'active' ? '禁用用户' : '启用用户',
        message: `确认${u.status === 'active' ? '禁用' : '启用'}「${u.username}」？${u.status === 'active' ? '禁用后该用户将无法登录。' : ''}`,
        confirmText: u.status === 'active' ? '禁用' : '启用', danger: u.status === 'active',
        run: async () => {
            await adminFetch(`/api/admin/users/${u.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ status: u.status === 'active' ? 'disabled' : 'active' }) });
            return u.status === 'active' ? '已禁用' : '已启用';
        },
    });
    const askDelete = (u: AdminUser) => setConfirmState({
        title: '删除用户',
        message: `确认删除用户「${u.username}」？此操作不可恢复（该用户已生成的数据仍保留在磁盘）。`,
        confirmText: '删除', danger: true,
        run: async () => { await adminFetch(`/api/admin/users/${u.id}`, { method: 'DELETE' }); return '已删除'; },
    });

    const doReset = async (pw: string) => {
        if (!resetUser) return;
        const r = await adminFetch(`/api/admin/users/${resetUser.id}/reset-password`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ newPassword: pw }),
        });
        showToast(r.defaultPassword ? `已重置为默认密码：${r.defaultPassword}` : '密码已重置', 'success', 5000);
        reload();
    };

    return (
        <div className="max-w-6xl">
            <h2 className="text-lg font-semibold text-white mb-4">用户管理</h2>

            {/* Create */}
            <form onSubmit={create} className="flex flex-wrap items-end gap-3 mb-5 p-4 rounded-xl bg-neutral-900 border border-neutral-800">
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">用户名</span>
                    <input required value={username} onChange={e => setUsername(e.target.value)} placeholder="登录用户名"
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60 w-52" />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">密码</span>
                    <input type="text" value={password} onChange={e => setPassword(e.target.value)} placeholder="留空=默认 12345678"
                        className="bg-neutral-950 border border-neutral-700 rounded-lg px-2.5 py-1.5 text-sm text-neutral-200 outline-none focus:border-blue-500/60 w-48" />
                </div>
                <div className="flex flex-col gap-1">
                    <span className="text-[11px] text-neutral-500">角色</span>
                    <Select
                        value={role}
                        onChange={v => setRole(v as 'user' | 'admin')}
                        className="w-32"
                        options={[{ value: 'user', label: '普通用户' }, { value: 'admin', label: '管理员' }]}
                    />
                </div>
                <button type="submit" disabled={creating}
                    className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-500 text-white text-sm rounded-lg px-3.5 py-1.5 transition-colors disabled:opacity-60">
                    {creating ? <Loader2 size={14} className="animate-spin" /> : <UserPlus size={14} />} 新建用户
                </button>
            </form>

            {/* Table */}
            {loading ? (
                <div className="flex items-center gap-2 text-neutral-500 text-sm py-8"><Loader2 size={16} className="animate-spin" /> 加载中…</div>
            ) : (
                <div className="rounded-xl border border-neutral-800 overflow-hidden">
                    <table className="w-full text-sm">
                        <thead className="bg-neutral-900 text-neutral-400 text-xs">
                            <tr>
                                <th className="text-left font-medium px-4 py-2.5">用户</th>
                                <th className="text-left font-medium px-4 py-2.5">角色</th>
                                <th className="text-left font-medium px-4 py-2.5">状态</th>
                                <th className="text-right font-medium px-4 py-2.5">积分</th>
                                <th className="text-left font-medium px-4 py-2.5">最近登录</th>
                                <th className="text-right font-medium px-4 py-2.5">操作</th>
                            </tr>
                        </thead>
                        <tbody>
                            {users.map(u => (
                                <tr key={u.id} className="border-t border-neutral-800 text-neutral-200">
                                    <td className="px-4 py-2.5 font-medium">{u.username}{u.id === currentUserId && <span className="ml-1 text-[10px] text-blue-400">(我)</span>}</td>
                                    <td className="px-4 py-2.5"><span className={u.role === 'admin' ? 'text-amber-400' : 'text-neutral-400'}>{u.role === 'admin' ? '管理员' : '普通用户'}</span></td>
                                    <td className="px-4 py-2.5"><span className={u.status === 'active' ? 'text-green-400' : 'text-red-400'}>{u.status === 'active' ? '正常' : '已禁用'}</span></td>
                                    <td className="px-4 py-2.5 text-right font-mono text-neutral-200">{((u.balance ?? 0) / 100).toFixed(2)}</td>
                                    <td className="px-4 py-2.5 text-[11px] text-neutral-500">{u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : '—'}</td>
                                    <td className="px-4 py-2.5">
                                        <div className="flex items-center justify-end gap-1.5">
                                            <Tip label={u.role === 'admin' ? '降为普通用户' : '升为管理员'}>
                                                <button onClick={() => askToggleRole(u)} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                    {u.role === 'admin' ? <ShieldOff size={15} /> : <ShieldCheck size={15} />}
                                                </button>
                                            </Tip>
                                            <Tip label={u.status === 'active' ? '禁用' : '启用'}>
                                                <button onClick={() => askToggleStatus(u)} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white">
                                                    {u.status === 'active' ? <Ban size={15} /> : <CheckCircle2 size={15} />}
                                                </button>
                                            </Tip>
                                            <Tip label="发放/调整积分">
                                                <button onClick={() => openCredit(u)} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-amber-400"><Coins size={15} /></button>
                                            </Tip>
                                            <Tip label="重置密码">
                                                <button onClick={() => setResetUser(u)} className="p-1.5 rounded hover:bg-neutral-700 text-neutral-400 hover:text-white"><KeyRound size={15} /></button>
                                            </Tip>
                                            <Tip label={u.id === currentUserId ? '不能删除自己' : '删除'}>
                                                <button onClick={() => askDelete(u)} disabled={u.id === currentUserId}
                                                    className="p-1.5 rounded hover:bg-red-500/20 text-neutral-400 hover:text-red-400 disabled:opacity-30 disabled:hover:bg-transparent"><Trash2 size={15} /></button>
                                            </Tip>
                                        </div>
                                    </td>
                                </tr>
                            ))}
                        </tbody>
                    </table>
                </div>
            )}

            <ConfirmDialog
                open={!!confirmState}
                title={confirmState?.title || ''}
                message={confirmState?.message}
                confirmText={confirmState?.confirmText}
                danger={confirmState?.danger}
                loading={confirmLoading}
                onConfirm={runConfirm}
                onClose={() => { if (!confirmLoading) setConfirmState(null); }}
            />
            <SetPasswordModal
                open={!!resetUser}
                username={resetUser?.username || ''}
                onClose={() => setResetUser(null)}
                onSubmit={doReset}
            />

            {/* 发放/调整积分弹框 */}
            {creditUser && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130] p-4" onClick={() => !creditBusy && setCreditUser(null)}>
                    <div onClick={e => e.stopPropagation()} className="w-full max-w-sm bg-[#1a1a1a] border border-neutral-700 rounded-2xl shadow-2xl p-6 flex flex-col gap-3.5">
                        <h3 className="text-base font-semibold text-white">积分 · {creditUser.username}</h3>
                        <p className="text-xs text-neutral-400">当前余额：<span className="font-mono text-neutral-200">{((creditUser.balance ?? 0) / 100).toFixed(2)}</span></p>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">操作</label>
                            <Select value={creditMode} onChange={v => setCreditMode(v as 'grant' | 'deduct' | 'set')}
                                options={[{ value: 'grant', label: '增加' }, { value: 'deduct', label: '扣减' }, { value: 'set', label: '设为' }]} />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">金额（积分，支持小数）</label>
                            <input type="number" step="0.01" min="0" value={creditAmount} onChange={e => setCreditAmount(e.target.value)} placeholder="如 100"
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                        </div>
                        <div>
                            <label className="block text-xs text-neutral-400 mb-1">备注（可选）</label>
                            <input value={creditNote} onChange={e => setCreditNote(e.target.value)} placeholder="发放原因"
                                className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none focus:border-blue-500" />
                        </div>
                        <div className="flex justify-end gap-2 mt-1">
                            <button onClick={() => setCreditUser(null)} disabled={creditBusy} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-white disabled:opacity-50">取消</button>
                            <button onClick={submitCredit} disabled={creditBusy} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50">
                                {creditBusy && <Loader2 size={14} className="animate-spin" />}确定
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};
