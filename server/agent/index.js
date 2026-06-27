/**
 * agent/index.js
 *
 * 画布 Agent 的后端编排（function-calling 版）。
 *
 * 架构：客户端驱动的多轮工具循环。
 *  - 前端每发一条用户消息 → sendMessage 开启一个 turn；
 *  - 模型返回 tool_calls → 路由经 SSE 下发给前端 → 前端在画布执行并回传结果；
 *  - 前端调 submitToolResults 续上 → 模型据结果决定继续调用工具或给出最终回复(stop)。
 *  - 一个 turn 内的工具消息栈临时存在 session.pending 里；历史只持久化「干净视图」
 *    （用户消息 + 最终 assistant 文本），供侧边栏会话列表使用。
 *
 * 使用 OpenAI 原生 function calling（DeepSeek 等兼容模型直接支持 tools 字段）。
 */

import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { getKey } from "../config.js";
import { gpt2apiChat, requestChatCompletion } from "../services/gpt2api.js";
import { AGENT_SYSTEM_PROMPT, TOPIC_GENERATION_PROMPT } from "./prompts/system.js";
import { TOOL_SCHEMAS, TOOL_NAMES } from "./tools/index.js";

/** 一个 turn 内最多自主调用工具的轮数（防失控成本），由路由侧据此兜底。 */
export const MAX_AGENT_STEPS = 10;

// 读取文字模型配置（聊天 Agent / function calling）
function getTextConfig() {
    return {
        apiKey: getKey('TEXT_API_KEY'),
        baseUrl: getKey('TEXT_API_URL'),
        model: getKey('TEXT_MODEL') || 'grok-4.20-fast',
    };
}

// 读取视觉模型配置（看图，留空回退到文字端点）
function getVisionConfig() {
    return {
        apiKey: getKey('VISION_API_KEY'),
        baseUrl: getKey('VISION_API_URL'),
        model: getKey('VISION_MODEL') || 'mimo-v2.5',
    };
}

