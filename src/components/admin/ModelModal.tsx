/**
 * ModelModal.tsx — create / edit a registry model.
 * Capabilities are edited via structured fields per category (the same shape the
 * canvas consumes: resolutions / aspectRatios / durations / supports*).
 * 「拉取上游」fetches the provider's /models list to pick a wire model id from.
 */
import React, { useEffect, useState } from 'react';
import { Loader2, X, DownloadCloud } from 'lucide-react';
import { showToast } from '../Toast';
import { Select } from '../ui/Select';
import type { Provider } from './ModelConfig';

export interface RegistryModel {
    id: string;
    modelId: string;
    label: string;
    category: string;
    providerId: string;
    enabled: boolean;
    isDefault: boolean;
    capabilities: Record<string, unknown>;
    sortOrder?: number;
}

const CATEGORIES = [
    { key: 'image', label: '图片' }, { key: 'video', label: '视频' },
    { key: 'text', label: '文字 / Agent' }, { key: 'vision', label: '视觉 (看图)' },
    { key: 'asr', label: '语音识别 (字幕)' },
];

async function api(url: string, init?: RequestInit) {
    const res = await fetch(url, init);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `HTTP ${res.status}`);
    return data;
}

const csv = (arr: unknown): string => Array.isArray(arr) ? arr.join(', ') : '';
const parseCsv = (s: string): string[] => s.split(',').map(x => x.trim()).filter(Boolean);
const parseNums = (s: string): number[] => parseCsv(s).map(Number).filter(n => !Number.isNaN(n));

