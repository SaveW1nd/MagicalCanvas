/**
 * CreditLedger.tsx — 管理员：积分流水查看（按类型筛选 + 分页）。
 */
import React, { useEffect, useState, useCallback } from 'react';
import { Loader2 } from 'lucide-react';
import { showToast } from '../Toast';

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

interface LedgerRow {
    id: string; userId: string; type: string; category?: string; modelId?: string;
    params?: string; note?: string; amount: number; balanceAfter: number; createdAt: string;
}

const PAGE = 100;
const TYPE_LABEL: Record<string, string> = { charge: '扣费', grant: '发放', adjust: '调整' };

export const CreditLedger: React.FC = () => {
    const [rows, setRows] = useState<LedgerRow[]>([]);
    const [names, setNames] = useState<Record<string, string>>({});
    const [type, setType] = useState('');
    const [offset, setOffset] = useState(0);
    const [loading, setLoading] = useState(false);
    const [hasMore, setHasMore] = useState(true);

    // 用户 id → 用户名映射（流水里只存 userId）
    useEffect(() => {
        (async () => {
            try {
                const d = await api('/api/admin/users');
                const m: Record<string, string> = {};
                for (const u of d.users || []) m[u.id] = u.username;
                setNames(m);
            } catch { /* 忽略，回退显示 id */ }
        })();
    }, []);

    const load = useCallback(async (reset: boolean) => {
        setLoading(true);
        try {
            const off = reset ? 0 : offset;
            const q = `/api/admin/ledger?limit=${PAGE}&offset=${off}` + (type ? `&type=${type}` : '');
            const data: LedgerRow[] = await api(q);
            setRows(prev => reset ? data : [...prev, ...data]);
            setOffset(off + data.length);
            setHasMore(data.length === PAGE);
        } catch (e) { showToast(e instanceof Error ? e.message : '加载失败', 'error'); }
        finally { setLoading(false); }
    }, [offset, type]);

    useEffect(() => { load(true); /* type 变化重载 */ }, [type]); // eslint-disable-line react-hooks/exhaustive-deps

    const fmtParams = (p?: string) => {
        if (!p) return '';
        try { const o = JSON.parse(p); return Object.entries(o).filter(([, v]) => v != null && v !== '').map(([k, v]) => `${k}:${v}`).join(' '); }
        catch { return ''; }
    };

    return (
        <div className="flex flex-col gap-3">
            <div className="flex items-center justify-between">
                <h2 className="text-base font-semibold text-white">积分流水</h2>
                <select value={type} onChange={e => setType(e.target.value)}
                    className="bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-1.5 text-sm text-white outline-none">
                    <option value="">全部类型</option>
                    <option value="charge">扣费</option>
                    <option value="grant">发放</option>
                    <option value="adjust">调整</option>
                </select>
            </div>

            <div className="rounded-xl border border-neutral-800 overflow-hidden">
                <table className="w-full text-sm">
                    <thead className="bg-neutral-900 text-neutral-400 text-xs">
                        <tr>
                            <th className="text-left font-medium px-3 py-2.5">时间</th>
                            <th className="text-left font-medium px-3 py-2.5">用户</th>
                            <th className="text-left font-medium px-3 py-2.5">类型</th>
                            <th className="text-left font-medium px-3 py-2.5">模型/参数</th>
                            <th className="text-right font-medium px-3 py-2.5">金额</th>
                            <th className="text-right font-medium px-3 py-2.5">操作后余额</th>
                            <th className="text-left font-medium px-3 py-2.5">备注</th>
                        </tr>
                    </thead>
                    <tbody>
                        {rows.map(r => (
                            <tr key={r.id} className="border-t border-neutral-800 text-neutral-200">
                                <td className="px-3 py-2 text-[11px] text-neutral-500 whitespace-nowrap">{new Date(r.createdAt).toLocaleString()}</td>
                                <td className="px-3 py-2">{names[r.userId] || r.userId.slice(0, 8)}</td>
                                <td className="px-3 py-2">{TYPE_LABEL[r.type] || r.type}</td>
                                <td className="px-3 py-2 text-[11px] text-neutral-400">{r.modelId || ''}{fmtParams(r.params) ? ` · ${fmtParams(r.params)}` : ''}</td>
                                <td className={`px-3 py-2 text-right font-mono ${r.amount < 0 ? 'text-red-400' : 'text-green-400'}`}>{r.amount > 0 ? '+' : ''}{r.amount.toFixed(2)}</td>
                                <td className="px-3 py-2 text-right font-mono text-neutral-300">{r.balanceAfter.toFixed(2)}</td>
                                <td className="px-3 py-2 text-[11px] text-neutral-500">{r.note || ''}</td>
                            </tr>
                        ))}
                        {!rows.length && !loading && (
                            <tr><td colSpan={7} className="px-3 py-8 text-center text-neutral-500 text-sm">暂无流水</td></tr>
                        )}
                    </tbody>
                </table>
            </div>

            <div className="flex justify-center">
                {loading ? <Loader2 size={18} className="animate-spin text-neutral-500" />
                    : hasMore && rows.length > 0
                        ? <button onClick={() => load(false)} className="px-4 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-neutral-300">加载更多</button>
                        : null}
            </div>
        </div>
    );
};
