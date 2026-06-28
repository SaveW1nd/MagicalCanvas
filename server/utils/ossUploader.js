// server/utils/ossUploader.js
// OSS 上传 + URL↔本地路径映射。凭据来自机器级环境变量 OSS_*。
import OSS from 'ali-oss';

const PREFIX = 'veo_workflow/canvas/';            // 复用桶已配的 veo_workflow/* 公开 policy+CORS
const IMMUTABLE = 'public, max-age=31536000, immutable';

let _client = null;
function client() {
  if (_client) return _client;
  const accessKeyId = process.env.OSS_ACCESS_KEY_ID;
  const accessKeySecret = process.env.OSS_ACCESS_KEY_SECRET;
  const bucket = process.env.OSS_BUCKET;
  if (!accessKeyId || !accessKeySecret || !bucket) throw new Error('OSS env not configured');
  _client = new OSS({
    region: process.env.OSS_REGION || 'oss-cn-hangzhou',
    endpoint: process.env.OSS_ENDPOINT || undefined,
    accessKeyId, accessKeySecret, bucket, secure: true,
  });
  return _client;
}

export function ossEnabled() {
  return !!(process.env.OSS_ACCESS_KEY_ID && process.env.OSS_ACCESS_KEY_SECRET && process.env.OSS_BUCKET);
}

function publicBase() {
  return (process.env.OSS_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
}

const MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif',
  webp: 'image/webp', mp4: 'video/mp4', webm: 'video/webm',
};
export function mimeFromName(name) {
  const ext = String(name).split('.').pop().toLowerCase();
  return MIME[ext] || 'application/octet-stream';
}

/** 把 library 相对路径(如 users/<id>/images/<file>)上传到 OSS,返回公开 URL。 */
export async function uploadLibraryRel(buffer, libraryRel, contentType) {
  const key = PREFIX + libraryRel.split('\\').join('/').replace(/^\/+/, '');
  await client().put(key, buffer, {
    headers: { 'Content-Type': contentType || mimeFromName(libraryRel), 'Cache-Control': IMMUTABLE },
  });
  return `${publicBase()}/${key}`;
}

/** OSS 公开 URL → library 相对路径(仅识别本画布 veo_workflow/canvas/ 前缀);非本前缀返回 null。 */
export function ossUrlToLibraryRel(url) {
  const base = publicBase();
  const s = String(url || '');
  if (!base || !s.startsWith(base + '/')) return null;
  const key = s.slice(base.length + 1).split('?')[0];
  if (!key.startsWith(PREFIX)) return null;
  return key.slice(PREFIX.length);   // users/<id>/images/<file>
}

export { PREFIX as OSS_CANVAS_PREFIX };
