/**
 * SettingsModal.tsx
 *
 * 应用内“设置”弹窗：用于填写并保存各类 API 密钥。
 * 密钥保存在后端配置文件中，保存后立即生效（无需重启）。
 */

import React, { useEffect, useState } from 'react';
import { Loader2, X, Eye, EyeOff } from 'lucide-react';

interface SettingsModalProps {
    isOpen: boolean;
    onClose: () => void;
}

interface FieldDef {
    key: string;
    label: string;
    placeholder?: string;
    hint?: string;
}

interface GroupDef {
    title: string;
    desc?: string;
    fields: FieldDef[];
    test?: string; // 非空则显示「测试」按钮，值为 /api/settings/test 的 group 名
}

const GROUPS: GroupDef[] = [
    {
        title: '文字模型 / AI 聊天',
        desc: '用于 AI 聊天助手与提示词优化。接口需兼容 OpenAI Chat（/chat/completions）。推荐 DeepSeek：网址 https://api.deepseek.com/v1、模型 deepseek-v4-pro（思考型，支持工具调用）。注意：DeepSeek 仅文本，「看图」请配下方「视觉模型」。',
        test: 'text',
        fields: [
            { key: 'TEXT_API_URL', label: '网址 (Base URL)', placeholder: 'https://api.deepseek.com/v1', hint: '例如 https://api.deepseek.com/v1' },
            { key: 'TEXT_API_KEY', label: 'KEY (API Key)', hint: 'sk- 开头的密钥' },
            { key: 'TEXT_MODEL', label: '模型名', placeholder: 'deepseek-v4-pro', hint: '例如 deepseek-v4-pro / deepseek-v4-flash / grok-4.20-fast（旧名 deepseek-chat 2026-07-24 弃用）' },
        ],
    },
    {
        title: '视觉模型（看图）',
        desc: '用于「看图描述」及聊天中分析图片。需多模态、兼容 OpenAI Chat（content 支持 image_url）。推荐小米 MiMo：网址 https://axiomcode.dev/v1、模型 mimo-v2.5。留空=沿用上面的文字端点（仅当文字模型本身支持视觉时才可留空）。',
        test: 'vision',
        fields: [
            { key: 'VISION_API_URL', label: '网址 (Base URL)', placeholder: '留空=沿用文字端点', hint: '例如 MiMo 的 https://axiomcode.dev/v1' },
            { key: 'VISION_API_KEY', label: 'KEY (API Key)', hint: '留空=沿用文字端点 KEY' },
            { key: 'VISION_MODEL', label: '模型名', placeholder: 'mimo-v2.5', hint: '需带视觉，例如 mimo-v2.5 / mimo-v2-omni / glm-4.6v' },
        ],
    },
    {
        title: '图片模型',
        desc: '用于图像生成 / 图生图。接口需兼容 OpenAI Images（/images/generations）。当前走 fp（fpbrowser2api → Google Flow）。',
        test: 'image',
        fields: [
            { key: 'IMAGE_API_URL', label: '网址 (Base URL)', placeholder: 'http://192.168.43.131:8002/v1', hint: 'fp（fpbrowser2api）地址' },
            { key: 'IMAGE_API_KEY', label: 'KEY (API Key)', hint: 'fp 的 API Key' },
            { key: 'IMAGE_MODEL', label: '模型名', placeholder: 'nana-banana-pro', hint: '例如 nana-banana-pro / nana-banana-2' },
        ],
    },
    {
        title: '视频模型',
        desc: '用于视频生成 / 图生视频。接口需兼容 /video/generations（异步任务 + 轮询）。当前走 fp（fpbrowser2api → Google Flow）。',
        test: 'video',
        fields: [
            { key: 'VIDEO_API_URL', label: '网址 (Base URL)', placeholder: 'http://192.168.43.131:8002/v1', hint: 'fp（fpbrowser2api）地址' },
            { key: 'VIDEO_API_KEY', label: 'KEY (API Key)', hint: 'fp 的 API Key' },
            { key: 'VIDEO_MODEL', label: '模型名', placeholder: 'veo-omni-flash', hint: '例如 veo-omni-flash / veo-3-1-lite / veo-3-1-fast / veo-3-1-quality' },
        ],
    },
    {
        title: '语音识别（智能字幕）',
        desc: '剪辑工作室「智能字幕」使用。支持小米 MiMo ASR（mimo-v2.5-asr）和 OpenAI Whisper 兼容接口（/audio/transcriptions）。',
        test: 'asr',
        fields: [
            { key: 'ASR_API_URL', label: '网址 (Base URL)', placeholder: 'MiMo / Whisper 兼容地址', hint: 'MiMo 或支持 /audio/transcriptions 的服务地址' },
            { key: 'ASR_API_KEY', label: 'KEY (API Key)', hint: 'API Key' },
            { key: 'ASR_MODEL', label: '模型名', placeholder: 'mimo-v2.5-asr', hint: '例如 mimo-v2.5-asr / whisper-1' },
        ],
    },
    {
        title: '生成设置',
        desc: '批量生成与一键创作的调度参数。',
        fields: [
            { key: 'GEN_CONCURRENCY', label: '生成并发数', placeholder: '3', hint: '同时进行的生图/生视频任务数，1-20。过大可能触发接口限流或导致预览加载失败，建议 3-8' },
        ],
    },
];

