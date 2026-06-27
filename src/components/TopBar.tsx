/**
 * TopBar.tsx
 * 
 * Top navigation bar component with canvas title, save button, and other controls.
 */

import React, { useState } from 'react';
import { Plus, Save, Loader2, Settings, Pencil, LogOut } from 'lucide-react';
import { SettingsModal } from './modals/SettingsModal';
import { useAuth } from '../contexts/AuthContext';
import { ChangePasswordModal } from './auth/ChangePasswordModal';

interface TopBarProps {
    // Title
    canvasTitle: string;
    isEditingTitle: boolean;
    editingTitleValue: string;
    canvasTitleInputRef: React.RefObject<HTMLInputElement>;
    setCanvasTitle: (title: string) => void;
    setIsEditingTitle: (editing: boolean) => void;
    setEditingTitleValue: (value: string) => void;
    // Actions
    onSave: () => void | Promise<void>;
    onNew: () => void;
    hasUnsavedChanges: boolean;
    lastAutoSaveTime?: number;
    // Layout
    isChatOpen?: boolean;
    // Theme
    canvasTheme: 'dark' | 'light';
    onToggleTheme: () => void;
}

export const TopBar: React.FC<TopBarProps> = ({
    canvasTitle,
    isEditingTitle,
    editingTitleValue,
    canvasTitleInputRef,
    setCanvasTitle,
    setIsEditingTitle,
    setEditingTitleValue,
    onSave,
    onNew,
    hasUnsavedChanges,
    lastAutoSaveTime,
    isChatOpen = false,
    canvasTheme,
    onToggleTheme
}) => {
    const [showNewConfirm, setShowNewConfirm] = useState(false);
    const [isSaving, setIsSaving] = useState(false);
    const [showSettings, setShowSettings] = useState(false);
    const [showChangePw, setShowChangePw] = useState(false);
    const { user, logout, isAdmin } = useAuth();

    const handleTitleBlur = () => {
        if (editingTitleValue.trim()) {
            setCanvasTitle(editingTitleValue.trim());
        } else {
            setEditingTitleValue(canvasTitle);
        }
        setIsEditingTitle(false);
    };

    const handleTitleKeyDown = (e: React.KeyboardEvent) => {
        if (e.key === 'Enter') {
            if (editingTitleValue.trim()) {
                setCanvasTitle(editingTitleValue.trim());
            }
            setIsEditingTitle(false);
        } else if (e.key === 'Escape') {
            setEditingTitleValue(canvasTitle);
            setIsEditingTitle(false);
        }
    };

    const handleTitleDoubleClick = () => {
        setEditingTitleValue(canvasTitle);
        setIsEditingTitle(true);
    };

    const handleNewClick = () => {
        if (hasUnsavedChanges) {
            setShowNewConfirm(true);
        } else {
            onNew();
        }
    };

    const handleSaveAndNew = async () => {
        try {
            setIsSaving(true);
            await onSave();
            setShowNewConfirm(false);
            onNew();
        } catch (error) {
            console.error("Failed to save and new:", error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleDiscardAndNew = () => {
        setShowNewConfirm(false);
        onNew();
    };

    return (
        <>
            <div
                className="fixed left-0 h-14 flex items-center justify-between px-6 z-50 pointer-events-none transition-all duration-300"
                style={{ width: isChatOpen ? 'calc(100% - 400px)' : '100%', top: 'var(--titlebar-h, 0px)' }}
            >
                {/* Left: Logo & Title */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    <img src="/logo.png" alt="Magical Canvas Logo" className="w-8 h-8 rounded-lg object-contain bg-black/20" />
                    {isEditingTitle ? (
                        <input
                            ref={canvasTitleInputRef as React.RefObject<HTMLInputElement>}
                            type="text"
                            value={editingTitleValue}
                            onChange={(e) => setEditingTitleValue(e.target.value)}
                            onBlur={handleTitleBlur}
                            onKeyDown={handleTitleKeyDown}
                            className="font-semibold text-neutral-300 bg-transparent border-b border-blue-500 outline-none min-w-[100px]"
                        />
                    ) : (
                        <span
                            className={`group/title inline-flex items-center gap-1.5 font-semibold cursor-text transition-colors ${canvasTheme === 'dark' ? 'text-neutral-300 hover:text-white' : 'text-neutral-900 hover:text-neutral-600'}`}
                            onClick={handleTitleDoubleClick}
                            onDoubleClick={handleTitleDoubleClick}
                            title="点击重命名画布"
                        >
                            {canvasTitle}
                            <Pencil size={12} className="opacity-0 group-hover/title:opacity-60 transition-opacity shrink-0" />
                        </span>
                    )}
                </div>

                {/* Right: Actions */}
                <div className="flex items-center gap-3 pointer-events-auto">
                    {/* Auto-save notification - before save button */}
                    {lastAutoSaveTime && !hasUnsavedChanges && (
                        <div className={`text-[10px] font-medium px-2 py-1 rounded border animate-in fade-in duration-500 ${canvasTheme === 'dark'
                            ? 'text-neutral-500 border-neutral-800'
                            : 'text-neutral-400 border-neutral-100'
                            }`}>
                            已自动保存 {new Date(lastAutoSaveTime).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                    )}
                    <button
                        onClick={() => onSave()}
                        className={`text-sm px-5 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300 shadow-sm'
                            }`}
                    >
                        <Save size={16} />
                        保存
                    </button>
                    <button
                        onClick={handleNewClick}
                        className={`text-sm px-4 py-2.5 rounded-full flex items-center gap-2 transition-colors font-medium border ${canvasTheme === 'dark'
                            ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-600'
                            : 'bg-neutral-200 hover:bg-neutral-300 text-neutral-900 border-neutral-300'
                            }`}
                    >
                        <Plus size={16} />
                        新建
                    </button>
                    {/* 设置（API 密钥/模型）仅管理员可见；普通用户不允许配置，统一在管理后台 */}
                    {isAdmin && (
                        <button
                            onClick={() => setShowSettings(true)}
                            className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${canvasTheme === 'dark'
                                ? 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800'
                                : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 shadow-sm'
                                }`}
                            title="设置（API 密钥）"
                        >
                            <Settings size={18} />
                        </button>
                    )}
                    {/* 主题切换已移到右下角全局浮动按钮 */}
                    {/* 用户 / 退出登录 */}
                    {user && (
                        <div className="flex items-center gap-1.5 pl-1">
                            <button
                                onClick={() => setShowChangePw(true)}
                                className={`hidden sm:inline text-xs max-w-[120px] truncate cursor-pointer transition-colors ${canvasTheme === 'dark' ? 'text-neutral-400 hover:text-white' : 'text-neutral-500 hover:text-neutral-900'}`}
                                title={`${user.username}${user.role === 'admin' ? '（管理员）' : ''} · ${user.email} · 点击修改密码`}
                            >
                                {user.username}{user.role === 'admin' ? ' · 管理员' : ''}
                            </button>
                            <button
                                onClick={() => { void logout(); }}
                                className={`w-10 h-10 rounded-full flex items-center justify-center transition-colors border ${canvasTheme === 'dark'
                                    ? 'bg-neutral-900 border-neutral-700 text-neutral-300 hover:bg-neutral-800 hover:text-white'
                                    : 'bg-white border-neutral-200 text-neutral-600 hover:bg-neutral-50 shadow-sm'
                                    }`}
                                title="退出登录"
                            >
                                <LogOut size={18} />
                            </button>
                        </div>
                    )}
                </div>
            </div>

            {/* Unsaved Changes Confirmation Modal */}
            {showNewConfirm && (
                <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[100]">
                    <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl p-6 w-[400px] shadow-2xl">
                        <h3 className="text-lg font-semibold text-white mb-2">有未保存的更改</h3>
                        <p className="text-neutral-400 text-sm mb-6">
                            你有未保存的更改。是否在新建画布前先保存？
                        </p>
                        <div className="flex gap-3 justify-end">
                            <button
                                onClick={() => setShowNewConfirm(false)}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                取消
                            </button>
                            <button
                                onClick={handleDiscardAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-red-600 hover:bg-red-500 text-white text-sm transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                放弃
                            </button>
                            <button
                                onClick={handleSaveAndNew}
                                disabled={isSaving}
                                className="px-4 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                            >
                                {isSaving ? (
                                    <>
                                        <Loader2 className="w-4 h-4 animate-spin" />
                                        保存中…
                                    </>
                                ) : (
                                    '保存并新建'
                                )}
                            </button>
                        </div>
                    </div>
                </div>
            )}

            {/* 设置弹窗 */}
            <SettingsModal isOpen={showSettings} onClose={() => setShowSettings(false)} />

            {/* 修改密码 */}
            <ChangePasswordModal isOpen={showChangePw} onClose={() => setShowChangePw(false)} />
        </>
    );
};