export const ModelModal: React.FC<{
    open: boolean;
    model?: RegistryModel;
    presetCategory?: string;
    providers: Provider[];
    onClose: () => void;
    onSaved: () => void;
}> = ({ open, model, presetCategory, providers, onClose, onSaved }) => {
    const editing = !!model;
    const [modelId, setModelId] = useState('');
    const [label, setLabel] = useState('');
    const [category, setCategory] = useState('image');
    const [providerId, setProviderId] = useState('');
    const [enabled, setEnabled] = useState(true);
    const [isDefault, setIsDefault] = useState(false);
    // capability fields
    const [recommended, setRecommended] = useState(false);
    const [resolutions, setResolutions] = useState('');
    const [aspectRatios, setAspectRatios] = useState('');
    const [durations, setDurations] = useState('');
    const [caps, setCaps] = useState<Record<string, boolean>>({});
    const [busy, setBusy] = useState(false);
    const [upstream, setUpstream] = useState<string[]>([]);
    const [fetching, setFetching] = useState(false);

    useEffect(() => {
        if (!open) return;
        const c = model?.capabilities || {};
        setModelId(model?.modelId || '');
        setLabel(model?.label || '');
        setCategory(model?.category || presetCategory || 'image');
        setProviderId(model?.providerId || providers[0]?.id || '');
        setEnabled(model ? model.enabled : true);
        setIsDefault(model ? model.isDefault : false);
        setRecommended(!!c.recommended);
        setResolutions(csv(c.resolutions));
        setAspectRatios(csv(c.aspectRatios));
        setDurations(csv(c.durations));
        setCaps({
            supportsImageToImage: !!c.supportsImageToImage,
            supportsMultiImage: !!c.supportsMultiImage,
            supportsTextToVideo: !!c.supportsTextToVideo,
            supportsImageToVideo: !!c.supportsImageToVideo,
            supportsFirstLastFrame: !!c.supportsFirstLastFrame,
            supportsFunctionCalling: !!c.supportsFunctionCalling,
            supportsThinking: !!c.supportsThinking,
            supportsVision: !!c.supportsVision,
        });
        setUpstream([]);
    }, [open, model, presetCategory, providers]);

    if (!open) return null;
    const close = () => { if (!busy) onClose(); };
    const flag = (k: string) => caps[k] || false;
    const setFlag = (k: string, v: boolean) => setCaps(p => ({ ...p, [k]: v }));

    const fetchUpstream = async () => {
        if (!providerId) { showToast('请先选择接入点', 'error'); return; }
        setFetching(true);
        try { const d = await api(`/api/admin/providers/${providerId}/upstream-models`); setUpstream(d.models || []); showToast(`拉取到 ${d.models?.length || 0} 个上游模型`, 'success'); }
        catch (e) { showToast(e instanceof Error ? e.message : '拉取失败', 'error'); }
        finally { setFetching(false); }
    };

    const buildCapabilities = (): Record<string, unknown> => {
        const c: Record<string, unknown> = {};
        if (recommended) c.recommended = true;
        if (category === 'image') {
            if (flag('supportsImageToImage')) c.supportsImageToImage = true;
            if (flag('supportsMultiImage')) c.supportsMultiImage = true;
            if (resolutions) c.resolutions = parseCsv(resolutions);
            if (aspectRatios) c.aspectRatios = parseCsv(aspectRatios);
        } else if (category === 'video') {
            if (flag('supportsTextToVideo')) c.supportsTextToVideo = true;
            if (flag('supportsImageToVideo')) c.supportsImageToVideo = true;
            if (flag('supportsMultiImage')) c.supportsMultiImage = true;
            if (flag('supportsFirstLastFrame')) c.supportsFirstLastFrame = true;
            if (durations) c.durations = parseNums(durations);
            if (resolutions) c.resolutions = parseCsv(resolutions);
            if (aspectRatios) c.aspectRatios = parseCsv(aspectRatios);
        } else if (category === 'text') {
            if (flag('supportsFunctionCalling')) c.supportsFunctionCalling = true;
            if (flag('supportsThinking')) c.supportsThinking = true;
        } else if (category === 'vision') {
            if (flag('supportsVision')) c.supportsVision = true;
        }
        return c;
    };

    const submit = async (e: React.FormEvent) => {
        e.preventDefault();
        if (busy) return;
        if (!modelId.trim()) { showToast('请输入模型 ID', 'error'); return; }
        if (!providerId) { showToast('请选择接入点', 'error'); return; }
        setBusy(true);
        try {
            const body = { modelId: modelId.trim(), label: label.trim() || modelId.trim(), category, providerId, enabled, isDefault, capabilities: buildCapabilities() };
            if (editing) await api(`/api/admin/models/${model!.id}`, { method: 'PUT', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            else await api('/api/admin/models', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            showToast(editing ? '已保存' : '已添加模型', 'success');
            onSaved();
        } catch (e) { showToast(e instanceof Error ? e.message : '保存失败', 'error'); }
        finally { setBusy(false); }
    };

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[130] p-4" onClick={close}>
            <form onClick={e => e.stopPropagation()} onSubmit={submit}
                className="w-full max-w-lg max-h-[90vh] overflow-y-auto bg-white dark:bg-[#1a1a1a] border border-neutral-300 dark:border-neutral-700 rounded-2xl shadow-2xl p-6 flex flex-col gap-3.5">
                <div className="flex items-center justify-between">
                    <h3 className="text-base font-semibold text-neutral-900 dark:text-white">{editing ? '编辑模型' : '添加模型'}</h3>
                    <button type="button" onClick={close} className="text-neutral-400 dark:text-neutral-500 hover:text-neutral-900 dark:hover:text-white"><X size={18} /></button>
                </div>

                <div className="grid grid-cols-2 gap-3">
                    <Field label="类别">
                        <Select value={category} onChange={setCategory} options={CATEGORIES.map(c => ({ value: c.key, label: c.label }))} />
                    </Field>
                    <Field label="接入点">
                        <Select value={providerId} onChange={setProviderId} options={providers.length ? providers.map(p => ({ value: p.id, label: p.name })) : [{ value: '', label: '（请先建接入点）' }]} />
                    </Field>
                </div>

                <Field label="模型 ID（调用时发送给接口的 model 名）">
                    <div className="flex gap-2">
                        <input value={modelId} onChange={e => setModelId(e.target.value)} list="upstream-models" placeholder="如 deepseek-v4-pro"
                            className={`${inputCls} font-mono flex-1`} />
                        <button type="button" onClick={fetchUpstream} disabled={fetching}
                            className="shrink-0 flex items-center gap-1 px-2.5 rounded-lg text-xs bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-700 dark:text-neutral-300 disabled:opacity-50">
                            {fetching ? <Loader2 size={13} className="animate-spin" /> : <DownloadCloud size={13} />} 拉取上游
                        </button>
                    </div>
                    <datalist id="upstream-models">{upstream.map(m => <option key={m} value={m} />)}</datalist>
                </Field>
                <Field label="显示名称">
                    <input value={label} onChange={e => setLabel(e.target.value)} placeholder="下拉框里显示的名字" className={inputCls} />
                </Field>

                <div className="flex items-center gap-5 py-1">
                    <Check label="启用" checked={enabled} onChange={setEnabled} />
                    <Check label="设为该类默认" checked={isDefault} onChange={setIsDefault} />
                    <Check label="标记推荐" checked={recommended} onChange={setRecommended} />
                </div>

                {/* category-specific capabilities */}
                {category === 'image' && (
                    <CapBox title="图片能力">
                        <Check label="支持图生图" checked={flag('supportsImageToImage')} onChange={v => setFlag('supportsImageToImage', v)} />
                        <Check label="支持多图参考" checked={flag('supportsMultiImage')} onChange={v => setFlag('supportsMultiImage', v)} />
                        <CsvField label="分辨率（逗号分隔）" value={resolutions} onChange={setResolutions} placeholder="1K, 2K, 4K" />
                        <CsvField label="比例（逗号分隔）" value={aspectRatios} onChange={setAspectRatios} placeholder="Auto, 1:1, 16:9, 9:16" />
                    </CapBox>
                )}
                {category === 'video' && (
                    <CapBox title="视频能力">
                        <Check label="文生视频" checked={flag('supportsTextToVideo')} onChange={v => setFlag('supportsTextToVideo', v)} />
                        <Check label="图生视频" checked={flag('supportsImageToVideo')} onChange={v => setFlag('supportsImageToVideo', v)} />
                        <Check label="多图参考" checked={flag('supportsMultiImage')} onChange={v => setFlag('supportsMultiImage', v)} />
                        <Check label="首尾帧" checked={flag('supportsFirstLastFrame')} onChange={v => setFlag('supportsFirstLastFrame', v)} />
                        <CsvField label="时长 秒（逗号分隔）" value={durations} onChange={setDurations} placeholder="4, 6, 8, 10" />
                        <CsvField label="分辨率（逗号分隔）" value={resolutions} onChange={setResolutions} placeholder="720p, 1080p" />
                        <CsvField label="比例（逗号分隔）" value={aspectRatios} onChange={setAspectRatios} placeholder="16:9, 9:16" />
                    </CapBox>
                )}
                {category === 'text' && (
                    <CapBox title="文字能力">
                        <Check label="支持 Function Calling" checked={flag('supportsFunctionCalling')} onChange={v => setFlag('supportsFunctionCalling', v)} />
                        <Check label="支持思考模式" checked={flag('supportsThinking')} onChange={v => setFlag('supportsThinking', v)} />
                    </CapBox>
                )}
                {category === 'vision' && (
                    <CapBox title="视觉能力">
                        <Check label="支持看图" checked={flag('supportsVision')} onChange={v => setFlag('supportsVision', v)} />
                    </CapBox>
                )}

                <div className="flex justify-end gap-2 mt-1">
                    <button type="button" onClick={close} disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-neutral-200 dark:bg-neutral-800 hover:bg-neutral-200 dark:hover:bg-neutral-700 text-neutral-900 dark:text-white disabled:opacity-50">取消</button>
                    <button type="submit" disabled={busy} className="px-3 py-1.5 rounded-lg text-sm bg-blue-600 hover:bg-blue-500 text-white flex items-center gap-1.5 disabled:opacity-50">
                        {busy && <Loader2 size={14} className="animate-spin" />}{editing ? '保存' : '添加'}
                    </button>
                </div>
            </form>
        </div>
    );
};

const inputCls = 'w-full bg-white dark:bg-neutral-950 border border-neutral-300 dark:border-neutral-700 rounded-lg px-3 py-2 text-sm text-neutral-800 dark:text-neutral-200 outline-none focus:border-blue-500/60';

const Field: React.FC<{ label: string; children: React.ReactNode }> = ({ label, children }) => (
    <label className="flex flex-col gap-1"><span className="text-[11px] text-neutral-400 dark:text-neutral-500">{label}</span>{children}</label>
);
const CsvField: React.FC<{ label: string; value: string; onChange: (v: string) => void; placeholder?: string }> = ({ label, value, onChange, placeholder }) => (
    <Field label={label}><input value={value} onChange={e => onChange(e.target.value)} placeholder={placeholder} className={inputCls} /></Field>
);
const Check: React.FC<{ label: string; checked: boolean; onChange: (v: boolean) => void }> = ({ label, checked, onChange }) => (
    <label className="flex items-center gap-1.5 text-sm text-neutral-700 dark:text-neutral-300 cursor-pointer select-none">
        <input type="checkbox" checked={checked} onChange={e => onChange(e.target.checked)} className="accent-blue-500" />{label}
    </label>
);
const CapBox: React.FC<{ title: string; children: React.ReactNode }> = ({ title, children }) => (
    <div className="rounded-lg border border-neutral-200 dark:border-neutral-800 bg-neutral-50 dark:bg-neutral-900/40 p-3 flex flex-col gap-2.5">
        <div className="text-[11px] font-medium text-neutral-500 dark:text-neutral-400">{title}</div>
        <div className="flex flex-wrap gap-x-5 gap-y-2">{children}</div>
    </div>
);
