/**
 * aiPrompt.ts
 *
 * 提示词优化 / 看图描述的前端请求封装：失败（含返回空）时自动重试一次。
 * 抛出异常给调用方处理（弹 toast）。
 */

async function postJson(url: string, body: unknown): Promise<any> {
    const res = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return res.json();
}

/** 跑一次，失败（异常或空结果）再自动重试一次 */
async function withRetryOnce<T>(fn: () => Promise<T>): Promise<T> {
    try {
        return await fn();
    } catch {
        return await fn();
    }
}

/** 优化提示词：返回改写后的文本（空/失败会重试一次，仍失败则抛错） */
export async function optimizePromptRequest(prompt: string): Promise<string> {
    return withRetryOnce(async () => {
        const data = await postJson('/api/gemini/optimize-prompt', { prompt });
        const t = String(data?.optimizedPrompt || '').trim();
        if (!t) throw new Error('empty');
        return t;
    });
}

/** 看图描述：返回描述文本（空/失败会重试一次，仍失败则抛错） */
export async function describeImageRequest(imageUrl: string, prompt: string): Promise<string> {
    return withRetryOnce(async () => {
        const data = await postJson('/api/gemini/describe-image', { imageUrl, prompt });
        const t = String(data?.description || '').trim();
        if (!t) throw new Error('empty');
        return t;
    });
}
