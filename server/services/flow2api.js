/**
 * flow2api.js
 *
 * Google Flow（flow2api 网关）出图/出视频适配。
 * flow2api 是项目作用域的 Google Flow（Labs FX）网关，OpenAI 风格的**异步任务**接口：
 *   POST {base}/images/generations | /videos/generations → { id(public_id), task_url, status }
 *   GET  {base}/tasks/{public_id} → { status: queued|running|succeeded|failed, outputs:[{url,type}], error }
 * base 形如 http://host:18000/v1（与设置里的 IMAGE_API_URL/VIDEO_API_URL 一致，含 /v1）。
 *
 * 出图/出视频均为异步：发起 → 轮询任务 → 取 outputs[0].url → 下载为 Buffer。
 */

// flow2api 暴露的模型 ID（用于在生成路由里判断走哪个提供商）
export const FLOW2API_IMAGE_MODELS = ['nano_banana', 'banana_pro', 'imagen', 'imagen_4k'];
export const FLOW2API_VIDEO_MODELS = ['omni_flash', 'veo_3_1_fast', 'veo_3_1_lite', 'veo_3_1_quality'];

export const isFlow2apiImageModel = (id) => FLOW2API_IMAGE_MODELS.includes(id);
export const isFlow2apiVideoModel = (id) => FLOW2API_VIDEO_MODELS.includes(id);

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function authHeaders(apiKey) {
    return { 'Authorization': `Bearer ${apiKey}`, 'Content-Type': 'application/json' };
}

/** 宽高比 → flow2api size（接受 16:9 / 9:16 / 1:1；其余回退默认） */
function toFlowSize(aspectRatio, fallback) {
    const a = String(aspectRatio || '').trim();
    return ['16:9', '9:16', '1:1'].includes(a) ? a : fallback;
}

/** 轮询一个 flow2api 异步任务直到完成，返回 outputs[0]（含 url） */
async function pollFlowTask(base, publicId, apiKey, { timeoutMs = 600000, interval = 3000 } = {}) {
    const start = Date.now();
    let consecutiveErrors = 0;
    const MAX_CONSECUTIVE_ERRORS = 6;

    while (true) {
        if (Date.now() - start > timeoutMs) throw new Error('flow2api 任务超时');

        let res, data;
        try {
            res = await fetch(`${base}/tasks/${publicId}`, { headers: authHeaders(apiKey) });
            data = await res.json().catch(() => ({}));
        } catch (e) {
            if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw new Error(`flow2api 轮询连续失败：${e.message || e}`);
            await sleep(4000);
            continue;
        }
        if (!res.ok) {
            if (++consecutiveErrors >= MAX_CONSECUTIVE_ERRORS) throw new Error(data?.detail || data?.error || `flow2api 轮询失败 (HTTP ${res.status})`);
            await sleep(4000);
            continue;
        }
        consecutiveErrors = 0;

        const status = data.status;
        if (status === 'succeeded') {
            const out = (data.outputs || [])[0];
            if (!out || !out.url) throw new Error('flow2api 任务成功但缺少输出 url');
            return out;
        }
        if (status === 'failed') {
            throw new Error(data.error || 'flow2api 任务失败');
        }
        // queued / running：继续轮询
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

/**
 * 图像生成（Google Flow）。返回 { buffer, format }，与 gpt2api.js 一致。
 */
export async function generateFlow2apiImage({ prompt, aspectRatio, model, baseUrl, apiKey }) {
    if (!apiKey) throw new Error('未配置图片模型 KEY（flow2api，请在「设置」中填写）');
    const base = (baseUrl || '').replace(/\/+$/, '');

    const body = {
        prompt: prompt || '',
        model: model || 'nano_banana',
        n: 1,
        size: toFlowSize(aspectRatio, '1024x1024'),
    };

    const res = await fetch(`${base}/images/generations`, { method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || data?.error || `flow2api 图像请求失败 (HTTP ${res.status})`);

    const publicId = data.id;
    if (!publicId) throw new Error('flow2api 图像接口未返回任务 id');

    const out = await pollFlowTask(base, publicId, apiKey, { timeoutMs: 300000 });
    const buffer = await downloadToBuffer(out.url);
    const format = /\.jpe?g($|\?)/i.test(out.url) ? 'jpg' : 'png';
    return { buffer, format };
}

/**
 * 视频生成（Google Flow）。返回 Buffer(mp4)，与 gpt2api.js 一致。
 */
export async function generateFlow2apiVideo({ prompt, aspectRatio, duration, model, baseUrl, apiKey }) {
    if (!apiKey) throw new Error('未配置视频模型 KEY（flow2api，请在「设置」中填写）');
    const base = (baseUrl || '').replace(/\/+$/, '');

    const body = {
        prompt: prompt || '',
        model: model || 'omni_flash',
        duration: duration || 5,
        size: toFlowSize(aspectRatio, '16:9'),
    };

    const res = await fetch(`${base}/videos/generations`, { method: 'POST', headers: authHeaders(apiKey), body: JSON.stringify(body) });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data?.detail || data?.error || `flow2api 视频请求失败 (HTTP ${res.status})`);

    const publicId = data.id;
    if (!publicId) throw new Error('flow2api 视频接口未返回任务 id');

    const out = await pollFlowTask(base, publicId, apiKey, { timeoutMs: 900000 });
    return await downloadToBuffer(out.url);
}