// 仅 *_API_KEY 字段以密码形式遮蔽；网址、模型名以明文显示
const SECRET_KEYS = new Set(
    GROUPS.flatMap(g => g.fields.map(f => f.key)).filter(k => k.endsWith('API_KEY'))
);

export const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const [values, setValues] = useState<Record<string, string>>({});
    const [loading, setLoading] = useState(false);
    const [saving, setSaving] = useState(false);
    const [savedTip, setSavedTip] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revealed, setRevealed] = useState<Record<string, boolean>>({});
    // 每个分组的测试状态：testing(进行中) + 结果（ok/msg）
    const [testing, setTesting] = useState<Record<string, boolean>>({});
    const [testResult, setTestResult] = useState<Record<string, { ok: boolean; msg: string }>>({});

    useEffect(() => {
        if (!isOpen) return;
        setError(null);
        setSavedTip(false);
        setLoading(true);
        fetch('/api/settings')
            .then(res => res.json())
            .then(data => {
                if (data && data.settings) setValues(data.settings);
            })
            .catch(err => setError('读取设置失败：' + err.message))
            .finally(() => setLoading(false));
    }, [isOpen]);

    const handleChange = (key: string, value: string) => {
        setValues(prev => ({ ...prev, [key]: value }));
        setSavedTip(false);
    };

    const toggleReveal = (key: string) => {
        setRevealed(prev => ({ ...prev, [key]: !prev[key] }));
    };

    const handleSave = async () => {
        try {
            setSaving(true);
            setError(null);
            const res = await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: values }),
            });
            if (!res.ok) {
                const data = await res.json().catch(() => ({}));
                throw new Error(data.error || '保存失败');
            }
            setSavedTip(true);
            setTimeout(() => setSavedTip(false), 2500);
        } catch (err: any) {
            setError(err.message || '保存失败');
        } finally {
            setSaving(false);
        }
    };

    // 测试某分组：先静默保存当前填写值，再调后端 /api/settings/test。
    const handleTest = async (groupName: string) => {
        try {
            setTesting(prev => ({ ...prev, [groupName]: true }));
            setTestResult(prev => ({ ...prev, [groupName]: undefined as any }));
            // 先保存，保证后端按最新值解析（含留空回退）。
            await fetch('/api/settings', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ settings: values }),
            });
            const res = await fetch('/api/settings/test', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ group: groupName }),
            });
            const data = await res.json().catch(() => ({}));
            setTestResult(prev => ({
                ...prev,
                [groupName]: { ok: !!data.success, msg: data.success ? (data.message || '连接成功') : (data.error || '测试失败') },
            }));
        } catch (err: any) {
            setTestResult(prev => ({ ...prev, [groupName]: { ok: false, msg: err.message || '测试失败' } }));
        } finally {
            setTesting(prev => ({ ...prev, [groupName]: false }));
        }
    };

    if (!isOpen) return null;

    return (
        <div className="fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[120]">
            <div className="bg-[#1a1a1a] border border-neutral-700 rounded-2xl w-[640px] max-w-[92vw] max-h-[88vh] flex flex-col shadow-2xl">
                {/* 头部 */}
                <div className="flex items-center justify-between px-6 py-4 border-b border-neutral-800">
                    <div>
                        <h2 className="text-lg font-semibold text-white">设置</h2>
                        <p className="text-xs text-neutral-500 mt-0.5">密钥仅保存在本机，保存后立即生效</p>
                    </div>
                    <button
                        onClick={onClose}
                        className="w-8 h-8 rounded-full flex items-center justify-center text-neutral-400 hover:text-white hover:bg-neutral-800 transition-colors"
                        title="关闭"
                    >
                        <X size={18} />
                    </button>
                </div>

                {/* 内容 */}
                <div className="flex-1 overflow-y-auto px-6 py-4 space-y-6">
                    {loading ? (
                        <div className="flex items-center justify-center py-10 text-neutral-400 gap-2">
                            <Loader2 className="w-5 h-5 animate-spin" /> 正在读取设置…
                        </div>
                    ) : (
                        GROUPS.map(group => (
                            <div key={group.title}>
                                <div className="flex items-center justify-between gap-2">
                                    <h3 className="text-sm font-semibold text-neutral-200">{group.title}</h3>
                                    {group.test && (
                                        <div className="flex items-center gap-2">
                                            {testResult[group.test] && (
                                                <span className={`text-[11px] ${testResult[group.test].ok ? 'text-green-400' : 'text-red-400'}`}>
                                                    {testResult[group.test].ok ? '✓ ' : '✗ '}{testResult[group.test].msg}
                                                </span>
                                            )}
                                            <button
                                                type="button"
                                                onClick={() => handleTest(group.test!)}
                                                disabled={!!testing[group.test]}
                                                className="px-2.5 py-1 rounded-md bg-neutral-800 hover:bg-neutral-700 text-neutral-200 text-[11px] transition-colors flex items-center gap-1 disabled:opacity-50"
                                                title="保存并测试该分组的连通性"
                                            >
                                                {testing[group.test] ? (<><Loader2 className="w-3 h-3 animate-spin" /> 测试中</>) : '测试'}
                                            </button>
                                        </div>
                                    )}
                                </div>
                                {group.desc && <p className="text-xs text-neutral-500 mt-1 mb-3">{group.desc}</p>}
                                <div className="space-y-3">
                                    {group.fields.map(field => {
                                        const isSecret = SECRET_KEYS.has(field.key);
                                        const show = revealed[field.key];
                                        return (
                                            <div key={field.key}>
                                                <label className="block text-xs text-neutral-400 mb-1">{field.label}</label>
                                                <div className="relative">
                                                    <input
                                                        type={isSecret && !show ? 'password' : 'text'}
                                                        value={values[field.key] || ''}
                                                        placeholder={field.placeholder || '未设置'}
                                                        onChange={(e) => handleChange(field.key, e.target.value)}
                                                        autoComplete="off"
                                                        spellCheck={false}
                                                        className="w-full bg-neutral-900 border border-neutral-700 rounded-lg px-3 py-2 pr-10 text-sm text-white outline-none focus:border-blue-500 transition-colors"
                                                    />
                                                    {isSecret && (
                                                        <button
                                                            type="button"
                                                            onClick={() => toggleReveal(field.key)}
                                                            className="absolute right-2 top-1/2 -translate-y-1/2 text-neutral-500 hover:text-neutral-300"
                                                            title={show ? '隐藏' : '显示'}
                                                        >
                                                            {show ? <EyeOff size={16} /> : <Eye size={16} />}
                                                        </button>
                                                    )}
                                                </div>
                                                {field.hint && <p className="text-[11px] text-neutral-600 mt-1">{field.hint}</p>}
                                            </div>
                                        );
                                    })}
                                </div>
                            </div>
                        ))
                    )}
                </div>

                {/* 底部 */}
                <div className="flex items-center justify-between px-6 py-4 border-t border-neutral-800">
                    <div className="text-xs">
                        {error && <span className="text-red-400">{error}</span>}
                        {savedTip && !error && <span className="text-green-400">已保存，立即生效</span>}
                    </div>
                    <div className="flex gap-3">
                        <button
                            onClick={onClose}
                            className="px-4 py-2 rounded-lg bg-neutral-800 hover:bg-neutral-700 text-white text-sm transition-colors"
                        >
                            关闭
                        </button>
                        <button
                            onClick={handleSave}
                            disabled={saving || loading}
                            className="px-5 py-2 rounded-lg bg-blue-600 hover:bg-blue-500 text-white text-sm transition-colors flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                        >
                            {saving ? (<><Loader2 className="w-4 h-4 animate-spin" /> 保存中…</>) : '保存'}
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