/** 基于会话生成简短主题标题（使用 gpt2api 文本模型） */
export async function generateTopicTitle(messages) {
    const { apiKey, baseUrl, model } = getTextConfig();
    if (!apiKey) return 'New Chat';

    const firstUser = messages.find(m => m.role === 'user');
    const userText = firstUser
        ? (typeof firstUser.content === 'string' ? firstUser.content : '用户分享了图片/视频')
        : '';

    const oaMessages = [
        { role: 'system', content: TOPIC_GENERATION_PROMPT },
        { role: 'user', content: userText || 'New conversation' },
    ];
    // maxTokens 不能太小：思考型模型会先消耗推理 token，给太少会导致正文为空
    const title = await gpt2apiChat({ messages: oaMessages, model, baseUrl, apiKey, temperature: 0.3, maxTokens: 1024 });
    return (title || 'New Chat').trim().replace(/^["']|["']$/g, '').slice(0, 40) || 'New Chat';
}

// ============================================================================
// FILE PATHS
// ============================================================================

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
// 必须使用 LIBRARY_DIR（EXE 里指向用户数据目录）：便携版每次启动解压到新的临时目录，
// 按 __dirname 相对路径存聊天记录会导致重启后历史丢失
const LIBRARY_DIR = process.env.LIBRARY_DIR || path.join(__dirname, '..', '..', 'library');
const CHATS_DIR = path.join(LIBRARY_DIR, 'chats');
const IMAGES_DIR = path.join(LIBRARY_DIR, 'images');

// Ensure chats directory exists
if (!fs.existsSync(CHATS_DIR)) {
    fs.mkdirSync(CHATS_DIR, { recursive: true });
}

/**
 * Resolve an image URL or base64 to a base64 data URL
 * Handles both file paths (/library/images/...) and data URLs
 */
function resolveImageToBase64(imageInput) {
    if (!imageInput) return null;

    // Already a base64 data URL
    if (imageInput.startsWith('data:')) {
        return imageInput;
    }

    // Handle full URL or path
    let cleanPath = imageInput;
    try {
        if (imageInput.startsWith('http')) {
            const u = new URL(imageInput);
            cleanPath = u.pathname;
        }
    } catch (e) {
        // invalid url, treat as path
    }

    // Decode URI components (e.g., %20 -> space)
    cleanPath = decodeURIComponent(cleanPath);

    // File URL - read from disk
    if (cleanPath.startsWith('/library/images/')) {
        const filename = cleanPath.replace('/library/images/', '');
        const filePath = path.join(IMAGES_DIR, filename);
        if (fs.existsSync(filePath)) {
            const buffer = fs.readFileSync(filePath);
            const ext = path.extname(filename).toLowerCase();
            const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
            return `data:${mimeType};base64,${buffer.toString('base64')}`;
        }
    }

    // Return as-is if unknown format
    return imageInput;
}

/**
 * 把聊天附件持久化：库内/网络 URL 直接引用；base64（含 data URL）写入 library/images
 * 并返回 /library/images/... 路径。失败返回 null（该附件历史里不显示但不影响发送）。
 */
function persistMediaToLibrary(m, idx) {
    try {
        // 已有可持久引用的 URL（画布节点拖入的素材）
        if (m.url && !m.url.startsWith('data:')) {
            if (m.url.startsWith('http')) {
                try { return new URL(m.url).pathname; } catch { return m.url; }
            }
            return m.url;
        }
        let src = m.base64 || m.url || '';
        if (typeof src !== 'string' || !src) return null;
        // base64 字段里塞的是路径（旧调用方式）
        if (!src.startsWith('data:') && (src.startsWith('/library/') || src.startsWith('http'))) {
            try { return src.startsWith('http') ? new URL(src).pathname : src; } catch { return src; }
        }

        let ext = m.type === 'video' ? 'mp4' : 'png';
        let base64Data = src;
        if (src.startsWith('data:')) {
            const mime = src.slice(5, src.indexOf(';'));
            if (mime === 'image/jpeg') ext = 'jpg';
            else if (mime === 'image/webp') ext = 'webp';
            else if (mime === 'image/gif') ext = 'gif';
            base64Data = src.split(',')[1] || '';
        }
        if (!base64Data || base64Data.length < 50) return null;

        const dir = m.type === 'video' ? path.join(LIBRARY_DIR, 'videos') : IMAGES_DIR;
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        const filename = `chat_${Date.now()}_${idx}.${ext}`;
        fs.writeFileSync(path.join(dir, filename), base64Data, 'base64');
        return `/library/${m.type === 'video' ? 'videos' : 'images'}/${filename}`;
    } catch (err) {
        console.warn('[Chat] persist media failed:', err.message);
        return null;
    }
}

// ============================================================================
// SESSION MANAGEMENT (FILE-BASED)
// ============================================================================

/**
 * 内存中的活跃会话缓存。
 * session.messages 为「干净视图」纯对象数组：{ role:'user'|'assistant', content:string, media? }。
 * session.pending（可选）保存进行中 turn 的工具消息栈，turn 结束后清空，不落盘。
 */
const sessionCache = new Map();

/** 多模态 content（含 image_url）转成可序列化的纯文本，避免存巨大 base64 */
function contentToText(content) {
    if (typeof content === 'string') return content;
    if (Array.isArray(content)) {
        const parts = [];
        let imageCount = 0;
        for (const part of content) {
            if (part.type === 'text') parts.push(part.text);
            else if (part.type === 'image_url') { imageCount++; parts.push(`[IMAGE ${imageCount} ATTACHED]`); }
        }
        return parts.join('\n');
    }
    return JSON.stringify(content);
}

function getSessionPath(sessionId) {
    return path.join(CHATS_DIR, `${sessionId}.json`);
}

/** 保存会话到磁盘（仅持久化干净视图，不含 pending 工具栈） */
function saveSession(sessionId, session) {
    const filePath = getSessionPath(sessionId);
    const data = {
        id: sessionId,
        topic: session.topic,
        ownerId: session.ownerId,
        summary: session.summary || '',
        summarizedCount: session.summarizedCount || 0,
        createdAt: session.createdAt,
        updatedAt: new Date().toISOString(),
        messages: session.messages.map(m => ({
            role: m.role,
            content: m.content,
            media: m.media,
            timestamp: m.timestamp || new Date().toISOString(),
        })),
    };
    fs.writeFileSync(filePath, JSON.stringify(data, null, 2));
}

function loadSession(sessionId) {
    const filePath = getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
        const content = fs.readFileSync(filePath, 'utf8');
        const data = JSON.parse(content);
        return {
            messages: (data.messages || []).map(m => ({
                role: m.role === 'assistant' ? 'assistant' : 'user',
                content: typeof m.content === 'string' ? m.content : contentToText(m.content),
                media: m.media,
                timestamp: m.timestamp,
            })),
            topic: data.topic,
            ownerId: data.ownerId,
            summary: data.summary || '',
            summarizedCount: data.summarizedCount || 0,
            createdAt: new Date(data.createdAt),
            pending: null,
        };
    } catch (err) {
        console.error(`Failed to load session ${sessionId}:`, err);
        return null;
    }
}

export function getSession(sessionId) {
    if (sessionCache.has(sessionId)) return sessionCache.get(sessionId);
    const loaded = loadSession(sessionId);
    if (loaded) { sessionCache.set(sessionId, loaded); return loaded; }
    const newSession = { messages: [], topic: null, summary: '', summarizedCount: 0, createdAt: new Date(), pending: null };
    sessionCache.set(sessionId, newSession);
    return newSession;
}

export function deleteSession(sessionId) {
    sessionCache.delete(sessionId);
    const filePath = getSessionPath(sessionId);
    if (fs.existsSync(filePath)) { fs.unlinkSync(filePath); return true; }
    return false;
}

export function listSessions() {
    if (!fs.existsSync(CHATS_DIR)) return [];
    const files = fs.readdirSync(CHATS_DIR).filter(f => f.endsWith('.json'));
    const sessions = [];
    for (const file of files) {
        try {
            const data = JSON.parse(fs.readFileSync(path.join(CHATS_DIR, file), 'utf8'));
            sessions.push({
                id: data.id,
                topic: data.topic || "New Chat",
                createdAt: data.createdAt,
                updatedAt: data.updatedAt,
                messageCount: data.messages?.length || 0,
            });
        } catch (err) {
            console.error(`Failed to read session file ${file}:`, err);
        }
    }
    return sessions.sort((a, b) => new Date(b.updatedAt || b.createdAt) - new Date(a.updatedAt || a.createdAt));
}

export function getSessionData(sessionId) {
    const filePath = getSessionPath(sessionId);
    if (!fs.existsSync(filePath)) return null;
    try {
        return JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } catch (err) {
        console.error(`Failed to load session data ${sessionId}:`, err);
        return null;
    }
}

// ============================================================================
// AGENT TURN（多轮工具循环）
// ============================================================================

/**
 * 调用一次模型：使用 OpenAI 原生 function calling（DeepSeek 等兼容模型直接支持）。
 * 返回 { content, tool_calls, finish_reason }。
 */
async function runModel(working, onDelta) {
    const { apiKey, baseUrl, model } = getTextConfig();
    if (!apiKey) throw new Error('未配置文字模型 KEY，请在「设置」中填写后再使用聊天');

    const messages = [{ role: 'system', content: AGENT_SYSTEM_PROMPT }, ...working];
    const { content, toolCalls, finishReason } = await requestChatCompletion({
        messages, model, baseUrl, apiKey,
        tools: TOOL_SCHEMAS, toolChoice: 'auto',
        temperature: 0.3, // 工具调度场景：低温让 agent 行为更稳定（创意类回复也够用）
        onDelta,
    });
    const filtered = (toolCalls || []).filter(tc => !TOOL_NAMES || TOOL_NAMES.includes(tc.function?.name));
    return {
        content: content || '',
        tool_calls: filtered,
        finish_reason: filtered.length ? 'tool_calls' : (finishReason || 'stop'),
    };
}

/**
 * 文字模型（如 DeepSeek）多为纯文本，对 image_url 直接报错。
 * 本轮带图片时，先用视觉模型(MiMo/GLM-V)把每张图转成文字描述，
 * 再以纯文本喂给文字模型，这样 Agent 既能"看图"又保留 function calling。
 */
async function describeMediaToText(media) {
    if (!Array.isArray(media) || media.length === 0) return '';
    const { apiKey, baseUrl, model } = getVisionConfig();
    if (!apiKey) return '';
    const lines = [];
    let imgIdx = 0;
    for (const m of media) {
        if (m.type === 'video') { lines.push('（用户附带了一个视频，暂不支持直接分析其画面）'); continue; }
        const resolved = resolveImageToBase64(m.base64 || m.url);
        if (!resolved) continue;
        imgIdx++;
        const base64Data = resolved.includes(',') ? resolved.split(',')[1] : resolved;
        const dataUrl = `data:image/png;base64,${base64Data}`;
        try {
            const desc = await gpt2apiChat({
                messages: [{ role: 'user', content: [
                    { type: 'text', text: '详细描述这张图片的内容、主体、风格、颜色与构图，用中文，简洁但信息完整。' },
                    { type: 'image_url', image_url: { url: dataUrl } },
                ] }],
                model, baseUrl, apiKey, maxTokens: 1024,
            });
            lines.push(`图${imgIdx}：${(desc || '').trim() || '（无法识别）'}`);
        } catch (e) {
            console.error('[Agent] vision describe failed:', e.message);
            lines.push(`图${imgIdx}：（图片分析失败：${e.message}）`);
        }
    }
    if (!lines.length) return '';
    return `\n\n[用户本轮附带的图片内容如下（由视觉模型识别）]\n${lines.join('\n')}`;
}

// ============================================================================
// 超长对话自动裁剪/摘要：UI 保留全部历史，但喂给模型的上下文有界
// ----------------------------------------------------------------------------
// 当"未摘要"消息超过 COMPACT_TRIGGER 条时，把较早的部分（保留最近 KEEP_RECENT 条
// 不动）压缩进 session.summary，并推进 summarizedCount。喂给模型的 history =
// [摘要(若有)] + 最近未摘要消息。session.messages 永不删除（前端照常显示全部）。
// ============================================================================
const KEEP_RECENT = 16;       // 最近多少条原样保留
const COMPACT_TRIGGER = 30;   // 未摘要消息超过这个数才触发压缩

async function maybeCompactSession(session) {
    const start = session.summarizedCount || 0;
    const unsummarized = session.messages.slice(start);
    if (unsummarized.length <= COMPACT_TRIGGER) return;

    const toFold = unsummarized.slice(0, unsummarized.length - KEEP_RECENT);
    if (toFold.length === 0) return;

    const transcript = toFold
        .map(m => `${m.role === 'user' ? '用户' : '助手'}：${typeof m.content === 'string' ? m.content : '[媒体]'}`)
        .join('\n')
        .slice(0, 12000);
    const prior = session.summary ? `已有摘要：\n${session.summary}\n\n` : '';

    try {
        const { apiKey, baseUrl, model } = getTextConfig();
        if (!apiKey) return;
        const summary = await gpt2apiChat({
            messages: [
                { role: 'system', content: '你是对话摘要器。把下面的对话压缩成简洁中文要点，保留：用户的目标/偏好、已确定的事实与决定、画布上已建的关键节点/链路、尚未完成的事项。合并已有摘要，不要丢失关键信息。只输出摘要正文，不要寒暄。' },
                { role: 'user', content: `${prior}新增对话：\n${transcript}` },
            ],
            model, baseUrl, apiKey, temperature: 0.3, maxTokens: 1500,
        });
        if (summary && summary.trim()) {
            session.summary = summary.trim();
            session.summarizedCount = start + toFold.length;
            console.log(`[Agent] 会话已压缩：摘要覆盖前 ${session.summarizedCount} 条，保留最近 ${session.messages.length - session.summarizedCount} 条`);
        }
    } catch (e) {
        console.error('[Agent] summarize failed (本轮发送完整历史):', e.message);
    }
}

/** 构造喂给模型的历史：摘要(若有) + 最近未摘要消息 */
function buildModelHistory(session) {
    const start = session.summarizedCount || 0;
    const recent = session.messages.slice(start).map(m => ({ role: m.role, content: m.content }));
    if (session.summary) {
        return [{ role: 'system', content: `【以下是更早对话的摘要，供你保持上下文】\n${session.summary}` }, ...recent];
    }
    return recent;
}

/** 把模型返回转成可加入消息栈的 assistant 消息 */
function assistantMessageFromResult(result) {
    const msg = { role: 'assistant', content: result.content || '' };
    if (result.tool_calls && result.tool_calls.length) {
        msg.tool_calls = result.tool_calls;
        if (!result.content) msg.content = null; // OpenAI 规范：带 tool_calls 时 content 可为 null
    }
    return msg;
}

/**
 * 收尾或暂停：
 * - finish_reason=tool_calls → 暂停，保存 pending 工具栈，返回 { finish:'tool_calls', tool_calls }
 * - 否则(stop) → 持久化最终 assistant 文本到历史，生成标题，返回 { finish:'stop' }
 */
function finalizeOrPause(session, sessionId, working, result, accumulatedText) {
    const wantsTools = result.finish_reason === 'tool_calls' && result.tool_calls && result.tool_calls.length > 0;

    if (wantsTools) {
        session.pending = { working, assistantText: accumulatedText };
        return {
            finish: 'tool_calls',
            tool_calls: result.tool_calls,
            content: result.content || '',
            messageCount: session.messages.length,
        };
    }

    // turn 结束：写入最终 assistant 文本（一个 turn 内多段文字合并）
    const finalText = (accumulatedText || result.content || '').trim();
    session.messages.push({ role: 'assistant', content: finalText, timestamp: new Date().toISOString() });
    session.pending = null;

    // 首轮（user + assistant 共 2 条）后台生成标题，不阻塞回复
    let topicPromise = null;
    if (session.messages.length === 2 && !session.topic) {
        topicPromise = generateTopicTitle(session.messages)
            .then(t => { session.topic = t; saveSession(sessionId, session); return t; })
            .catch(err => { console.error('Failed to generate topic:', err); return 'New Chat'; });
    }

    saveSession(sessionId, session);

    return {
        finish: 'stop',
        response: finalText,
        topic: session.topic,
        topicPromise,
        messageCount: session.messages.length,
    };
}

/**
 * 开启一个 turn：追加用户消息并调用模型。
 * @returns {Promise<object>} finish='stop' 含 response/topic；finish='tool_calls' 含 tool_calls
 */
export async function sendMessage(sessionId, content, media, onDelta) {
    const session = getSession(sessionId);
    console.log(`[Agent] turn start: session=${sessionId} history=${session.messages.length}`);

    // 超长则先压缩较早历史为摘要（UI 仍保留全部）
    await maybeCompactSession(session);
    // 喂给模型的历史 = 摘要(若有) + 最近未摘要消息
    const history = buildModelHistory(session);
    // 本轮用户消息：带图片时先用视觉模型转成文字描述，再以纯文本喂给文字模型
    // （文字模型如 DeepSeek 不接受 image_url，且需保留 function calling）。
    const visionText = await describeMediaToText(media);
    const userContent = [content || '', visionText].filter(Boolean).join('') || (media?.length ? '请分析我发的图片。' : '');
    const working = [...history, { role: 'user', content: userContent }];

    // 持久化用户消息（干净视图：原始文字 + 媒体落盘路径）
    const persistedMedia = (media && Array.isArray(media))
        ? media.map((m, i) => ({ ...m, url: persistMediaToLibrary(m, i), base64: undefined })).filter(m => !!m.url)
        : undefined;
    session.messages.push({
        role: 'user',
        content: content || (persistedMedia?.length ? '[媒体]' : ''),
        media: persistedMedia,
        timestamp: new Date().toISOString(),
    });

    const result = await runModel(working, onDelta);
    working.push(assistantMessageFromResult(result));
    return finalizeOrPause(session, sessionId, working, result, result.content || '');
}

/**
 * 续上一个 turn：把前端执行工具的结果喂回模型。
 * @param {Array} toolResults [{ tool_call_id, content }]，content 为字符串或可序列化对象
 * @returns {Promise<object>} 同 sendMessage
 */
export async function submitToolResults(sessionId, toolResults, onDelta) {
    const session = getSession(sessionId);
    const pending = session.pending;
    if (!pending || !Array.isArray(pending.working)) {
        throw new Error('没有进行中的工具调用（pending 为空，可能已超时或会话已重置）');
    }

    const working = pending.working;
    // 从最近一条 assistant 的 tool_calls 里查出每个 tool_call_id 对应的工具名（便于扁平化时标注）
    const idToName = {};
    for (let i = working.length - 1; i >= 0; i--) {
        const m = working[i];
        if (m.role === 'assistant' && Array.isArray(m.tool_calls)) {
            for (const tc of m.tool_calls) idToName[tc.id] = tc.function?.name;
            break;
        }
    }
    for (const r of (toolResults || [])) {
        working.push({
            role: 'tool',
            tool_call_id: r.tool_call_id,
            name: idToName[r.tool_call_id],
            content: typeof r.content === 'string' ? r.content : JSON.stringify(r.content ?? {}),
        });
    }

    const result = await runModel(working, onDelta);
    working.push(assistantMessageFromResult(result));
    const accumulated = `${pending.assistantText || ''}${pending.assistantText && result.content ? '\n\n' : ''}${result.content || ''}`;
    return finalizeOrPause(session, sessionId, working, result, accumulated);
}

// ============================================================================
// EXPORTS
// ============================================================================

export default {
    getSession,
    deleteSession,
    listSessions,
    getSessionData,
    sendMessage,
    submitToolResults,
    generateTopicTitle,
    MAX_AGENT_STEPS,
};
