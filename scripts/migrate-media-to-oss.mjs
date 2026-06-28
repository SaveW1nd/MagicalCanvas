// scripts/migrate-media-to-oss.mjs
// 把 library 下存量媒体上传到 OSS,并把 JSON 文件里的 /library/... 引用改写为 OSS URL。
// 用法:
//   node scripts/migrate-media-to-oss.mjs           # dry-run(只打印,不改)
//   node scripts/migrate-media-to-oss.mjs --apply    # 真上传 + 真改写
// 依赖运行时环境变量 OSS_*(同服务)。LIBRARY_DIR 指向画布 library 目录。
import fs from 'fs';
import path from 'path';
import { uploadLibraryRel, mimeFromName } from '../server/utils/ossUploader.js';

const LIB = process.env.LIBRARY_DIR || path.join(process.cwd(), 'library');
const BASE = (process.env.OSS_PUBLIC_BASE_URL || '').replace(/\/+$/, '');
const APPLY = process.argv.includes('--apply');
const MEDIA_EXT = new Set(['.png', '.jpg', '.jpeg', '.gif', '.webp', '.mp4', '.webm']);

if (!BASE) { console.error('OSS_PUBLIC_BASE_URL not set'); process.exit(1); }

// 1) 收集所有媒体文件 → 相对 library 的 rel,并算出对应 OSS URL
function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walk(p, out);
    else if (MEDIA_EXT.has(path.extname(e.name).toLowerCase())) out.push(p);
  }
  return out;
}
const mediaFiles = walk(LIB);
const relToUrl = new Map();
for (const f of mediaFiles) {
  const rel = path.relative(LIB, f).split(path.sep).join('/');
  relToUrl.set(`/library/${rel}`, `${BASE}/veo_workflow/canvas/${rel}`);
}
console.log(`media files: ${mediaFiles.length}`);

// 2) 上传(apply 时)
if (APPLY) {
  for (const f of mediaFiles) {
    const rel = path.relative(LIB, f).split(path.sep).join('/');
    await uploadLibraryRel(fs.readFileSync(f), rel, mimeFromName(f));
    console.log('uploaded', rel);
  }
}

// 3) 改写 JSON 引用(edit-projects / workflows / chats / public-workflows / images / videos / users 索引)
const JSON_DIRS = ['edit-projects', 'workflows', 'chats', 'public-workflows', 'images', 'videos', 'users']
  .map(d => path.join(LIB, d));
function rewriteJsonFile(p) {
  let s = fs.readFileSync(p, 'utf8');
  let n = 0;
  for (const [libRef, url] of relToUrl) {
    // 兼容旧引用可能带 ?t=数字 的缓存破坏后缀
    const re = new RegExp(libRef.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '(\\?t=\\d+)?', 'g');
    s = s.replace(re, () => { n++; return url; });
  }
  if (n > 0) {
    console.log(`${APPLY ? 'rewrote' : 'would rewrite'} ${n} refs in ${path.relative(LIB, p)}`);
    if (APPLY) fs.writeFileSync(p, s);
  }
}
function walkJson(dir) {
  if (!fs.existsSync(dir)) return;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) walkJson(p);
    else if (e.name.endsWith('.json')) rewriteJsonFile(p);
  }
}
for (const d of JSON_DIRS) walkJson(d);
console.log('DONE', APPLY ? '(applied)' : '(dry-run)');
