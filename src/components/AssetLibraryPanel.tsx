import React, { useState, useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { X, Trash2, Upload, Loader2, Plus, Check, FolderInput, Globe, Lock, FolderPlus } from 'lucide-react';
import { showAppAlert, showAppConfirm } from './ui/AppDialog';
import { showToast } from './Toast';
import { Tip } from './ui/Tip';
import { ExpandedMediaModal } from './modals/ExpandedMediaModal';

interface LibraryAsset {
    id: string;
    name: string;
    category: string;
    url: string;
    type: 'image' | 'video';
    visibility?: 'private' | 'public';
    sourceAssetId?: string | null;
    publishedBy?: string;
    mine?: boolean;
}

interface AssetLibraryPanelProps {
    isOpen: boolean;
    onClose: () => void;
    onSelectAsset: (url: string, type: 'image' | 'video') => void;
    panelY?: number;
    variant?: 'panel' | 'modal';
    canvasTheme?: 'dark' | 'light';
}

const DEFAULT_CATEGORIES = [
    'Character',
    'Scene',
    'Item',
    'Style',
    'Sound Effect',
    'Others'
];

export const AssetLibraryPanel: React.FC<AssetLibraryPanelProps> = ({
    isOpen,
    onClose,
    onSelectAsset,
    panelY = 100,
    variant = 'panel',
    canvasTheme = 'dark'
}) => {
    const [selectedCategory, setSelectedCategory] = useState('All');
    const [assets, setAssets] = useState<LibraryAsset[]>([]);
    const [publicAssets, setPublicAssets] = useState<LibraryAsset[]>([]);
    const [activeTab, setActiveTab] = useState<'my' | 'public'>('my');
    const [categories, setCategories] = useState<string[]>(DEFAULT_CATEGORIES);
    const [loading, setLoading] = useState(false);

    useEffect(() => {
        if (isOpen) {
            fetchLibrary();
            fetchCategories();
            fetchPublic();
        }
    }, [isOpen]);

    const fetchPublic = async () => {
        try {
            const res = await fetch('/api/library/public');
            if (res.ok) setPublicAssets(await res.json());
        } catch (error) {
            console.error('Failed to load public library:', error);
        }
    };

    const fetchLibrary = async () => {
        setLoading(true);
        try {
            const res = await fetch('/api/library'); // Adjust port if needed, relative path preferred in helper
            if (res.ok) {
                setAssets(await res.json());
            }
        } catch (error) {
            console.error("Failed to load library:", error);
        } finally {
            setLoading(false);
        }
    };

    const fetchCategories = async () => {
        try {
            const res = await fetch('/api/library/categories');
            if (res.ok) {
                const data = await res.json();
                if (Array.isArray(data.categories)) setCategories(data.categories);
            }
        } catch (error) {
            console.error('Failed to load categories:', error);
        }
    };

    const handleAddCategory = async (name: string) => {
        const res = await fetch('/api/library/categories', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ name }),
        });
        const data = await res.json();
        if (!res.ok) {
            showAppAlert(data.error || '添加分类失败');
            return;
        }
        setCategories(data.categories);
        setSelectedCategory(name);
    };

    const handleDeleteCategory = async (name: string) => {
        const res = await fetch(`/api/library/categories/${encodeURIComponent(name)}`, { method: 'DELETE' });
        const data = await res.json();
        if (!res.ok) {
            showAppAlert(data.error || '删除分类失败');
            return;
        }
        setCategories(data.categories);
        if (selectedCategory === name) setSelectedCategory('All');
        await fetchLibrary(); // 该分类下素材已自动改挂到剩余分类
    };

    // 导入本地视频/图片到素材库（归入当前分类，「All」时归入 Others）
    const importInputRef = useRef<HTMLInputElement>(null);
    const [importing, setImporting] = useState(false);

    const handleImportFiles = async (e: React.ChangeEvent<HTMLInputElement>) => {
        const files = Array.from(e.target.files || []);
        if (files.length === 0) return;
        setImporting(true);
        let failed = 0;
        const category = selectedCategory === 'All'
            ? (categories.includes('Others') ? 'Others' : categories[0] || 'Others')
            : selectedCategory;
        for (const file of files) {
            try {
                const dataUrl = await new Promise<string>((resolve, reject) => {
                    const fr = new FileReader();
                    fr.onload = () => resolve(fr.result as string);
                    fr.onerror = reject;
                    fr.readAsDataURL(file);
                });
                const res = await fetch('/api/library', {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/json' },
                    body: JSON.stringify({
                        sourceUrl: dataUrl,
                        name: file.name.replace(/\.[^.]+$/, ''),
                        category,
                    }),
                });
                if (!res.ok) throw new Error();
            } catch (_) {
                failed++;
            }
        }
        setImporting(false);
        if (importInputRef.current) importInputRef.current.value = '';
        if (failed > 0) showAppAlert(`${failed} 个文件导入失败`);
        await fetchLibrary();
    };

    const handleDeleteAsset = async (id: string, e: React.MouseEvent) => {
        e.stopPropagation(); // Prevent selection
        // Confirmation is now handled in the UI before this is called

        try {
            const res = await fetch(`/api/library/${id}`, {
                method: 'DELETE'
            });
            if (res.ok) {
                setAssets(prev => prev.filter(a => a.id !== id));
            } else {
                console.error("Failed to delete asset");
            }
        } catch (error) {
            console.error("Delete error:", error);
        }
    };

    /** 批量删除素材 */
    const handleDeleteMany = async (ids: string[]) => {
        let failed = 0;
        for (const id of ids) {
            try {
                const res = await fetch(`/api/library/${id}`, { method: 'DELETE' });
                if (!res.ok) failed++;
            } catch (_) {
                failed++;
            }
        }
        if (failed > 0) showAppAlert(`${failed} 个素材删除失败`);
        await fetchLibrary();
    };

    // 改某素材分类后，本地更新该行 category
    const handleChangeCategory = async (id: string, category: string) => {
        try {
            const res = await fetch(`/api/library/${id}/category`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category }),
            });
            if (!res.ok) { showAppAlert('改分类失败'); return; }
            setAssets(prev => prev.map(a => a.id === id ? { ...a, category } : a));
        } catch (_) {
            showAppAlert('改分类失败');
        }
    };

    // 发布素材到公共库
    const handlePublish = async (id: string) => {
        try {
            const res = await fetch(`/api/library/${id}/publish`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) { showAppAlert(data.error || '发布失败'); return; }
            setAssets(prev => prev.map(a => a.id === id ? { ...a, visibility: 'public' } : a));
            await fetchPublic();
            showToast('已发布到公共库', 'success');
        } catch (_) { showAppAlert('发布失败'); }
    };

    // 从公共库收藏到自己库(零拷贝)
    const handleAddFromPublic = async (publicId: string) => {
        try {
            const res = await fetch(`/api/library/from-public/${publicId}`, { method: 'POST' });
            const data = await res.json();
            if (!res.ok) { showAppAlert(data.error || '收藏失败'); return; }
            await fetchLibrary();
            showToast(data.already ? '已在你的素材库中' : '已加入我的素材库', 'success');
        } catch (_) { showAppAlert('收藏失败'); }
    };

    if (!isOpen) return null;

    // Theme helper
    const isDark = canvasTheme === 'dark';

    if (variant === 'modal') {
        return (
            <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm animate-in fade-in duration-200">
                <div
                    className={`flex flex-col w-[800px] h-[600px] border rounded-2xl shadow-2xl overflow-hidden transition-colors duration-300 ${isDark ? 'bg-[#0a0a0a] border-neutral-800' : 'bg-white border-neutral-200'}`}
                    onClick={(e) => e.stopPropagation()}
                >
                    <div className={`flex items-center justify-between p-4 border-b ${isDark ? 'border-neutral-800' : 'border-neutral-200'}`}>
                        <h2 className={`text-lg font-medium pl-2 ${isDark ? 'text-white' : 'text-neutral-900'}`}>素材库</h2>
                        <button onClick={onClose} title="关闭" className={`p-2 rounded-lg transition-colors ${isDark ? 'hover:bg-neutral-800 text-neutral-400 hover:text-white' : 'hover:bg-neutral-100 text-neutral-500 hover:text-neutral-900'}`}>
                            <X size={20} />
                        </button>
                    </div>
                    {/* Reuse internal content logic */}
                    <input ref={importInputRef} type="file" multiple accept="image/*,video/*" onChange={handleImportFiles} className="hidden" />
                    <AssetLibraryContent
                        selectedCategory={selectedCategory}
                        setSelectedCategory={setSelectedCategory}
                        assets={assets}
                        loading={loading}
                        onSelectAsset={onSelectAsset}
                        onDeleteAsset={handleDeleteAsset}
                        onDeleteMany={handleDeleteMany}
                        variant={variant}
                        canvasTheme={canvasTheme}
                        importing={importing}
                        onImportClick={() => importInputRef.current?.click()}
                        categories={categories}
                        onAddCategory={handleAddCategory}
                        onDeleteCategory={handleDeleteCategory}
                        onChangeCategory={handleChangeCategory}
                        activeTab={activeTab}
                        setActiveTab={setActiveTab}
                        publicAssets={publicAssets}
                        onPublish={handlePublish}
                        onAddFromPublic={handleAddFromPublic}
                    />
                </div>
                {/* Click outside to close */}
                <div className="absolute inset-0 -z-10" onClick={onClose} />
            </div>
        );
    }

    return (
        <div
            className={`fixed left-20 z-40 w-[700px] backdrop-blur-xl border rounded-2xl shadow-2xl flex flex-col max-h-[500px] overflow-hidden animate-in slide-in-from-left-4 duration-200 transition-colors ${isDark ? 'bg-[#0a0a0a]/95 border-neutral-800' : 'bg-white/95 border-neutral-200'}`}
            style={{ top: Math.min(window.innerHeight - 510, Math.max(20, panelY)) }}
        >
            <input ref={importInputRef} type="file" multiple accept="image/*,video/*" onChange={handleImportFiles} className="hidden" />
            <AssetLibraryContent
                selectedCategory={selectedCategory}
                setSelectedCategory={setSelectedCategory}
                assets={assets}
                loading={loading}
                onSelectAsset={onSelectAsset}
                onDeleteAsset={handleDeleteAsset}
                onDeleteMany={handleDeleteMany}
                variant={variant}
                canvasTheme={canvasTheme}
                importing={importing}
                onImportClick={() => importInputRef.current?.click()}
                categories={categories}
                onAddCategory={handleAddCategory}
                onDeleteCategory={handleDeleteCategory}
                onChangeCategory={handleChangeCategory}
                activeTab={activeTab}
                setActiveTab={setActiveTab}
                publicAssets={publicAssets}
                onPublish={handlePublish}
                onAddFromPublic={handleAddFromPublic}
            />
        </div>
    );
};

