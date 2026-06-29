/**
 * AdminConsole.tsx — standalone admin page (NOT the canvas).
 *
 * Sidebar layout. Modules: 模型配置 / 用户管理 / 全部历史 (all live).
 * Admins land here after login (see src/index.tsx Gate).
 */
import React, { useState } from 'react';
import { Users, SlidersHorizontal, History, LogOut, KeyRound, Image as ImageIcon, Receipt, Tag } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { UserManagement } from './UserManagement';
import { ModelConfig } from './ModelConfig';
import { HistoryBrowser } from './HistoryBrowser';
import { AssetAdmin } from './AssetAdmin';
import { PricingTable } from './PricingTable';
import { CreditLedger } from './CreditLedger';
import { ChangePasswordModal } from '../auth/ChangePasswordModal';
import { ToastHost } from '../Toast';

type Tab = 'users' | 'models' | 'history' | 'assets' | 'pricing' | 'ledger';

const NAV: { key: Tab; label: string; icon: React.ReactNode }[] = [
    { key: 'models', label: '模型配置', icon: <SlidersHorizontal size={18} /> },
    { key: 'users', label: '用户管理', icon: <Users size={18} /> },
    { key: 'history', label: '全部历史', icon: <History size={18} /> },
    { key: 'assets', label: '素材库', icon: <ImageIcon size={18} /> },
    { key: 'pricing', label: '模型价格', icon: <Tag size={18} /> },
    { key: 'ledger', label: '积分流水', icon: <Receipt size={18} /> },
];

export const AdminConsole: React.FC = () => {
    const { user, logout } = useAuth();
    const [tab, setTab] = useState<Tab>('users');
    const [showChangePw, setShowChangePw] = useState(false);

    return (
        <div className="fixed inset-0 flex bg-[#0a0a0a] text-neutral-200" style={{ top: 'var(--titlebar-h, 0px)' }}>
            {/* Sidebar */}
            <aside className="w-56 shrink-0 border-r border-neutral-800 flex flex-col">
                <div className="flex items-center gap-2 px-5 h-14 border-b border-neutral-800">
                    <img src="/logo.png" alt="logo" className="w-7 h-7 rounded-lg object-contain bg-black/20" />
                    <span className="font-semibold text-white text-sm">管理后台</span>
                </div>
                <nav className="flex-1 p-2">
                    {NAV.map(n => (
                        <button key={n.key} onClick={() => setTab(n.key)}
                            className={`w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm mb-1 transition-colors ${tab === n.key ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white hover:bg-neutral-900'}`}>
                            {n.icon}{n.label}
                        </button>
                    ))}
                </nav>
                <div className="p-2 border-t border-neutral-800">
                    <div className="px-3 py-1.5 text-[11px] text-neutral-500 truncate" title={user?.email}>
                        {user?.username} · 管理员
                    </div>
                    <button onClick={() => setShowChangePw(true)}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors">
                        <KeyRound size={18} /> 修改密码
                    </button>
                    <button onClick={() => { void logout(); }}
                        className="w-full flex items-center gap-2.5 px-3 py-2 rounded-lg text-sm text-neutral-400 hover:text-white hover:bg-neutral-900 transition-colors">
                        <LogOut size={18} /> 退出登录
                    </button>
                </div>
            </aside>

            {/* Content */}
            <main className="flex-1 overflow-y-auto p-8">
                {tab === 'users' && <UserManagement currentUserId={user?.id || ''} />}
                {tab === 'models' && <ModelConfig />}
                {tab === 'history' && <HistoryBrowser />}
                {tab === 'assets' && <AssetAdmin />}
                {tab === 'pricing' && <PricingTable />}
                {tab === 'ledger' && <CreditLedger />}
            </main>

            <ChangePasswordModal isOpen={showChangePw} onClose={() => setShowChangePw(false)} />
            <ToastHost />
        </div>
    );
};
