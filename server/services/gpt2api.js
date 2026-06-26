/**
 * gpt2api.js
 *
 * gpt2api.com（OpenAI 兼容下游接口）服务封装。
 * 统一支持文本 / 图像 / 视频；图像与视频走异步任务 + 轮询。
 *
 * 接入地址形如 https://www.gpt2api.com/v1
 * 鉴权：Authorization: Bearer sk-xxx
 */

// gpt2api 提供的模型 ID（用于在生成路由里判断走哪个提供商）
// 实际后端是 fp（Google Flow 窗口）的 Nano Banana 系列；保留旧 id 以兼容历史节点。
export const GPT2API_IMAGE_MODELS = ['nana-banana-pro', 'nana-banana-2', 'nano-banana-pro', 'nano-banana-v2', 'nano-banana', 'gpt-image-2', 'gemini-pro'];
// 实际后端是 fp（Google Flow 窗口）：veo-omni-flash(4/6/8/10s) / veo-3-1-lite|fast|quality(4/6/8s)；保留旧 id 以兼容历史节点。
export const GPT2API_VIDEO_MODELS = ['veo-omni-flash', 'veo-3-1-lite', 'veo-3-1-fast', 'veo-3-1-quality', 'veo-3-1', 'grok-imagine-video', 'sora', 'veo3.1', 'veo3.1-flash', 'veo3.1-lite'];

export const isGpt2apiImageModel = (id) => GPT2API_IMAGE_MODELS.includes(id);
export const isGpt2apiVideoModel = (id) => GPT2API_VIDEO_MODELS.includes(id);

// 宽高比 → 基准像素尺寸（gpt2api 会按 quality 档自动放大到精确尺寸）
const RATIO_TO_SIZE = {
    'Auto': '1024x1024',
    '1:1': '1024x1024',
    '3:2': '1264x848',
    '2:3': '848x1264',
    '4:3': '1152x864',
    '3:4': '864x1152',
    '5:4': '1152x928',
    '4:5': '928x1152',
    '16:9': '1376x768',
    '9:16': '768x1376',
    '21:9': '1584x672',
};

// 图像分辨率档 → quality
const RES_TO_IMAGE_QUALITY = { '1K': '1k', '2K': '2k', '4K': '4k' };

// 画布图像模型 id（含历史 id）→ fp 公共基础名（不带 _sync / -4k）
const FP_IMAGE_BASE = {
    'nana-banana-pro': 'nana-banana-pro',
    'nana-banana-2': 'nana-banana-2',
    // 历史 id 兼容
    'nano-banana-pro': 'nana-banana-pro',
    'nano-banana-v2': 'nana-banana-2',
    'nano-banana': 'nana-banana-2',
    'gemini-pro': 'nana-banana-pro',
};

/**
 * 把画布选的图像模型 + 分辨率档，规整成 fp 的 OpenAI 兼容模型名（必须以 _sync 结尾）。
 * 4K 必须用 -4k 模型变体——普通模型 + resolution=4k 会被 fp 静默降级成 1k。
 */
function toFpImageModel(model, resolution) {
    let m = String(model || '').trim().replace(/_sync$/i, '').replace(/-4k$/i, '');
    const base = FP_IMAGE_BASE[m] || m || 'nana-banana-pro';
    const q = RES_TO_IMAGE_QUALITY[resolution] || '1k';
    const name = q === '4k' ? `${base}-4k` : base;
    return `${name}_sync`;
}
// 视频分辨率 → quality
const RES_TO_VIDEO_QUALITY = { '720p': 'hd', '1080p': 'fullhd' };

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 确保为 data URL（gpt2api 接受 data:image/...;base64,... 或公网 URL） */
function toImageInput(value) {
    if (!value) return null;
    if (value.startsWith('http://') || value.startsWith('https://')) return value;
    if (value.startsWith('data:')) return value;
    return `data:image/png;base64,${value}`;
}

function authHeaders(apiKey) {
    return {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
    };
}

