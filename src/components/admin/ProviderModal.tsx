/**
 * ProviderModal.tsx — create / edit a registry provider (baseUrl + apiKey + kind).
 * On edit, leaving apiKey blank keeps the existing key (never clobbered).
 */
import React, { useEffect, useState } from 'react';
import { Loader2, X } from 'lucide-react';
import { showToast } from '../Toast';
import type { Provider } from './ModelConfig';

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

export const ProviderModal: React.FC<{
    open: boolean;
    provider?: Provider;
    onClose: () => void;
    onSaved: () => void;
}> = ({ open, provider, onClose, onSaved }) => {
    const editing = !!provider;
    const [name, setName] = useState('');
    const [kind, setKind] = useState<'fp' | 'openai'>('openai');
    const [baseUrl, setBaseUrl] = useState('');
    const [apiKey, setApiKey] = useState('');
    const [busy, setBusy] = useState(false);

    useEffect(() => {
        if (open) {
            setName(provider?.name || '');
            setKind(provider?.kind || 'openai');
            setBaseUrl(provider?.baseUrl || '');
            setApiKey('');
        }
    }, [open, provider]);

    if (!open) return null;
    const close = () => { if (!busy) onClose(); };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        if (!name.trim()) { showToast('请输入名称', 'error'); return; }
        setBusy(true);
        try {
            const body: Record<string, unknown> = { name: name.trim(), kind, baseUrl: baseUrl.trim() };
            if (apiKey) body.apiKey = apiKey; // 留空=不修改（编辑）/不设置（新建）
            if (editing) await api(`/api/admin/providers/${provider!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            else await api('/api/admin/providers', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            showToast(editing ? '已保存' : '已创建接入点', 'success');
            onSaved();
        } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130]" onClick={close}>
            <form onClick={e => e.stopPropagation()} onSubmit={submit}
                className="w-full max-w-md bg-[#1a1a1a] border border-neutral-700 rounded-2xl shadow-2xl p-6 flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-white">{editing ? '编辑接入点' : '新建接入点'}</h3>
                    <button type="button" onClick={close} className="text-neutral-500 hover:text-white"><X size={18} /></button>
                </div>
                <Field label="名称">
                    <input value={name} onChange={e => setName(e.target.value)} autoFocus placeholder="如 DeepSeek / Flow"
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60" />
                </Field>
                <Field label="类型">
                    <select value={kind} onChange={e => setKind(e.target.value as 'fp' | 'openai')}
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 outline-none focus:border-blue-500/60">
                        <option value="openai">OpenAI 兼容（文字 / 视觉 / 通用）</option>
                        <option value="fp">Flow (fp) 网关（图片 / 视频）</option>
                    </select>
                </Field>
                <Field label="Base URL">
                    <input value={baseUrl} onChange={e => setBaseUrl(e.target.value)} placeholder="https://api.example.com/v1"
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 font-mono outline-none focus:border-blue-500/60" />
                </Field>
                <Field label={editing ? 'API Key（留空=不修改）' : 'API Key'}>
                    <input type="text" value={apiKey} onChange={e => setApiKey(e.target.value)} placeholder={editing ? (provider?.hasKey ? '••••••（已配置，留空保持不变）' : '尚未配置') : 'sk-...'}
                        className="w-full bg-neutral-950 border border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-200 font-mono outline-none focus:border-blue-500/60" />
                </Field>
                <div className="flex justify-end gap-2 mt-1">
                    <button type="button" onClick={close} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-800 hover:bg-neutral-700 text-white disabled:opacity-50">取消</button>
                    <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50">
                        {busy && <Loader2 size={14} className="animate-spin" />}{editing ? '保存' : '创建'}
                    </button>
                </div>
            </form>
        </div>
    );
};

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="flex flex-col gap-1">
        <span className="text-[11px] text-neutral-500">{label}</span>
        {children}
    </label>
);
