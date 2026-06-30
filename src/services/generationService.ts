/**
 * generationService.ts
 * 
 * Frontend service layer for AI content generation.
 * Proxies requests to backend API which handles multiple providers:
 * - Image: Gemini Pro, Kling AI
 * - Video: Veo 3.1, Kling AI
 */

export interface GenerateImageParams {
  prompt: string;
  aspectRatio?: string;
  resolution?: string;
  imageBase64?: string | string[]; // Supports single image or array of images
  imageModel?: string; // Image model version (e.g., 'gemini-pro', 'kling-v2')
  nodeId?: string; // ID of the node initiating generation
  // Kling V1.5 reference settings
  klingReferenceMode?: 'subject' | 'face';
  klingFaceIntensity?: number; // 0-100
  klingSubjectIntensity?: number; // 0-100
  title?: string; // 节点标题（如「分镜 01」），存入素材元数据供剪辑页区分
}

export interface GenerateVideoParams {
  prompt: string;
  imageBase64?: string; // For Image-to-Video (start frame)
  lastFrameBase64?: string; // For frame-to-frame interpolation (end frame)
  aspectRatio?: string;
  resolution?: string; // Add resolution to params
  duration?: number; // Video duration in seconds (e.g., 5, 6, 8, 10)
  videoModel?: string; // Video model version (e.g., 'veo-3.1', 'kling-v2-1')
  motionReferenceUrl?: string; // For Kling 2.6 motion control
  characterReferenceUrls?: string[]; // R2V 多参考（omni 角色/素材）→ flow_native
  generateAudio?: boolean; // For Kling 2.6 and Veo 3.1 native audio (default: true)
  nodeId?: string; // ID of the node initiating generation
  title?: string; // 节点标题（如「镜头 01 视频」），存入素材元数据供剪辑页区分
}

/**
 * Generates an image by calling the backend API
 */
export const generateImage = async (params: GenerateImageParams): Promise<string> => {
  try {
    const response = await fetch('/api/generate-image', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (response.status === 402) {
        const err = new Error(errData.error || '积分不足') as Error & { code?: string };
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
      }
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();
    if (!data.resultUrl) {
      throw new Error("No image data returned from server");
    }
    return data.resultUrl;

  } catch (error) {
    console.error("Image Generation Error:", error);
    throw error;
  }
};

const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// 异步视频轮询参数：fp 出视频 + 去水印常常 >100s（CF Free 隧道会 524），
// 故后端改为「提交拿 taskId → 前端轮询状态」；这里设宽松总时限防止死循环。
const VIDEO_POLL_INTERVAL_MS = 4000;
const VIDEO_POLL_MAX_MS = 20 * 60 * 1000; // 20 分钟

/**
 * Generates a video by calling the backend API.
 *
 * 后端有两种返回形态，本函数都兼容（对外签名仍是 Promise<string>，调用方无需改动）：
 *   - 同步模型（kling / hailuo / flow2api …）：POST 直接返回 { resultUrl }。
 *   - 异步 fp/gpt2api 模型：POST 返回 { taskId, async:true }，再轮询
 *     GET /api/generate-video/status/:taskId 直到 completed/failed。
 */
export const generateVideo = async (params: GenerateVideoParams): Promise<string> => {
  try {
    const response = await fetch('/api/generate-video', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(params)
    });

    if (!response.ok) {
      const errData = await response.json().catch(() => ({}));
      if (response.status === 402) {
        const err = new Error(errData.error || '积分不足') as Error & { code?: string };
        err.code = 'INSUFFICIENT_CREDITS';
        throw err;
      }
      throw new Error(errData.error || response.statusText);
    }

    const data = await response.json();

    // 同步路径：直接拿到结果。
    if (data.resultUrl) {
      return data.resultUrl;
    }

    // 异步路径：后端只提交、立即返回；轮询 /generation-status/:nodeId（与刷新恢复钩子同端点）。
    if (data.async || data.taskId) {
      const nodeId = params.nodeId || data.nodeId;
      if (!nodeId) throw new Error('异步视频缺少 nodeId');
      return await pollVideoStatus(nodeId);
    }

    throw new Error("No video data returned from server");

  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
};

/**
 * 轮询 /generation-status/:nodeId 直至 success（返回 resultUrl）或 failed（抛错）。
 * 按 nodeId（而非 taskId）：与「刷新后恢复钩子」打同一个后端端点 —— 后端按 nodeId 查 fp、
 * 幂等下载落库，故页面刷新丢了内存里的轮询循环后，恢复钩子也能接着把任务跑完。
 */
async function pollVideoStatus(nodeId: string): Promise<string> {
  const start = Date.now();
  while (true) {
    if (Date.now() - start > VIDEO_POLL_MAX_MS) {
      throw new Error('视频生成超时，请稍后在素材库查看或重试');
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);

    let resp: Response;
    try {
      resp = await fetch(`/api/generation-status/${encodeURIComponent(nodeId)}`);
    } catch {
      continue; // 网络抖动：继续轮询
    }

    const d = await resp.json().catch(() => ({}));
    if (!resp.ok) continue;

    if (d.status === 'success' && d.resultUrl) return d.resultUrl;
    if (d.status === 'failed') throw new Error(d.error || '视频生成失败');
    // pending / stale / processing → 继续轮询
  }
}