/** 轮询一个异步任务直到完成，返回 result.data[0]（含绝对 url） */
async function pollTask(pollUrl, apiKey, { timeoutMs = 600000 } = {}) {
    const start = Date.now();
    let interval = 3000;
    // 中转站偶发返回 403/permission_denied 或 5xx（限流/网关抖动），任务在上游其实仍在跑。
    // 单次轮询失败不能直接判死刑，连续多次失败才视为真失败，
    // 否则会出现「任务实际生成成功、前端却报权限错误」。
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 6;

    while (true) {
        if (Date.now() - start > timeoutMs) {
            throw new Error('gpt2api 任务超时');
        }

        let res, data;
        try {
            res = await fetch(pollUrl, { headers: authHeaders(apiKey) });
            data = await res.json().catch(() => ({}));
        } catch (e) {
            consecutiveErrors++;
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                throw new Error(`轮询请求连续失败：${e.message || e}`);
            }
            await sleep(4000);
            continue;
        }

        if (!res.ok) {
            consecutiveErrors++;
            console.warn(`[gpt2api] 轮询返回 HTTP ${res.status}（第 ${consecutiveErrors}/${MAX_CONSECUTIVE_ERRORS} 次），稍后重试:`, data?.error?.message || data?.error || '');
            if (consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) {
                throw new Error(data?.error?.message || data?.error || `轮询失败 (HTTP ${res.status})`);
            }
            await sleep(4000);
            continue;
        }
        consecutiveErrors = 0;

        const retryHeader = parseInt(res.headers.get('Retry-After') || '', 10);
        const status = data.status;
        if (status === 'succeeded') {
            const item = data?.result?.data?.[0];
            if (!item || !item.url) throw new Error('gpt2api 返回结果缺少 url');
            return item;
        }
        if (status === 'failed' || status === 'refunded') {
            throw new Error(data?.error?.message || data?.error || 'gpt2api 任务失败');
        }

        // queued / running：按 retry_after 间隔继续
        const retryAfter = Number.isFinite(retryHeader) ? retryHeader
            : (Number.isFinite(data.retry_after) ? data.retry_after : 3);
        interval = Math.max(2000, retryAfter * 1000);
        await sleep(interval);
    }
}

async function downloadToBuffer(url, { retries = 3 } = {}) {
    let lastErr;
    for (let i = 0; i <= retries; i++) {
        try {
            const resp = await fetch(url);
            if (!resp.ok) throw new Error(`下载生成结果失败 (HTTP ${resp.status})`);
            return Buffer.from(await resp.arrayBuffer());
        } catch (e) {
            lastErr = e;
            if (i < retries) await sleep(2000 * (i + 1));
        }
    }
    throw lastErr;
}

/** 尝试从一次性（同步）响应里直接取出结果项；取不到返回 null */
function extractSyncItem(data) {
    const arr = data?.result?.data || data?.data;
    if (Array.isArray(arr) && arr.length > 0) {
        const it = arr[0];
        if (it && (it.url || it.b64_json)) return it;
    }
    return null;
}

/**
 * 图像生成（文生图 / 图生图）。返回 { buffer, format }。
 */
