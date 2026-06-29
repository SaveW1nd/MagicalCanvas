/**
 * generation.js
 * 
 * Routes for AI image and video generation.
 * Supports Gemini, Veo, Kling AI, Hailuo AI, and OpenAI GPT Image providers.
 */

import express from 'express';
import fs from 'fs';
import path from 'path';
import { generateKlingVideo, generateKlingImage, generateKlingMultiImage } from '../services/kling.js';
import { generateHailuoVideo } from '../services/hailuo.js';
import { generateOpenAIImage } from '../services/openai.js';
import { resolveImageToBase64, saveBufferToFile, userMediaDir } from '../utils/imageHelpers.js';
import { generateGpt2apiImage, generateGpt2apiVideo, isGpt2apiImageModel, isGpt2apiVideoModel } from '../services/gpt2api.js';
import { generateFlow2apiImage, generateFlow2apiVideo, isFlow2apiImageModel, isFlow2apiVideoModel } from '../services/flow2api.js';
import { resolveModel } from '../db/registry.js';
import { isExempt, quote, charge } from '../services/billing.js';

const router = express.Router();

/**
 * Resolve {baseUrl, apiKey, model} for a generation request, preferring the
 * dynamic model registry (admin-configured providers). Falls back to the legacy
 * per-category config (app.locals.*_API_URL/KEY/MODEL) when no registry match.
 */
function pickEndpoint(category, requestedModel, fb) {
    try {
        const hit = resolveModel(category, requestedModel);
        if (hit && hit.provider.baseUrl && hit.provider.apiKey) {
            return { baseUrl: hit.provider.baseUrl, apiKey: hit.provider.apiKey, model: hit.model.modelId };
        }
    } catch (e) {
        console.warn('[Registry] resolve failed, using legacy config:', e.message);
    }
    return { baseUrl: fb.baseUrl, apiKey: fb.apiKey, model: requestedModel || fb.model };
}

// 正在进行的生成任务（nodeId 集合，进程内存）。用于让状态接口区分
// 「还在生成中」和「应用重启后任务已中断」——后者前端可以直接标记失败让用户重试。
const activeGenerations = new Set();

// ============================================================================
// IMAGE GENERATION
// ============================================================================

