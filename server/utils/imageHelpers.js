/**
 * imageHelpers.js
 * 
 * Utility functions for image/video processing and base64 conversion.
 */

import fs from 'fs';
import path from 'path';
import { uploadLibraryRel, ossEnabled, mimeFromName, ossUrlToLibraryRel } from './ossUploader.js';

// ============================================================================
// PER-OWNER MEDIA PATHS (P1：媒体按用户分目录，路径含 UUID 不可猜)
// ============================================================================

/** 返回某用户某类媒体的落盘目录(自动创建)：{libraryDir}/users/{ownerId}/{kind} */
export function userMediaDir(libraryDir, ownerId, kind) {
    const dir = path.join(libraryDir, 'users', String(ownerId || '_anon'), kind);
    fs.mkdirSync(dir, { recursive: true });
    return dir;
}

/** /library/... 形式的 URL → 磁盘绝对路径(兼容旧 flat 路径与新分目录路径)；非法返回 null */
export function libUrlToPath(libraryDir, url) {
    const s = String(url || '');
    if (!s.startsWith('/library/')) return null;
    const rel = s.slice('/library/'.length).split('?')[0];
    if (rel.includes('..')) return null; // 防穿越
    return path.join(libraryDir, decodeURIComponent(rel));
}

// ============================================================================
// BASE64 HELPERS
// ============================================================================

/**
 * Resolve image to base64 - handles both base64 data URLs and file URLs
 * @param {string} input - Base64 data URL or file URL
 * @returns {string|null} Base64 data URL
 */
export function resolveImageToBase64(input) {
    if (!input) return null;

    // Already a data URL
    if (input.startsWith('data:')) {
        return input;
    }

    // Normalize input - extract path from full URL if needed
    let filePath = input;

    // OSS 公开 URL(本画布前缀)→ 映射到本地双写副本,读本地即可(快、且保持同步)
    if (input.startsWith('http')) {
        try {
            const rel = ossUrlToLibraryRel(input);   // 非本前缀返回 null
            if (rel) {
                const libraryDir = process.env.LIBRARY_DIR || path.join(process.cwd(), 'library');
                const abs = path.join(libraryDir, rel);
                if (fs.existsSync(abs)) {
                    const buf = fs.readFileSync(abs);
                    const ext = path.extname(abs).toLowerCase();
                    const mime = { '.png':'image/png','.jpg':'image/jpeg','.jpeg':'image/jpeg','.gif':'image/gif','.webp':'image/webp','.mp4':'video/mp4','.webm':'video/webm' }[ext] || 'image/png';
                    return `data:${mime};base64,${buf.toString('base64')}`;
                }
            }
        } catch (e) { /* 落到下方通用处理 */ }
    }

    // Handle full URLs like http://localhost:3001/library/images/...
    if (input.startsWith('http://') || input.startsWith('https://')) {
        try {
            const url = new URL(input);
            filePath = url.pathname; // Extract just the path portion
        } catch (e) {
            console.warn('Failed to parse URL:', input);
            return null;
        }
    }

    // File URL (e.g., /library/images/...)
    if (filePath.startsWith('/library/')) {
        try {
            // Strip query string (e.g., ?t=1234567890) used for cache-busting
            const pathWithoutQuery = filePath.split('?')[0];

            // Get the library directory from environment or default
            const libraryDir = process.env.LIBRARY_DIR || path.join(process.cwd(), 'library');
            const relativePath = pathWithoutQuery.replace('/library/', '');
            const absolutePath = path.join(libraryDir, relativePath);

            if (fs.existsSync(absolutePath)) {
                const fileBuffer = fs.readFileSync(absolutePath);
                const ext = path.extname(absolutePath).toLowerCase();
                const mimeType = {
                    '.png': 'image/png',
                    '.jpg': 'image/jpeg',
                    '.jpeg': 'image/jpeg',
                    '.gif': 'image/gif',
                    '.webp': 'image/webp',
                    '.mp4': 'video/mp4',
                    '.webm': 'video/webm'
                }[ext] || 'image/png';

                return `data:${mimeType};base64,${fileBuffer.toString('base64')}`;
            } else {
                console.warn('File not found for base64 conversion:', absolutePath);
            }
        } catch (error) {
            console.error('Error resolving file to base64:', error);
        }
    }

    // If we couldn't resolve it, return null to prevent passing invalid data to API
    console.warn('Could not resolve image to base64:', input.substring(0, 100));
    return null;
}