export async function generateGpt2apiImage({ prompt, imageBase64Array, aspectRatio, resolution, model, baseUrl, apiKey }) {
    if (!apiKey) throw new Error('未配置 gpt2api API Key（请在「设置」中填写）');
    const base = (baseUrl || 'https://www.gpt2api.com/v1').replace(/\/+$/, '');

    const refs = (imageBase64Array || []).map(toImageInput).filter(Boolean);
    const hasRef = refs.length > 0;

    // fp 模型名（_sync，4K→-4k 变体）；分辨率/宽高比走 fp 识别的字段
    const fpModel = toFpImageModel(model, resolution);
    const q = RES_TO_IMAGE_QUALITY[resolution] || '1k';

    const body = {
        model: fpModel,
        prompt: prompt || '',
        n: 1,
        async: true,
    };
    // 1k/2k 直接传 resolution；4k 已由模型名 -4k 决定（再传也无妨，fp 以模型为准）
    if (q === '1k' || q === '2k') body.resolution = q;
    // 宽高比：传干净的比例串（如 "16:9"），fp 直接识别；不要传像素尺寸（fp 会解析成 "1376:768" 之类的脏比例）
    if (aspectRatio && aspectRatio !== 'Auto') {
        body.aspect_ratio = aspectRatio;
        body.ratio = aspectRatio;
    }
    // 参考图（图生图 / 多图）：fp 没有 /images/edits，统一走 /images/generations + images 数组
    if (hasRef) body.images = refs;

    const endpoint = `${base}/images/generations`;

    const res = await fetch(endpoint, { method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `图像请求失败 (HTTP ${res.status})`);

    // 同步返回：直接取结果
    let item = extractSyncItem(data);
    if (!item) {
        // 异步：轮询任务
        const taskId = data.task_id || data.id;
        if (!taskId) throw new Error('图像接口未返回结果或 task_id');
        item = await pollTask(`${base}/images/generations/${taskId}`, apiKey, { timeoutMs: 300000 });
    }

    if (item.url) {
        const buffer = await downloadToBuffer(item.url);
        const format = item.url.includes('.jpg') || item.url.includes('.jpeg') ? 'jpg' : 'png';
        return { buffer, format };
    }
    // 兼容 b64_json 形式
    return { buffer: Buffer.from(item.b64_json, 'base64'), format: 'png' };
}

/**
 * 视频生成（文生视频 / 图生视频）。返回 Buffer(mp4)。
 */
export async function generateGpt2apiVideo({ prompt, imageBase64, lastFrameBase64, referenceImages, aspectRatio, resolution, duration, model, baseUrl, apiKey }) {
    if (!apiKey) throw new Error('未配置 gpt2api API Key（请在「设置」中填写）');
    const base = (baseUrl || 'https://www.gpt2api.com/v1').replace(/\/+$/, '');

    const startImg = toImageInput(imageBase64);
    const endImg = toImageInput(lastFrameBase64);
    // Ingredients（R2V 多图参考）：最多 8 张，转成 data URL / URL 输入
    const ingredientImgs = Array.isArray(referenceImages)
        ? referenceImages.map(toImageInput).filter(Boolean).slice(0, 8)
        : [];
    const body = {
        model,
        prompt: prompt || '',
        duration: duration || 6,
        async: true,
    };
    if (aspectRatio && aspectRatio !== 'Auto') body.ratio = aspectRatio;
    if (resolution && RES_TO_VIDEO_QUALITY[resolution]) body.quality = RES_TO_VIDEO_QUALITY[resolution];
    if (startImg) body.image = startImg;
    // 尾帧（首尾帧插值）→ fp 适配端点识别 last_frame / lastFrameBase64
    if (endImg) body.last_frame = endImg;
    // Ingredients 多图参考 → fp 适配端点识别 Ingredients_images
    if (ingredientImgs.length > 0) body.Ingredients_images = ingredientImgs;

    const res = await fetch(`${base}/video/generations`, { method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.error?.message || data?.error || `视频请求失败 (HTTP ${res.status})`);

    const taskId = data.task_id || data.id;
    let item = extractSyncItem(data);
    if (!item) {
        if (!taskId) throw new Error('视频接口未返回结果或 task_id');
        item = await pollTask(`${base}/video/generations/${taskId}`, apiKey, { timeoutMs: 900000 });
    }

    // 中转站自带结果代理：/api/v1/gen/assets/{taskId}/0.mp4。
    // grok-imagine-video 等模型的 result.url 是上游原始地址（assets.grok.com，
    // 需要 grok.com 登录态，直接下载 403），但代理地址可以正常下载。
    const origin = base.replace(/\/v\d+$/, '');
    const proxyUrl = taskId ? `${origin}/api/v1/gen/assets/${taskId}/0.mp4` : null;
    const preferProxy = String(item.url).includes('assets.grok.com');

    const candidates = preferProxy
        ? [proxyUrl, item.url].filter(Boolean)
        : [item.url, proxyUrl].filter(Boolean);

    let lastErr;
    for (const url of candidates) {
        try {
            return await downloadToBuffer(url, { retries: 1 });
        } catch (e) {
            lastErr = e;
            console.warn(`[gpt2api] 视频下载失败 (${url})，尝试备用地址:`, e.message);
        }
    }
    throw lastErr || new Error('视频下载失败');
}

/** 归一化非流式 message.tool_calls 为标准结构 */
function normalizeToolCalls(tcs) {
    if (!Array.isArray(tcs)) return [];
    return tcs.map((tc, i) => ({
        id: tc.id || `call_${i}_${Math.random().toString(36).slice(2)}`,
        type: 'function',
        function: {
            name: tc.function?.name || '',
            arguments: typeof tc.function?.arguments === 'string'
                ? tc.function.arguments
                : JSON.stringify(tc.function?.arguments ?? {}),
        },
    }));
}

/**
 * 内部：发起一次 chat completion（OpenAI 兼容），返回 { content, toolCalls, finishReason }。
 * 同时支持 function calling 与流式/非流式：
 * - 使用 SSE 流式接收再拼装，避免慢速推理模型被中转网关 1~2 分钟超时掐断；
 * - 流式 tool_calls 按 index 累积分片的 function.name / function.arguments；
 * - 部分网关忽略 stream 直接返回 JSON，也做兼容。
 */
export async function requestChatCompletion({ messages, model, baseUrl, apiKey, temperature = 0.7, maxTokens, tools, toolChoice, onDelta }) {
    if (!apiKey) throw new Error('未配置 gpt2api API Key（请在「设置」中填写）');
    const base = (baseUrl || 'https://www.gpt2api.com/v1').replace(/\/+$/, '');

    const body = { model, messages, temperature, stream: true };
    if (maxTokens) body.max_tokens = maxTokens;
    if (tools && tools.length) {
        body.tools = tools;
        body.tool_choice = toolChoice || 'auto';
    }

    const res = await fetch(`${base}/chat/completions`, { method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body) });

    if (!res.ok) {
        const data = await res.json().catch(() => ({}));
        throw new Error(data?.error?.message || data?.error || `gpt2api 文本请求失败 (HTTP ${res.status})`);
    }

    const contentType = res.headers.get('content-type') || '';
    // 部分网关会忽略 stream 参数直接返回 JSON，做好兼容
    if (contentType.includes('application/json')) {
        const data = await res.json().catch(() => ({}));
        if (data?.error) throw new Error(data.error.message || data.error);
        const choice = data?.choices?.[0] || {};
        const content = choice.message?.content || '';
        if (content) { try { onDelta?.(content, content.length); } catch { /* 忽略 */ } }
        const toolCalls = normalizeToolCalls(choice.message?.tool_calls);
        return { content, toolCalls, finishReason: choice.finish_reason || (toolCalls.length ? 'tool_calls' : 'stop') };
    }

    // 解析 SSE 流：拼接 delta.content，并按 index 累积 delta.tool_calls
    let content = '';
    let finishReason = null;
    const toolAcc = new Map(); // index -> { id, name, args }
    let buffer = '';
    const decoder = new TextDecoder();
    for await (const chunk of res.body) {
        buffer += decoder.decode(chunk, { stream: true });
        const lines = buffer.split('\n');
        buffer = lines.pop() || ''; // 留下不完整的最后一行
        for (const line of lines) {
            const trimmed = line.trim();
            if (!trimmed.startsWith('data:')) continue;
            const payload = trimmed.slice(5).trim();
            if (payload === '[DONE]') continue;
            let json;
            try {
                json = JSON.parse(payload);
            } catch (e) {
                if (e instanceof SyntaxError) continue; // 跳过非 JSON 行
                throw e;
            }
            if (json?.error) throw new Error(json.error.message || json.error);
            const choice = json?.choices?.[0];
            if (!choice) continue;
            const delta = choice.delta || {};
            if (delta.content) {
                content += delta.content;
                try { onDelta?.(delta.content, content.length); } catch { /* 进度回调失败不影响主流程 */ }
            }
            if (Array.isArray(delta.tool_calls)) {
                for (const tc of delta.tool_calls) {
                    const idx = tc.index ?? 0;
                    const cur = toolAcc.get(idx) || { id: '', name: '', args: '' };
                    if (tc.id) cur.id = tc.id;
                    if (tc.function?.name) cur.name = tc.function.name;
                    if (tc.function?.arguments) cur.args += tc.function.arguments;
                    toolAcc.set(idx, cur);
                }
            }
            if (choice.finish_reason) finishReason = choice.finish_reason;
        }
    }

    const toolCalls = [...toolAcc.entries()]
        .sort((a, b) => a[0] - b[0])
        .map(([, v]) => ({
            id: v.id || `call_${Math.random().toString(36).slice(2)}`,
            type: 'function',
            function: { name: v.name, arguments: v.args || '{}' },
        }));

    return { content, toolCalls, finishReason: finishReason || (toolCalls.length ? 'tool_calls' : 'stop') };
}

/**
 * 文本对话（OpenAI 兼容）。返回模型回复字符串（向后兼容，供剧本/分镜/标题等纯文本调用方使用）。
 */
export async function gpt2apiChat({ messages, model, baseUrl, apiKey, temperature = 0.7, maxTokens, onDelta }) {
    const { content } = await requestChatCompletion({ messages, model, baseUrl, apiKey, temperature, maxTokens, onDelta });
    return content;
}

