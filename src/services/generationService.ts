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

    // 异步路径：轮询状态接口。
    if (data.taskId) {
      return await pollVideoStatus(data.taskId, params);
    }

    throw new Error("No video data returned from server");

  } catch (error) {
    console.error("Video Generation Error:", error);
    throw error;
  }
};

/**
 * 轮询异步视频任务状态，直至 completed（返回 resultUrl）或 failed（抛错）。
 * 状态接口需要的查询参数随轮询带上（至少 model，用于后端重新解析 fp 端点）。
 */
async function pollVideoStatus(taskId: string, params: GenerateVideoParams): Promise<string> {
  const qs = new URLSearchParams();
  qs.set('model', params.videoModel || '');
  if (params.nodeId) qs.set('nodeId', params.nodeId);
  if (params.title) qs.set('title', params.title);
  if (params.aspectRatio) qs.set('aspectRatio', params.aspectRatio);
  if (params.resolution) qs.set('resolution', params.resolution);
  if (params.duration != null) qs.set('duration', String(params.duration));
  if (params.prompt) qs.set('prompt', params.prompt);

  const start = Date.now();
  while (true) {
    if (Date.now() - start > VIDEO_POLL_MAX_MS) {
      throw new Error('视频生成超时，请稍后在素材库查看或重试');
    }
    await sleep(VIDEO_POLL_INTERVAL_MS);

    let statusResp: Response;
    try {
      statusResp = await fetch(`/api/generate-video/status/${encodeURIComponent(taskId)}?${qs.toString()}`);
    } catch {
      // 网络抖动：继续轮询。
      continue;
    }

    const statusData = await statusResp.json().catch(() => ({}));

    if (!statusResp.ok) {
      // 后端把下载/网关抖动也归为可重试，这里也继续轮询（除非明确 failed）。
      if (statusData?.status === 'failed' && statusData?.error) {
        throw new Error(statusData.error);
      }
      continue;
    }

    if (statusData.status === 'completed' && statusData.resultUrl) {
      return statusData.resultUrl;
    }
    if (statusData.status === 'failed') {
      throw new Error(statusData.error || '视频生成失败');
    }
    // processing → 继续轮询
  }
}