router.post('/generate-image', async (req, res) => {
    const reqNodeId = req.body?.nodeId;
    if (reqNodeId) activeGenerations.add(reqNodeId);
    try {
        const { nodeId, prompt, title, aspectRatio, resolution, imageBase64: rawImageBase64, imageModel, klingReferenceMode, klingFaceIntensity, klingSubjectIntensity } = req.body;
        const { IMAGE_API_URL, IMAGE_API_KEY, IMAGE_MODEL, IMAGES_DIR } = req.app.locals;

        // 节点上选的模型优先；没传才回退到「设置」里的全局 IMAGE_MODEL。
        // KleinAI 收到任何 model id 都会自己路由（flow2api 系或 OpenAI 系），
        // 这里只需判断「是不是 flow2api 模型」选合适的客户端即可。
        const effectiveImageModel = imageModel || IMAGE_MODEL;
        const isKlingModel = false;

        // 积分预检（管理员/总开关关 → 豁免）
        if (!isExempt(req.user)) {
            const q = quote(req.user, 'image', imageModel, { resolution });
            if (!q.ok) return res.status(402).json({ error: '积分不足', balance: q.balanceUnits / 100, price: q.priceUnits / 100 });
        }

        let imageBuffer;
        let imageFormat = 'png';

        if (isFlow2apiImageModel(effectiveImageModel) && !isGpt2apiImageModel(effectiveImageModel)) {
            // --- Google Flow（旧 flow2api 网关，已被 flow_native 取代；保留作回退）---
            if (!IMAGE_API_KEY) {
                return res.status(500).json({ error: "未配置图片模型 KEY，请在「设置」中填写" });
            }
            console.log(`Using flow2api image model: ${effectiveImageModel} @ ${IMAGE_API_URL}`);
            const result = await generateFlow2apiImage({
                prompt,
                aspectRatio,
                model: effectiveImageModel,
                baseUrl: IMAGE_API_URL,
                apiKey: IMAGE_API_KEY,
            });
            imageBuffer = result.buffer;
            imageFormat = result.format;

        } else if (!isKlingModel) {
            // --- 统一图片生成（KleinAI / gpt2api 系：gpt-image-*、grok、...）---
            if (!IMAGE_API_KEY) {
                return res.status(500).json({ error: "未配置图片模型 KEY，请在「设置」中填写" });
            }

            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            // 优先用模型注册表解析 baseUrl/key/模型名；无匹配回退到「设置」全局图片配置。
            const ep = pickEndpoint('image', imageModel, { baseUrl: IMAGE_API_URL, apiKey: IMAGE_API_KEY, model: IMAGE_MODEL });
            if (!ep.apiKey) return res.status(500).json({ error: "未配置图片模型 KEY，请在「设置」或「管理后台→模型配置」中填写" });
            console.log(`Using image model: ${ep.model} @ ${ep.baseUrl}`);
            const result = await generateGpt2apiImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                model: ep.model,
                baseUrl: ep.baseUrl,
                apiKey: ep.apiKey,
            });
            imageBuffer = result.buffer;
            imageFormat = result.format;

        } else if (isKlingModel) {
            // --- KLING AI IMAGE GENERATION ---
            if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
                return res.status(500).json({
                    error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                });
            }

            console.log(`Using Kling AI model for image: ${imageModel}`);

            // Resolve images if provided
            let resolvedImages = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                resolvedImages = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            let klingImageUrl;

            // Determine which API to use based on model and reference images:
            // - kling-v1-5: Uses standard API with image_reference parameter
            // - kling-v2, kling-v2-1: Use Multi-Image API (image_reference not supported)
            const isV2Model = imageModel === 'kling-v2' || imageModel === 'kling-v2-1' || imageModel === 'kling-v2-new';
            const hasReferenceImages = resolvedImages && resolvedImages.length > 0;

            if (hasReferenceImages && isV2Model) {
                // V2 models: Use Multi-Image API for image-to-image
                console.log(`Using Kling Multi-Image API for ${imageModel} with ${resolvedImages.length} subject image(s)`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else if (hasReferenceImages && resolvedImages.length > 1) {
                // Multiple images with non-V2 model: Use Multi-Image API
                console.log(`Using Kling Multi-Image API with ${resolvedImages.length} subject images`);
                klingImageUrl = await generateKlingMultiImage({
                    prompt,
                    subjectImages: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            } else {
                // V1.5 or text-to-image: Use standard API (V1.5 supports image_reference)
                klingImageUrl = await generateKlingImage({
                    prompt,
                    imageBase64: resolvedImages,
                    modelId: imageModel,
                    aspectRatio,
                    resolution,
                    klingReferenceMode,
                    klingFaceIntensity,
                    klingSubjectIntensity,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from Kling's URL
            const imageResponse = await fetch(klingImageUrl);
            if (!imageResponse.ok) {
                throw new Error('Failed to download image from Kling');
            }
            imageBuffer = Buffer.from(await imageResponse.arrayBuffer());

            if (klingImageUrl.includes('.jpg') || klingImageUrl.includes('.jpeg')) {
                imageFormat = 'jpg';
            }

        } else if (isOpenAIModel) {
            // --- OPENAI GPT IMAGE GENERATION ---
            if (!OPENAI_API_KEY) {
                return res.status(500).json({
                    error: "OpenAI API key not configured. Add OPENAI_API_KEY to .env"
                });
            }

            console.log(`Using OpenAI GPT Image model: ${imageModel}`);

            // Resolve images if provided
            let imageBase64Array = null;
            if (rawImageBase64) {
                const rawImages = Array.isArray(rawImageBase64) ? rawImageBase64 : [rawImageBase64];
                imageBase64Array = rawImages.map(img => resolveImageToBase64(img)).filter(Boolean);
            }

            imageBuffer = await generateOpenAIImage({
                prompt,
                imageBase64Array,
                aspectRatio,
                resolution,
                apiKey: OPENAI_API_KEY
            });

        } else {
            // 兜底：未知图片模型。Gemini 直连已下线，统一走 gpt2api（见上方分支）。
            return res.status(400).json({ error: `不支持的图片模型: ${effectiveImageModel}` });
        }

        // Save media into the owner's namespaced dir (P1：路径含 ownerId，URL 不可跨用户猜测)
        const ownerImagesDir = userMediaDir(req.app.locals.LIBRARY_DIR, req.user?.id, 'images');
        const saved = await saveBufferToFile(imageBuffer, ownerImagesDir, 'img', imageFormat);
        const resultUrl = saved.url;

        // 每次生成 = 一条独立历史：文件名/ID 用唯一的 saved.id（不再用 nodeId，
        // 否则同一节点反复生成会互相覆盖，历史只剩最后一次）。nodeId 仅作为字段
        // 保存，供 generation-status 按节点恢复。
        // Metadata stays in the flat IMAGES_DIR (so the owner-filtered history list finds it);
        // url 指向分目录后的真实媒体。
        const metadata = {
            id: saved.id,
            nodeId: nodeId || null,  // 仅用于「刷新后恢复」按节点查找，不参与历史去重
            ownerId: req.user?.id,  // P1：归属当前用户
            filename: saved.filename,
            url: resultUrl,
            prompt: prompt,
            title: title || '',  // 节点标题（如「分镜 01」），剪辑页素材列表用于区分镜头
            model: imageModel || 'gemini-pro',
            createdAt: new Date().toISOString(),
            type: 'images'
        };
        fs.writeFileSync(path.join(IMAGES_DIR, `${saved.id}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Image saved: ${resultUrl} (model: ${imageModel || 'gemini-pro'})`);
        // 成功后扣费（管理员/总开关关 → 豁免）
        if (!isExempt(req.user)) {
            try { charge(req.user, { category: 'image', modelId: imageModel, params: { resolution }, refId: nodeId || saved.id }); }
            catch (e) { console.error('[billing] charge image failed:', e.message); }
        }
        return res.json({ resultUrl });

    } catch (error) {
        console.error("Server Image Gen Error:", error);
        res.status(500).json({ error: error.message || "Image generation failed" });
    } finally {
        if (reqNodeId) activeGenerations.delete(reqNodeId);
    }
});

// ============================================================================
// VIDEO GENERATION
// ============================================================================

router.post('/generate-video', async (req, res) => {
    const reqNodeId = req.body?.nodeId;
    if (reqNodeId) activeGenerations.add(reqNodeId);
    try {
        const { nodeId, prompt, title, imageBase64: rawImageBase64, lastFrameBase64: rawLastFrameBase64, motionReferenceUrl: rawMotionReferenceUrl, characterReferenceUrls: rawCharacterReferenceUrls, aspectRatio, resolution, duration, videoModel } = req.body;
        const { VIDEO_API_URL, VIDEO_API_KEY, VIDEO_MODEL, VIDEOS_DIR } = req.app.locals;

        // 积分预检（管理员/总开关关 → 豁免）
        if (!isExempt(req.user)) {
            const q = quote(req.user, 'video', videoModel, { duration, resolution, tier: videoModel });
            if (!q.ok) return res.status(402).json({ error: '积分不足', balance: q.balanceUnits / 100, price: q.priceUnits / 100 });
        }

        // Resolve file URLs to base64
        const imageBase64 = resolveImageToBase64(rawImageBase64);
        const lastFrameBase64 = resolveImageToBase64(rawLastFrameBase64);
        const motionReferenceUrl = resolveImageToBase64(rawMotionReferenceUrl);
        // R2V 多参考（omni 角色/素材）→ base64 列表，传给 flow_native
        const characterReferenceBase64 = Array.isArray(rawCharacterReferenceUrls)
            ? rawCharacterReferenceUrls.map(resolveImageToBase64).filter(Boolean)
            : [];

        // 始终使用「设置」里的视频模型配置（OpenAI 兼容下游）
        const isGpt2api = true;
        const isKlingModel = false;
        const isHailuoModel = false;

        let videoBuffer;

        // flow2api 视频模型（旧网关，已被 flow_native 取代）：仅当不归 gpt2api(flow_native) 路由时才用，保留作回退。
        const flowVideoModel = (videoModel && isFlow2apiVideoModel(videoModel) && !isGpt2apiVideoModel(videoModel))
            ? videoModel
            : (isFlow2apiVideoModel(VIDEO_MODEL) && !isGpt2apiVideoModel(VIDEO_MODEL) ? VIDEO_MODEL : null);

        if (flowVideoModel) {
            // --- Google Flow（flow2api）出视频：异步任务 + 轮询 ---
            if (!VIDEO_API_KEY) {
                return res.status(500).json({ error: "未配置视频模型 KEY，请在「设置」中填写" });
            }
            console.log(`Using flow2api video model: ${flowVideoModel} @ ${VIDEO_API_URL}, duration: ${duration || 5}s`);
            videoBuffer = await generateFlow2apiVideo({
                prompt,
                aspectRatio,
                duration: duration || 5,
                model: flowVideoModel,
                baseUrl: VIDEO_API_URL,
                apiKey: VIDEO_API_KEY,
            });

        } else if (isGpt2api) {
            // --- 统一视频生成（设置：网址 / KEY / 模型名）---
            if (!VIDEO_API_KEY) {
                return res.status(500).json({ error: "未配置视频模型 KEY，请在「设置」中填写" });
            }
            // 优先用模型注册表解析 baseUrl/key/模型名；无匹配回退到「设置」全局视频配置。
            const ep = pickEndpoint('video', videoModel, { baseUrl: VIDEO_API_URL, apiKey: VIDEO_API_KEY, model: VIDEO_MODEL || 'veo3.1-lite' });
            if (!ep.apiKey) return res.status(500).json({ error: "未配置视频模型 KEY，请在「设置」或「管理后台→模型配置」中填写" });
            console.log(`Using video model: ${ep.model} @ ${ep.baseUrl}, duration: ${duration || 6}s`);
            videoBuffer = await generateGpt2apiVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                referenceImages: characterReferenceBase64,
                aspectRatio,
                resolution,
                duration: duration || 6,
                model: ep.model,
                baseUrl: ep.baseUrl,
                apiKey: ep.apiKey,
            });

        } else if (isKlingModel) {
            // --- KLING AI VIDEO GENERATION ---

            // Check if this is a Kling 2.6 model (route to Fal.ai - official API doesn't support v2.6)
            const isKling26 = videoModel === 'kling-v2-6';
            // Check if this is a motion control request (kling-v2-6 with motion reference)
            const isMotionControl = isKling26 && motionReferenceUrl;

            let resultVideoUrl;

            if (isKling26) {
                // --- KLING 2.6 VIA FAL.AI ---
                // Official Kling API doesn't support v2.6, use fal.ai instead
                const { FAL_API_KEY } = req.app.locals;

                if (!FAL_API_KEY) {
                    return res.status(500).json({
                        error: "FAL_API_KEY not configured. Add FAL_API_KEY to .env for Kling 2.6."
                    });
                }

                if (isMotionControl) {
                    // Motion Control mode
                    console.log(`\n[Route] Kling 2.6 Motion Control detected - routing to fal.ai`);
                    console.log(`[Route] Motion Reference: ${motionReferenceUrl ? 'YES (' + Math.round(motionReferenceUrl.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Character Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Prompt: ${prompt ? prompt.substring(0, 50) + '...' : '(none)'}`);

                    const { generateFalMotionControl } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalMotionControl({
                        prompt,
                        characterImageBase64: imageBase64,
                        motionVideoBase64: motionReferenceUrl,
                        characterOrientation: 'video',
                        apiKey: FAL_API_KEY
                    });
                } else {
                    // Standard Image-to-Video mode
                    console.log(`\n[Route] Kling 2.6 Image-to-Video - routing to fal.ai`);
                    console.log(`[Route] Image: ${imageBase64 ? 'YES (' + Math.round(imageBase64.length / 1024) + ' KB)' : 'NO'}`);
                    console.log(`[Route] Duration: ${duration || 5}s`);
                    console.log(`[Route] Generate Audio: ${req.body.generateAudio !== false}`);

                    const { generateFalImageToVideo } = await import('../services/fal.js');

                    resultVideoUrl = await generateFalImageToVideo({
                        prompt,
                        imageBase64,
                        duration: String(duration || 5),
                        generateAudio: req.body.generateAudio !== false, // Default to true
                        apiKey: FAL_API_KEY
                    });
                }
            } else {
                // --- STANDARD KLING VIDEO GENERATION ---
                if (!KLING_ACCESS_KEY || !KLING_SECRET_KEY) {
                    return res.status(500).json({
                        error: "Kling API credentials not configured. Add KLING_ACCESS_KEY and KLING_SECRET_KEY to .env"
                    });
                }

                console.log(`Using Kling AI model: ${videoModel}, duration: ${duration || 5}s`);

                resultVideoUrl = await generateKlingVideo({
                    prompt,
                    imageBase64,
                    lastFrameBase64,
                    modelId: videoModel,
                    aspectRatio,
                    duration: duration || 5,
                    motionReferenceUrl,
                    accessKey: KLING_ACCESS_KEY,
                    secretKey: KLING_SECRET_KEY
                });
            }

            // Download from the result URL
            const videoResponse = await fetch(resultVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download generated video');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else if (isHailuoModel) {
            // --- HAILUO AI VIDEO GENERATION ---
            if (!HAILUO_API_KEY) {
                return res.status(500).json({
                    error: "Hailuo API key not configured. Add HAILUO_API_KEY to .env"
                });
            }

            console.log(`Using Hailuo AI model: ${videoModel}, duration: ${duration || 6}s`);

            const hailuoVideoUrl = await generateHailuoVideo({
                prompt,
                imageBase64,
                lastFrameBase64,
                modelId: videoModel,
                aspectRatio,
                resolution,
                duration: duration || 6,
                apiKey: HAILUO_API_KEY
            });

            // Download from Hailuo's URL
            const videoResponse = await fetch(hailuoVideoUrl);
            if (!videoResponse.ok) {
                throw new Error('Failed to download video from Hailuo');
            }
            videoBuffer = Buffer.from(await videoResponse.arrayBuffer());

        } else {
            // 兜底：未知视频模型。Veo 直连已下线，统一走 gpt2api（见上方分支）。
            return res.status(400).json({ error: `不支持的视频模型: ${videoModel || ''}` });
        }

        // Save media into the owner's namespaced dir (P1)
        const ownerVideosDir = userMediaDir(req.app.locals.LIBRARY_DIR, req.user?.id, 'videos');
        const saved = await saveBufferToFile(videoBuffer, ownerVideosDir, 'vid', 'mp4');
        const resultUrl = saved.url;

        // 每次生成 = 一条独立历史：文件名/ID 用唯一的 saved.id（不再用 nodeId，
        // 否则同一节点反复生成会互相覆盖）。nodeId 仅作为字段保存供恢复用。
        const metadata = {
            id: saved.id,
            nodeId: nodeId || null,  // 仅用于「刷新后恢复」按节点查找，不参与历史去重
            ownerId: req.user?.id,  // P1：归属当前用户
            filename: saved.filename,
            url: resultUrl,
            prompt: prompt,
            title: title || '',  // 节点标题（如「镜头 01 视频」），剪辑页素材列表用于区分镜头
            model: videoModel || 'veo-3.1',
            aspectRatio: aspectRatio || 'Auto',
            resolution: resolution || 'Auto',
            createdAt: new Date().toISOString(),
            type: 'videos'
        };
        fs.writeFileSync(path.join(VIDEOS_DIR, `${saved.id}.json`), JSON.stringify(metadata, null, 2));

        console.log(`Video saved: ${resultUrl} (model: ${videoModel || 'veo-3.1'})`);
        // 成功后扣费（管理员/总开关关 → 豁免）
        if (!isExempt(req.user)) {
            try { charge(req.user, { category: 'video', modelId: videoModel, params: { duration, resolution, tier: videoModel }, refId: nodeId || saved.id }); }
            catch (e) { console.error('[billing] charge video failed:', e.message); }
        }
        return res.json({ resultUrl });

    } catch (error) {
        console.error("Server Video Gen Error:", error);
        res.status(500).json({ error: error.message || "Video generation failed" });
    } finally {
        if (reqNodeId) activeGenerations.delete(reqNodeId);
    }
});

// ============================================================================
// GENERATION STATUS / RECOVERY
// ============================================================================

/**
 * Check if a generation has finished for a specific nodeId.
 * Returns the resultUrl if it exists.
 */
router.get('/generation-status/:nodeId', async (req, res) => {
    try {
        const { nodeId } = req.params;
        const { IMAGES_DIR, VIDEOS_DIR } = req.app.locals;

        // 历史文件名已改为唯一 id，故按元数据里的 nodeId 字段扫描，取「最新一条」
        // （前端再用 generationStartTime vs createdAt 防过期）。兼容旧的
        // ${nodeId}.json 命名（那时文件名即 nodeId）。仅限本人。
        const sameOwner = (meta) => !req.user || meta.ownerId === req.user.id || !meta.ownerId;
        const findLatestByNode = (dir) => {
            if (!fs.existsSync(dir)) return null;
            let best = null;
            for (const f of fs.readdirSync(dir)) {
                if (!f.endsWith('.json')) continue;
                try {
                    const meta = JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8'));
                    const matches = meta.nodeId === nodeId || path.basename(f, '.json') === nodeId;
                    if (!matches || !sameOwner(meta)) continue;
                    if (!best || new Date(meta.createdAt).getTime() > new Date(best.createdAt).getTime()) best = meta;
                } catch (_) { /* skip invalid json */ }
            }
            return best;
        };

        // Check images metadata
        const imgMeta = findLatestByNode(IMAGES_DIR);
        if (imgMeta) {
            return res.json({ status: 'success', resultUrl: imgMeta.url || `/library/images/${imgMeta.filename}`, type: 'image', createdAt: imgMeta.createdAt });
        }

        // Check videos metadata
        const vidMeta = findLatestByNode(VIDEOS_DIR);
        if (vidMeta) {
            return res.json({ status: 'success', resultUrl: vidMeta.url || `/library/videos/${vidMeta.filename}`, type: 'video', createdAt: vidMeta.createdAt });
        }

        // 没有结果文件：区分「本进程还在生成」和「应用重启后任务已中断」
        if (activeGenerations.has(nodeId)) {
            return res.json({ status: 'pending' });
        }
        res.json({ status: 'stale' });
    } catch (error) {
        console.error("Status Check Error:", error);
        res.status(500).json({ error: error.message });
    }
});

export default router;