/**
 * Extract raw base64 from data URL (removes data:image/xxx;base64, prefix)
 * @param {string} dataUrl - Base64 data URL
 * @returns {string|null} Raw base64 string
 */
export function extractRawBase64(dataUrl) {
    if (!dataUrl) return null;
    if (dataUrl.startsWith('data:')) {
        return dataUrl.replace(/^data:[^;]+;base64,/, '');
    }
    return dataUrl;
}

// ============================================================================
// ASPECT RATIO MAPPING
// ============================================================================

/**
 * Map frontend aspect ratio to API-compatible format
 * @param {string} ratio - Frontend aspect ratio string
 * @returns {string} API-compatible aspect ratio
 */
export function mapAspectRatio(ratio) {
    const mapping = {
        'Auto': '1:1',
        '1:1': '1:1',
        '16:9': '16:9',
        '9:16': '9:16',
        '4:3': '4:3',
        '3:4': '3:4',
        '3:2': '3:2',
        '2:3': '2:3',
        '21:9': '21:9',
        '5:4': '5:4',
        '4:5': '4:5'
    };
    return mapping[ratio] || '1:1';
}

// ============================================================================
// FILE SAVING
// ============================================================================

/**
 * 写本地 + 上传 OSS,返回 OSS 公开 URL(失败回退本地 /library URL)。
 * @returns {Promise<{ id, path, filename, localUrl, url }>}
 */
export async function saveBufferToFile(buffer, dir, prefix, extension, customId) {
    const id = customId || `${prefix}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const filename = `${id}.${extension}`;
    const filePath = path.join(dir, filename);
    fs.writeFileSync(filePath, buffer);

    const libraryDir = process.env.LIBRARY_DIR || path.join(process.cwd(), 'library');
    const rel = path.relative(libraryDir, filePath).split(path.sep).join('/'); // users/<id>/images/<file> 或 images/<file>
    const localUrl = `/library/${rel}`;

    let url = localUrl;
    if (ossEnabled()) {
        try {
            url = await uploadLibraryRel(buffer, rel, mimeFromName(filename));
        } catch (e) {
            console.warn('[oss] upload failed, fallback local:', e.message);
        }
    }
    return { id, path: filePath, filename, localUrl, url };
}

/**
 * Save base64 data URL to file (本地+OSS 双写),返回 OSS URL(失败回退本地);非 data URL 原样返回。
 */
export async function saveBase64ToFile(dataUrl, imagesDir, videosDir) {
    if (!dataUrl || typeof dataUrl !== 'string') return dataUrl;
    if (!dataUrl.startsWith('data:')) return dataUrl;

    const imageMatch = dataUrl.match(/^data:image\/(png|jpeg|jpg|webp|gif);base64,(.+)$/);
    if (imageMatch) {
        const ext = imageMatch[1] === 'jpeg' ? 'jpg' : imageMatch[1];
        const buffer = Buffer.from(imageMatch[2], 'base64');
        const saved = await saveBufferToFile(buffer, imagesDir, 'wf_img', ext);
        console.log(`  Workflow sanitize: saved image ${saved.filename}`);
        return saved.url;
    }
    const videoMatch = dataUrl.match(/^data:video\/(mp4|webm);base64,(.+)$/);
    if (videoMatch) {
        const ext = videoMatch[1];
        const buffer = Buffer.from(videoMatch[2], 'base64');
        const saved = await saveBufferToFile(buffer, videosDir, 'wf_vid', ext);
        console.log(`  Workflow sanitize: saved video ${saved.filename}`);
        return saved.url;
    }
    return dataUrl;
}