// Extracted Internal Component for reuse
const AssetLibraryContent = ({
    selectedCategory, setSelectedCategory,
    assets, loading, onSelectAsset, onDeleteAsset, onDeleteMany, variant, canvasTheme = 'dark',
    importing, onImportClick,
    categories = DEFAULT_CATEGORIES, onAddCategory, onDeleteCategory, onChangeCategory,
    activeTab = 'my', setActiveTab, publicAssets = [], onPublish, onAddFromPublic
}: any) => {
    const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);
    const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);
    const [categoryMenuPos, setCategoryMenuPos] = useState<{ x: number; y: number } | null>(null);
    const [addingCategory, setAddingCategory] = useState(false);
    const [newCategoryName, setNewCategoryName] = useState('');
    // 批量删除模式：点击素材为勾选而非选用
    const [manageMode, setManageMode] = useState(false);
    const [checkedIds, setCheckedIds] = useState<Set<string>>(new Set());
    const [batchDeleting, setBatchDeleting] = useState(false);
    const [previewUrl, setPreviewUrl] = useState<string | null>(null); // 查看大图/视频
    const isDark = canvasTheme === 'dark';

    const isPublicTab = activeTab === 'public';
    // 公共页:数据源 = 公共素材；分类 pill 由公共素材推导
    const sourceAssets: any[] = isPublicTab ? publicAssets : assets;
    const publicCategories: string[] = Array.from(new Set((publicAssets as any[]).map(a => a.category).filter(Boolean)));
    const allCategories: string[] = ['All', ...(isPublicTab ? publicCategories : categories)];

    const submitNewCategory = () => {
        const name = newCategoryName.trim();
        setAddingCategory(false);
        setNewCategoryName('');
        if (name) onAddCategory?.(name);
    };

    const toggleChecked = (id: string) => {
        setCheckedIds(prev => {
            const next = new Set(prev);
            if (next.has(id)) next.delete(id); else next.add(id);
            return next;
        });
    };

    const exitManageMode = () => {
        setManageMode(false);
        setCheckedIds(new Set());
    };

    const handleBatchDelete = async () => {
        if (checkedIds.size === 0) return;
        const ok = await showAppConfirm(`确定删除选中的 ${checkedIds.size} 个素材吗？此操作不可恢复。`, { danger: true, confirmText: '删除' });
        if (!ok) return;
        setBatchDeleting(true);
        await onDeleteMany?.(Array.from(checkedIds));
        setBatchDeleting(false);
        exitManageMode();
    };

    const filteredAssets = sourceAssets.filter((asset: any) =>
        selectedCategory === 'All' || asset.category === selectedCategory
    );

    const handleDeleteClick = (e: React.MouseEvent, id: string) => {
        e.stopPropagation();
        setDeleteConfirmId(id);
    };

    const handleConfirmDelete = (e: React.MouseEvent, id: string) => {
        onDeleteAsset(id, e);
        setDeleteConfirmId(null);
    };

    const handleCancelDelete = (e: React.MouseEvent) => {
        e.stopPropagation();
        setDeleteConfirmId(null);
    };

    return (
        <>

            <div className="p-4 flex flex-col gap-4 h-full overflow-hidden">
                {/* 我的 / 公共 切换 */}
                <div className="flex items-center gap-1 shrink-0">
                    <button
                        onClick={() => { setActiveTab?.('my'); setSelectedCategory('All'); }}
                        title="我的素材"
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${!isPublicTab ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        <Lock size={14} /> 我的素材
                    </button>
                    <button
                        onClick={() => { setActiveTab?.('public'); setSelectedCategory('All'); exitManageMode(); }}
                        title="公共素材"
                        className={`flex items-center gap-1.5 px-3 py-1.5 rounded-lg text-sm font-medium transition-colors ${isPublicTab ? 'bg-neutral-800 text-white' : 'text-neutral-400 hover:text-white'}`}
                    >
                        <Globe size={14} /> 公共素材
                    </button>
                </div>

                {/* Filters + 导入 */}
                <div className="flex items-center gap-2 shrink-0">
                    <div className="flex gap-2 overflow-x-auto pb-2 scrollbar-hide flex-1 min-w-0 items-center">
                        {/* 删除 × 放在药丸内部（悬停展开）：分类行是 overflow-x-auto，
                            外挂角标会被纵向裁剪，内嵌则完全不受影响 */}
                        {allCategories.map(cat => (
                            <button
                                key={cat}
                                onClick={() => setSelectedCategory(cat)}
                                className={`group/cat shrink-0 flex items-center px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-colors border ${selectedCategory === cat
                                    ? isDark ? 'bg-neutral-100 text-black border-white' : 'bg-neutral-900 text-white border-neutral-900'
                                    : isDark ? 'bg-neutral-900 text-neutral-400 border-neutral-800 hover:border-neutral-600' : 'bg-white text-neutral-600 border-neutral-200 hover:border-neutral-300'
                                    }`}
                            >
                                {cat}
                                {cat !== 'All' && !isPublicTab && (
                                    <span
                                        onClick={(e) => { e.stopPropagation(); onDeleteCategory?.(cat); }}
                                        className="ml-1 -mr-1.5 w-4 h-4 rounded-full hidden group-hover/cat:inline-flex items-center justify-center opacity-60 hover:opacity-100 hover:bg-red-500 hover:!text-white transition-colors"
                                        title="删除该分类（素材自动归入剩余分类）"
                                    >
                                        <X size={10} />
                                    </span>
                                )}
                            </button>
                        ))}
                        {!isPublicTab && (addingCategory ? (
                            <input
                                autoFocus
                                value={newCategoryName}
                                onChange={e => setNewCategoryName(e.target.value)}
                                onKeyDown={e => { if (e.key === 'Enter') submitNewCategory(); if (e.key === 'Escape') { setAddingCategory(false); setNewCategoryName(''); } }}
                                onBlur={submitNewCategory}
                                placeholder="分类名称"
                                className={`w-24 shrink-0 px-3 py-1.5 rounded-full text-xs border outline-none ${isDark ? 'bg-neutral-900 text-white border-neutral-600' : 'bg-white text-neutral-900 border-neutral-400'}`}
                            />
                        ) : (
                            <button
                                onClick={() => setAddingCategory(true)}
                                className={`shrink-0 flex items-center gap-1 px-2.5 py-1.5 rounded-full text-xs border border-dashed transition-colors ${isDark ? 'text-neutral-500 border-neutral-700 hover:text-white hover:border-neutral-500' : 'text-neutral-400 border-neutral-300 hover:text-neutral-700 hover:border-neutral-400'}`}
                                title="新建自定义分类"
                            >
                                <Plus size={12} /> 分类
                            </button>
                        ))}
                    </div>
                    {isPublicTab ? null : manageMode ? (
                        <div className="flex items-center gap-1.5 mb-2 shrink-0">
                            <button
                                onClick={() => {
                                    const allIds = filteredAssets.map((a: any) => a.id);
                                    setCheckedIds(prev => prev.size >= allIds.length ? new Set() : new Set(allIds));
                                }}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-700' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300'}`}
                            >
                                {checkedIds.size >= filteredAssets.length && filteredAssets.length > 0 ? '取消全选' : '全选'}
                            </button>
                            <button
                                onClick={handleBatchDelete}
                                disabled={checkedIds.size === 0 || batchDeleting}
                                className="flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border border-red-700 bg-red-600/20 text-red-300 hover:bg-red-600/40 transition-colors disabled:opacity-40"
                            >
                                {batchDeleting ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                                删除{checkedIds.size > 0 ? ` ${checkedIds.size}` : ''}
                            </button>
                            <button
                                onClick={exitManageMode}
                                className={`px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${isDark ? 'bg-neutral-900 text-neutral-400 border-neutral-700 hover:text-white' : 'bg-white text-neutral-500 border-neutral-300 hover:text-neutral-900'}`}
                            >
                                取消
                            </button>
                        </div>
                    ) : (
                        <div className="flex items-center gap-1.5 mb-2 shrink-0">
                            <button
                                onClick={() => setManageMode(true)}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-700' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300'}`}
                                title="进入多选模式，批量删除素材"
                            >
                                <Trash2 size={13} />
                                批量删除
                            </button>
                            <button
                                onClick={onImportClick}
                                disabled={importing}
                                className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap border transition-colors disabled:opacity-50 ${isDark ? 'bg-neutral-800 hover:bg-neutral-700 text-white border-neutral-700' : 'bg-neutral-100 hover:bg-neutral-200 text-neutral-900 border-neutral-300'}`}
                                title="导入本地视频/图片到当前分类（可多选）"
                            >
                                {importing ? <Loader2 size={13} className="animate-spin" /> : <Upload size={13} />}
                                导入
                            </button>
                        </div>
                    )}
                </div>

                {/* Content */}
                <div
                    className="flex-1 overflow-y-auto pr-2 grid gap-3 pb-4 content-start grid-cols-4"
                    style={{
                        scrollbarWidth: 'thin',
                        scrollbarColor: isDark ? '#525252 #171717' : '#d4d4d4 #fafafa'
                    }}
                >
                    {loading ? (
                        <div className="col-span-full text-center py-10 text-neutral-500">加载中...</div>
                    ) : filteredAssets.length === 0 ? (
                        <div className="col-span-full text-center py-10 text-neutral-500 text-sm">
                            此分类下暂无素材。
                        </div>
                    ) : (
                        filteredAssets.map((asset: any) => (
                            <div
                                key={asset.id}
                                className={`group relative aspect-square bg-neutral-900 rounded-lg overflow-hidden border cursor-pointer ${manageMode && checkedIds.has(asset.id) ? 'border-red-500 ring-1 ring-red-500' : 'border-neutral-800 hover:border-neutral-600'}`}
                                onClick={() => {
                                    // 多选模式(仅我的页):点击为勾选；否则点击=查看大图(加到画布走 + 按钮)
                                    if (!isPublicTab && manageMode) { toggleChecked(asset.id); return; }
                                    setPreviewUrl(asset.url);
                                }}
                            >
                                {/* 多选模式：左上角勾选框 */}
                                {manageMode && (
                                    <div className={`absolute top-1 left-1 z-20 w-5 h-5 rounded border flex items-center justify-center ${checkedIds.has(asset.id) ? 'bg-red-500 border-red-500 text-white' : 'bg-black/50 border-neutral-400'}`}>
                                        {checkedIds.has(asset.id) && <Check size={13} />}
                                    </div>
                                )}
                                <img
                                    src={asset.url}
                                    alt={asset.name}
                                    className="w-full h-full object-cover"
                                    onError={(e) => {
                                        const target = e.target as HTMLImageElement;
                                        target.onerror = null; // Prevent infinite loop
                                        target.src = 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIyNCIgaGVpZ2h0PSIyNCIgdmlld0JveD0iMCAwIDI0IDI0IiBmaWxsPSJub25lIiBzdHJva2U9IiMzMzMiIHN0cm9rZS13aWR0aD0iMiIgc3Ryb2tlLWxpbmVjYXA9InJvdW5kIiBzdHJva2UtbGluZWpvaW49InJvdW5kIj48cmVjdCB4PSIzIiB5PSIzIiB3aWR0aD0iMTgiIGhlaWdodD0iMTgiIHJ4PSIyIiByeT0iMiI+PC9yZWN0PjxjaXJjbGUgY3g9IjguNSIgY3k9IjguNSIgcj0iMS41Ij48L2NpcmNsZT48cG9seWxpbmUgcG9pbnRzPSIyMSAxNSAxNiAxMCA1IDIxIj48LcG9lyxpbmU+PC9zdmc+';
                                        target.classList.add('p-8', 'opacity-50');
                                    }}
                                />
                                <div className="absolute inset-0 bg-gradient-to-t from-black/80 to-transparent opacity-0 group-hover:opacity-100 transition-opacity flex flex-col justify-end p-2 pointer-events-none">
                                    <span className="text-white text-xs font-medium truncate">{asset.name}</span>
                                </div>

                                {/* 我的页·非多选:左上 = 添加到画布 + 改分类(点击卡片=查看) */}
                                {!manageMode && !isPublicTab && (
                                    <div className="absolute top-1 left-1 z-10 flex items-center gap-1" onClick={(e) => e.stopPropagation()}>
                                        <Tip label="添加到画布">
                                            <button
                                                onClick={(e) => { e.stopPropagation(); onSelectAsset(asset.url, asset.type); }}
                                                className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-500/80"
                                            >
                                                <Plus size={14} />
                                            </button>
                                        </Tip>
                                        <Tip label="改分类">
                                            <button
                                                className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-neutral-700"
                                                onClick={(e) => {
                                                    e.stopPropagation();
                                                    if (categoryMenuId === asset.id) { setCategoryMenuId(null); return; }
                                                    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
                                                    setCategoryMenuPos({ x: r.left, y: r.bottom + 4 });
                                                    setCategoryMenuId(asset.id);
                                                }}
                                            >
                                                <FolderInput size={14} />
                                            </button>
                                        </Tip>
                                        {/* 下拉菜单 portal 到 body，避开素材卡的 overflow-hidden 裁剪 */}
                                        {categoryMenuId === asset.id && categoryMenuPos && createPortal(
                                            <>
                                                <div className="fixed inset-0 z-[9998]" onClick={() => setCategoryMenuId(null)} />
                                                <div
                                                    className="fixed w-36 max-h-56 overflow-y-auto overscroll-contain bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-2xl py-1 z-[9999]"
                                                    style={{ left: categoryMenuPos.x, top: categoryMenuPos.y }}
                                                >
                                                    {categories.map((cat: string) => (
                                                        <button
                                                            key={cat}
                                                            onClick={() => { onChangeCategory?.(asset.id, cat); setCategoryMenuId(null); }}
                                                            className={`w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-800 flex items-center justify-between ${asset.category === cat ? 'text-white' : 'text-neutral-400'}`}
                                                        >
                                                            {cat}{asset.category === cat && <Check size={12} />}
                                                        </button>
                                                    ))}
                                                </div>
                                            </>,
                                            document.body,
                                        )}
                                    </div>
                                )}

                                {/* 公共页:加入我的库 / 我发布的 */}
                                {isPublicTab && (
                                    <div className="absolute top-1 right-1 z-10" onClick={(e) => e.stopPropagation()}>
                                        {asset.mine ? (
                                            <Tip label="你发布的素材">
                                                <span className="px-1.5 py-0.5 rounded-md bg-green-600/80 text-white text-[10px] flex items-center gap-0.5">
                                                    <Globe size={10} />我发布的
                                                </span>
                                            </Tip>
                                        ) : (
                                            <Tip label="加入我的素材库">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onAddFromPublic?.(asset.id); }}
                                                    className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-blue-600/80"
                                                >
                                                    <FolderPlus size={14} />
                                                </button>
                                            </Tip>
                                        )}
                                    </div>
                                )}

                                {/* 我的页:发布 + 删除（多选/删除确认时除外） */}
                                {!isPublicTab && !manageMode && deleteConfirmId !== asset.id && (
                                    <div className="absolute top-1 right-1 flex items-center gap-1 z-10" onClick={(e) => e.stopPropagation()}>
                                        {asset.visibility === 'public' ? (
                                            <Tip label="已发布到公共库，仅管理员可删">
                                                <span className="px-1.5 py-0.5 rounded-md bg-green-600/80 text-white text-[10px] flex items-center gap-0.5">
                                                    <Globe size={10} />公共
                                                </span>
                                            </Tip>
                                        ) : !asset.sourceAssetId ? (
                                            <Tip label="发布到公共库">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); onPublish?.(asset.id); }}
                                                    className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-green-600/80"
                                                >
                                                    <Globe size={14} />
                                                </button>
                                            </Tip>
                                        ) : null}
                                        {asset.visibility === 'public' ? (
                                            <Tip label="已发布到公共库，仅管理员可删">
                                                <button
                                                    onClick={(e) => { e.stopPropagation(); showToast('已发布到公共库，仅管理员可删', 'info'); }}
                                                    className="p-1.5 bg-black/40 text-neutral-500 rounded-md opacity-0 group-hover:opacity-100 cursor-not-allowed hover:text-neutral-300"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </Tip>
                                        ) : (
                                            <Tip label="删除素材">
                                                <button
                                                    onClick={(e) => handleDeleteClick(e, asset.id)}
                                                    className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-red-500/80"
                                                >
                                                    <Trash2 size={14} />
                                                </button>
                                            </Tip>
                                        )}
                                    </div>
                                )}

                                {/* 删除确认覆盖层（我的页） */}
                                {!isPublicTab && !manageMode && deleteConfirmId === asset.id && (
                                    <div className="absolute inset-0 bg-black/80 flex flex-col items-center justify-center gap-2 z-20 animate-in fade-in duration-200" onClick={(e) => e.stopPropagation()}>
                                        <span className="text-white text-xs font-medium">删除？</span>
                                        <div className="flex gap-2">
                                            <button
                                                className="px-2 py-1 bg-red-500 hover:bg-red-600 text-white text-xs rounded transition-colors"
                                                onClick={(e) => handleConfirmDelete(e, asset.id)}
                                            >
                                                是
                                            </button>
                                            <button
                                                className="px-2 py-1 bg-neutral-700 hover:bg-neutral-600 text-white text-xs rounded transition-colors"
                                                onClick={handleCancelDelete}
                                            >
                                                否
                                            </button>
                                        </div>
                                    </div>
                                )}
                            </div>
                        ))
                    )}
                </div>
            </div>

            {/* 查看大图/视频（缩放 + 平移）。portal 到 body：素材库面板有
                backdrop-blur + overflow-hidden，会成为 fixed 元素的包含块并裁剪，
                挂到 body 才能像历史面板那样全屏预览。 */}
            {createPortal(
                <ExpandedMediaModal mediaUrl={previewUrl} onClose={() => setPreviewUrl(null)} />,
                document.body,
            )}
        </>
    );
};
