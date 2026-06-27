# 公共库与共享 · 实现计划 1 — 素材库底层(引用化 + 删除护栏 + 分类个人化 + 改分类)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 把素材库从"保存即复制文件"改成"纯引用(零拷贝)",加全路径物理删除护栏,并把分类从全局共享改为每用户、补上"事后改分类"能力。

**Architecture:** 改 Express 文件型后端(`server/index.js`)的素材/分类端点。素材行(`library/assets/assets.json`)是指向唯一物理文件的元数据;`POST /api/library` 对已在服务器上的文件只建行不复制,仅 `data:` 新字节落盘一次。任何 `unlink` 前用 `assetUrlReferencedElsewhere` 护栏避免跨引用裂图。分类落到 `library/users/{id}/categories.json`。

**Tech Stack:** Node ESM + Express + better-sqlite3(本计划不碰 DB)、文件型 JSON 持久化、React/Vite(TS)前端、`curl` + `npx tsc --noEmit` 验证。

**验证约定(本项目无 vitest/jest,按实际手段验证):**
- 后端:重启服务 → `curl` 冒烟,带 JWT。**复用以下片段取 admin token:**

```bash
cd /Users/savewind/Documents/chat/server209/MagicalCanvas
pkill -f "node server/index.js" 2>/dev/null; sleep 1
nohup node server/index.js > /tmp/canvas-server.log 2>&1 & sleep 2.5
TOKEN=$(curl -s -X POST localhost:3501/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"admin","password":"admin12345"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")
echo "token len: ${#TOKEN}"
```

- 前端:`npx tsc --noEmit`(必须 0 报错)。
- **不要高频压测 fp 账号**(出图/出视频接口),本计划只读取/操作已存在的素材文件。

**关键既有符号(已核对,可直接引用):**
- `LIBRARY_DIR` / `LIBRARY_ASSETS_DIR` / `IMAGES_DIR` / `VIDEOS_DIR`(`server/index.js:37-43`)
- `canAccess(ownerId, user)`(`server/auth/ownership.js`):本人 OR(无 owner && admin)
- `libUrlToPath(libraryDir, url)`(`server/utils/imageHelpers.js:22`):`/library/...` → 磁盘绝对路径,非法返 null
- `DEFAULT_CATEGORIES = ['Character','Scene','Item','Style','Sound Effect','Others']`(`server/index.js:462`)
- 素材行现状字段:`{id, ownerId, name, category, url, type, createdAt, ...meta}`;新增 `visibility`('private'|'public')、`sourceAssetId`(string|null)

---

## 文件结构

| 文件 | 责任 | 改动 |
|---|---|---|
| `server/index.js` | 素材/分类端点 | 改 `POST /api/library`、`DELETE /api/library/:id`、`DELETE /api/assets/:type/:id`;新增 `assetUrlReferencedElsewhere`、`POST /api/library/:id/category`;categories 三端点改每用户 |
| `src/components/AssetLibraryPanel.tsx` | 画布素材库面板 | 新增"改分类"下拉 + 处理函数 |

> 本计划只覆盖 Phase 1+2(素材底层)。Phase 3(公共素材库)、4(公共工作流)、5(管理员页)在本计划落地并验证后另立计划。

---

## Task 1: 物理删除护栏 helper + `POST /api/library` 改为零拷贝

**Files:**
- Modify: `server/index.js`(在 `POST /api/library` 上方加 helper;替换 `POST /api/library` 处理器,约 `336-459`)

- [ ] **Step 1: 在 `app.post('/api/library', ...)` 这一行之前,插入护栏 helper**

在 `server/index.js` 中 `// --- Library Assets API ---` 注释块之后、`app.post('/api/library'` 之前,加入:

```js
/**
 * assets.json 中是否还有别的素材行(排除 excludeId)指向同一个 url。
 * 物理删除护栏:被他人/公开/收藏引用的文件不得 unlink。
 */
function assetUrlReferencedElsewhere(libraryData, url, excludeId) {
    if (!url) return false;
    return libraryData.some(a => a.id !== excludeId && a.url === url);
}
```

- [ ] **Step 2: 整体替换 `POST /api/library` 处理器**

把现有 `app.post('/api/library', async (req, res) => { ... });`(约 336-459 行)整段替换为:

```js
app.post('/api/library', async (req, res) => {
    try {
        const { sourceUrl, name, category, meta } = req.body;
        if (!sourceUrl || !name || !category) {
            return res.status(400).json({ error: "Missing required fields" });
        }

        const safeName = name.replace(/[^a-z0-9]/gi, '_').toLowerCase();
        let url;        // 素材最终指向的 /library/... 路径
        let assetType;  // 'image' | 'video'

        if (sourceUrl.startsWith('data:')) {
            // 真·新字节(本地上传/base64)→ 一次性落盘到本人 assets 目录。
            // 这是该文件的唯一一份,不是"备份"。
            const matches = sourceUrl.match(/^data:([A-Za-z-+\/]+);base64,(.+)$/);
            if (!matches || matches.length !== 3) {
                return res.status(400).json({ error: 'Invalid data URL format' });
            }
            const mimeType = matches[1];
            const buffer = Buffer.from(matches[2], 'base64');
            const mimeExt = {
                'image/jpeg': '.jpg', 'image/png': '.png', 'image/webp': '.webp', 'image/gif': '.gif',
                'video/mp4': '.mp4', 'video/webm': '.webm', 'video/quicktime': '.mov',
            };
            const ext = mimeExt[mimeType] || (mimeType.startsWith('video/') ? '.mp4' : '.png');
            const destDir = path.join(LIBRARY_DIR, 'users', req.user.id, 'assets', category);
            fs.mkdirSync(destDir, { recursive: true });
            let destFilename = `${safeName}${ext}`;
            let destPath = path.join(destDir, destFilename);
            while (fs.existsSync(destPath)) {
                destFilename = `${safeName}_${Date.now()}${ext}`;
                destPath = path.join(destDir, destFilename);
            }
            fs.writeFileSync(destPath, buffer);
            url = `/library/users/${req.user.id}/assets/${category}/${destFilename}`;
            assetType = mimeType.startsWith('video/') ? 'video' : 'image';
        } else {
            // 已在服务器上的文件(生成结果/已有素材)→ 只引用,绝不复制。
            let cleanUrl = sourceUrl;
            try { if (sourceUrl.startsWith('http')) cleanUrl = new URL(sourceUrl).pathname; } catch { /* not a URL */ }
            cleanUrl = decodeURIComponent(cleanUrl.split('?')[0]);
            if (!cleanUrl.startsWith('/')) cleanUrl = '/' + cleanUrl;
            // 兼容旧 /assets/ 前缀
            if (cleanUrl.startsWith('/assets/images/')) cleanUrl = cleanUrl.replace('/assets/images/', '/library/images/');
            if (cleanUrl.startsWith('/assets/videos/')) cleanUrl = cleanUrl.replace('/assets/videos/', '/library/videos/');
            const onDisk = libUrlToPath(LIBRARY_DIR, cleanUrl);
            if (!onDisk || !fs.existsSync(onDisk)) {
                return res.status(404).json({ error: "Source file not found", debug: { sourceUrl, cleanUrl } });
            }
            url = cleanUrl; // 指针,零拷贝
            assetType = /\.(mp4|webm|mov)$/i.test(cleanUrl) ? 'video' : 'image';
        }

        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
        let libraryData = [];
        if (fs.existsSync(libraryJsonPath)) {
            libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        }
        const newEntry = {
            id: crypto.randomUUID(),
            ownerId: req.user.id,
            name,
            category,
            url,
            type: assetType,
            visibility: 'private',
            sourceAssetId: null,
            createdAt: new Date().toISOString(),
            ...meta,
        };
        libraryData.push(newEntry);
        fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));
        res.json({ success: true, asset: newEntry });
    } catch (error) {
        console.error("Save to library error:", error);
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 3: 重启服务,验证"引用已有生成图不复制文件"**

取一张已存在的生成图 url(从 `/api/assets/images` 拿第一条),存进素材库,确认磁盘没多出文件:

```bash
# (先跑顶部的 TOKEN 片段)
IMG=$(curl -s "localhost:3501/api/assets/images?limit=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);a=d['assets'] if isinstance(d,dict) else d;print(a[0]['url'])")
echo "source url: $IMG"
BEFORE=$(find library -type f ! -name '*.json' | wc -l | tr -d ' ')
curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$IMG\",\"name\":\"ref test\",\"category\":\"Others\"}" \
  | python3 -c "import json,sys;a=json.load(sys.stdin)['asset'];print('saved url:',a['url'],'| visibility:',a['visibility'],'| sourceAssetId:',a['sourceAssetId'])"
AFTER=$(find library -type f ! -name '*.json' | wc -l | tr -d ' ')
echo "media files before=$BEFORE after=$AFTER (应相等=零拷贝)"
```

Expected:
- `saved url` == `source url`(指针),`visibility: private`,`sourceAssetId: None`
- `before == after`(媒体文件数不变 → 零拷贝)

- [ ] **Step 4: 验证 `data:` 新字节仍会落盘一次(1x1 PNG)**

```bash
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
B=$(find library -type f ! -name '*.json' | wc -l | tr -d ' ')
curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$PNG\",\"name\":\"upload test\",\"category\":\"Others\"}" \
  | python3 -c "import json,sys;a=json.load(sys.stdin)['asset'];print('saved url:',a['url'])"
A=$(find library -type f ! -name '*.json' | wc -l | tr -d ' ')
echo "media files before=$B after=$A (应 +1 = 上传落盘一次)"
```

Expected:`saved url` 形如 `/library/users/<id>/assets/Others/upload_test.png`,`after == before+1`。

- [ ] **Step 5: 提交**

```bash
git add server/index.js
git commit -m "feat(library): 素材保存改为引用已有文件(零拷贝),仅新上传落盘一次"
```

---

## Task 2: `DELETE /api/library/:id` 删除护栏 + 公共/引用分流

**Files:**
- Modify: `server/index.js`(替换 `app.delete('/api/library/:id', ...)`,约 544-580)

- [ ] **Step 1: 整体替换 `DELETE /api/library/:id` 处理器**

```js
app.delete('/api/library/:id', async (req, res) => {
    try {
        const { id } = req.params;
        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
        if (!fs.existsSync(libraryJsonPath)) {
            return res.status(404).json({ error: "Library not found" });
        }
        let libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        const idx = libraryData.findIndex(a => a.id === id);
        if (idx === -1) return res.status(404).json({ error: "Asset not found" });

        const asset = libraryData[idx];
        if (!canAccess(asset.ownerId, req.user)) {
            return res.status(403).json({ error: '无权删除该素材' });
        }
        // 已发布到公共库的素材,原作者不能删,仅管理员可删(管理员走 /api/admin/assets,后续计划)
        if (asset.visibility === 'public' && req.user.role !== 'admin') {
            return res.status(403).json({ error: '已发布到公共库,仅管理员可删除' });
        }

        // 先摘行
        libraryData.splice(idx, 1);

        // 物理文件护栏:仅当 ①非引用(无 sourceAssetId) ②文件在 assets 目录(上传的库文件,非生成结果)
        // ③无其他行引用同 url 时,才真正 unlink。生成结果由"历史"流程管理,这里不碰。
        const isUploaded = typeof asset.url === 'string' && asset.url.includes('/assets/');
        if (!asset.sourceAssetId && isUploaded && !assetUrlReferencedElsewhere(libraryData, asset.url, asset.id)) {
            const filePath = libUrlToPath(LIBRARY_DIR, asset.url);
            if (filePath && fs.existsSync(filePath)) fs.unlinkSync(filePath);
        }

        fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));
        res.json({ success: true });
    } catch (error) {
        console.error("Delete library asset error:", error);
        res.status(500).json({ error: error.message });
    }
});
```

- [ ] **Step 2: 重启服务,验证"删除引用行不删物理文件"**

复用 Task 1 Step 3 建立的引用行(url 指向生成图)。删它,确认生成文件还在:

```bash
# 新建一个指向生成图的引用行并拿到 id
IMG=$(curl -s "localhost:3501/api/assets/images?limit=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);a=d['assets'] if isinstance(d,dict) else d;print(a[0]['url'])")
RID=$(curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$IMG\",\"name\":\"guard test\",\"category\":\"Others\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['asset']['id'])")
DISK=$(python3 -c "print('library'+'$IMG'[len('/library'):])")
echo "file exists before delete: $([ -f "$DISK" ] && echo YES || echo NO)"
curl -s -X DELETE "localhost:3501/api/library/$RID" -H "Authorization: Bearer $TOKEN" >/dev/null
echo "file exists AFTER delete:  $([ -f "$DISK" ] && echo YES || echo NO)  (应仍 YES = 护栏生效)"
```

Expected:删除后文件**仍存在**(因为它是生成结果,被引用,护栏不删)。

- [ ] **Step 3: 验证"删除上传的库文件(无引用)会删物理文件"**

```bash
# 上传一张新图进库,拿 id 和 url
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
RES=$(curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$PNG\",\"name\":\"del upload\",\"category\":\"Others\"}")
UID2=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['asset']['id'])")
UURL=$(echo "$RES" | python3 -c "import json,sys;print(json.load(sys.stdin)['asset']['url'])")
UDISK=$(python3 -c "print('library'+'$UURL'[len('/library'):])")
echo "uploaded file before: $([ -f "$UDISK" ] && echo YES || echo NO)"
curl -s -X DELETE "localhost:3501/api/library/$UID2" -H "Authorization: Bearer $TOKEN" >/dev/null
echo "uploaded file AFTER:  $([ -f "$UDISK" ] && echo YES || echo NO)  (应 NO = 已清理)"
```

Expected:上传文件被删(NO)。

- [ ] **Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat(library): 删除护栏 — 引用行/公开素材不删物理文件,仅未被引用的上传文件清理"
```

---

## Task 3: 历史删除(`DELETE /api/assets/:type/:id`)也加引用护栏

**Files:**
- Modify: `server/index.js`(`app.delete('/api/assets/:type/:id', ...)`,约 1088-1132)

> 原因:素材库引用的生成文件,若用户从"历史"里删掉该图,会 unlink 物理文件 → 裂图。这里补护栏。

- [ ] **Step 1: 在该处理器里捕获 mediaUrl**

找到这一行:

```js
        let mediaPath = null;
```

替换为:

```js
        let mediaPath = null;
        let mediaUrl = null;
```

然后找到读取 metadata 的块里这一行:

```js
                mediaPath = metadata.url ? libUrlToPath(LIBRARY_DIR, metadata.url)
                    : (metadata.filename ? path.join(targetDir, metadata.filename) : null);
```

在其后补一行:

```js
                mediaUrl = metadata.url || (metadata.filename ? `/library/${type}/${metadata.filename}` : null);
```

- [ ] **Step 2: 给 unlink 加护栏**

找到:

```js
        // Delete the media file
        if (mediaPath && fs.existsSync(mediaPath)) {
            fs.unlinkSync(mediaPath);
            console.log(`Deleted asset file: ${mediaPath}`);
        }
```

替换为:

```js
        // 护栏:若该媒体已被素材库引用(公开/收藏/保存),只删历史元数据,不删物理文件,避免裂图
        let referencedByAsset = false;
        try {
            const ljp = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
            if (mediaUrl && fs.existsSync(ljp)) {
                const rows = JSON.parse(fs.readFileSync(ljp, 'utf8'));
                referencedByAsset = rows.some(a => a.url === mediaUrl);
            }
        } catch { /* assets.json 损坏则按未引用处理 */ }

        // Delete the media file
        if (mediaPath && fs.existsSync(mediaPath) && !referencedByAsset) {
            fs.unlinkSync(mediaPath);
            console.log(`Deleted asset file: ${mediaPath}`);
        }
```

- [ ] **Step 3: 重启服务,验证历史删除被护栏拦住**

```bash
# 取一张生成图,既保留在历史,又把它存进素材库(引用)
META=$(curl -s "localhost:3501/api/assets/images?limit=1" -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import json,sys;d=json.load(sys.stdin);a=d['assets'] if isinstance(d,dict) else d;print(a[0]['id'],a[0]['url'])")
AID=$(echo $META | cut -d' ' -f1); AURL=$(echo $META | cut -d' ' -f2)
curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$AURL\",\"name\":\"hist guard\",\"category\":\"Others\"}" >/dev/null
HDISK=$(python3 -c "print('library'+'$AURL'[len('/library'):])")
echo "file before history-delete: $([ -f "$HDISK" ] && echo YES || echo NO)"
curl -s -X DELETE "localhost:3501/api/assets/images/$AID" -H "Authorization: Bearer $TOKEN" >/dev/null
echo "file AFTER history-delete:  $([ -f "$HDISK" ] && echo YES || echo NO)  (应仍 YES = 护栏生效)"
```

Expected:历史删除后文件仍在(被素材库引用,护栏拦截 unlink)。

- [ ] **Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat(history): 历史删除前检查素材库引用,被引用的文件保留物理文件"
```

---

## Task 4: 分类改为每用户

**Files:**
- Modify: `server/index.js`(`loadCategories`/`saveCategories` 约 465-484;三个 categories 端点 486-523)

- [ ] **Step 1: 替换 `loadCategories` / `saveCategories` 为每用户版**

找到现有 `function loadCategories()` 与 `function saveCategories(list)`(连同上方 `const categoriesJsonPath = ...`),整体替换为:

```js
// 每用户分类文件:library/users/{userId}/categories.json
const userCategoriesPath = (userId) => path.join(LIBRARY_DIR, 'users', String(userId || '_anon'), 'categories.json');

function loadCategories(userId) {
    try {
        const p = userCategoriesPath(userId);
        if (fs.existsSync(p)) {
            const parsed = JSON.parse(fs.readFileSync(p, 'utf8'));
            if (parsed && Array.isArray(parsed.all)) {
                const list = parsed.all.filter(c => typeof c === 'string' && c.trim());
                if (list.length > 0) return list;
            }
        }
        // 首次:从旧全局 categories.json 继承(若有),否则默认
        const legacy = path.join(LIBRARY_ASSETS_DIR, 'categories.json');
        if (fs.existsSync(legacy)) {
            const lp = JSON.parse(fs.readFileSync(legacy, 'utf8'));
            const list = Array.isArray(lp)
                ? [...DEFAULT_CATEGORIES, ...lp.filter(c => typeof c === 'string' && c.trim() && !DEFAULT_CATEGORIES.includes(c))]
                : (lp && Array.isArray(lp.all) ? lp.all.filter(c => typeof c === 'string' && c.trim()) : null);
            if (list && list.length > 0) return list;
        }
    } catch (_) { /* 损坏时回退默认 */ }
    return [...DEFAULT_CATEGORIES];
}

function saveCategories(userId, list) {
    const dir = path.join(LIBRARY_DIR, 'users', String(userId || '_anon'));
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(userCategoriesPath(userId), JSON.stringify({ all: list }, null, 2));
}
```

- [ ] **Step 2: 三个 categories 端点改为传 `req.user.id`,删分类只动本人素材**

把 GET/POST/DELETE `/api/library/categories*` 三段替换为:

```js
app.get('/api/library/categories', (req, res) => {
    res.json({ categories: loadCategories(req.user.id) });
});

app.post('/api/library/categories', (req, res) => {
    const name = String(req.body?.name || '').trim().slice(0, 30);
    if (!name) return res.status(400).json({ error: '分类名称不能为空' });
    const categories = loadCategories(req.user.id);
    if (name === 'All' || categories.includes(name)) {
        return res.status(409).json({ error: '该分类已存在' });
    }
    categories.push(name);
    saveCategories(req.user.id, categories);
    res.json({ categories });
});

app.delete('/api/library/categories/:name', (req, res) => {
    const name = decodeURIComponent(req.params.name);
    const categories = loadCategories(req.user.id);
    if (!categories.includes(name)) return res.status(404).json({ error: '分类不存在' });
    if (categories.length <= 1) return res.status(400).json({ error: '至少保留一个分类' });
    const next = categories.filter(c => c !== name);
    saveCategories(req.user.id, next);
    // 该分类下「本人」素材改挂到剩余分类(优先 Others),文件不动
    const fallback = next.includes('Others') ? 'Others' : next[next.length - 1];
    const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
    if (fs.existsSync(libraryJsonPath)) {
        try {
            const data = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
            let changed = false;
            for (const a of data) {
                if (a.ownerId === req.user.id && a.category === name) { a.category = fallback; changed = true; }
            }
            if (changed) fs.writeFileSync(libraryJsonPath, JSON.stringify(data, null, 2));
        } catch (_) { /* assets.json 损坏时跳过迁移 */ }
    }
    res.json({ categories: next });
});
```

- [ ] **Step 3: 重启服务,验证两个用户的分类互不影响**

```bash
UTOK=$(curl -s -X POST localhost:3501/api/auth/login -H 'Content-Type: application/json' \
  -d '{"username":"user001","password":"12345678"}' | python3 -c "import json,sys;print(json.load(sys.stdin)['accessToken'])")
# admin 加一个分类
curl -s -X POST localhost:3501/api/library/categories -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"AdminOnlyCat"}' >/dev/null
echo "admin 分类: $(curl -s localhost:3501/api/library/categories -H "Authorization: Bearer $TOKEN")"
echo "user001 分类: $(curl -s localhost:3501/api/library/categories -H "Authorization: Bearer $UTOK")"
```

Expected:admin 列表含 `AdminOnlyCat`,user001 列表**不含**(每用户隔离)。

- [ ] **Step 4: 提交**

```bash
git add server/index.js
git commit -m "feat(library): 分类改为每用户(library/users/{id}/categories.json),删分类只动本人素材"
```

---

## Task 5: `POST /api/library/:id/category` 改素材分类

**Files:**
- Modify: `server/index.js`(在 `DELETE /api/library/:id` 之后新增)

- [ ] **Step 1: 新增改分类端点**

在 `app.delete('/api/library/:id', ...)` 处理器之后插入:

```js
// 改某素材的分类(本人,只改元数据,不动文件)
app.post('/api/library/:id/category', (req, res) => {
    try {
        const category = String(req.body?.category || '').trim();
        if (!category) return res.status(400).json({ error: '分类不能为空' });
        const libraryJsonPath = path.join(LIBRARY_ASSETS_DIR, 'assets.json');
        if (!fs.existsSync(libraryJsonPath)) return res.status(404).json({ error: 'Library not found' });
        const libraryData = JSON.parse(fs.readFileSync(libraryJsonPath, 'utf8'));
        const asset = libraryData.find(a => a.id === req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });
        if (!canAccess(asset.ownerId, req.user)) return res.status(403).json({ error: '无权修改该素材' });
        asset.category = category;
        fs.writeFileSync(libraryJsonPath, JSON.stringify(libraryData, null, 2));
        res.json({ success: true, asset });
    } catch (e) {
        console.error('Change asset category error:', e);
        res.status(500).json({ error: e.message });
    }
});
```

- [ ] **Step 2: 重启服务,验证改分类生效**

```bash
# 上传一张图进 Others,再改到 Scene
PNG="data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg=="
CID=$(curl -s -X POST localhost:3501/api/library -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' \
  -d "{\"sourceUrl\":\"$PNG\",\"name\":\"cat test\",\"category\":\"Others\"}" \
  | python3 -c "import json,sys;print(json.load(sys.stdin)['asset']['id'])")
curl -s -X POST "localhost:3501/api/library/$CID/category" -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"category":"Scene"}' \
  | python3 -c "import json,sys;print('new category:',json.load(sys.stdin)['asset']['category'])"
```

Expected:`new category: Scene`。

- [ ] **Step 3: 提交**

```bash
git add server/index.js
git commit -m "feat(library): 新增 POST /api/library/:id/category 事后改素材分类"
```

---

## Task 6: 前端 — 素材卡"改分类"下拉

**Files:**
- Modify: `src/components/AssetLibraryPanel.tsx`

- [ ] **Step 1: 在 `AssetLibraryPanel` 组件内新增改分类处理函数**

在 `handleDeleteMany` 函数定义之后,加入:

```tsx
    // 改某素材分类后,本地更新该行 category
    const handleChangeCategory = async (id: string, category: string) => {
        try {
            const res = await fetch(`/api/library/${id}/category`, {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ category }),
            });
            if (!res.ok) { showAppAlert('改分类失败'); return; }
            setAssets(prev => prev.map(a => a.id === id ? { ...a, category } : a));
        } catch (_) {
            showAppAlert('改分类失败');
        }
    };
```

- [ ] **Step 2: 把 `onChangeCategory` 透传进两处 `<AssetLibraryContent .../>`**

两处 `<AssetLibraryContent` 调用(modal 与 panel)都已传 `categories={categories}`。在每处的 `onDeleteCategory={handleDeleteCategory}` 之后各加一行:

```tsx
                        onChangeCategory={handleChangeCategory}
```

- [ ] **Step 3: 在 `AssetLibraryContent` 解构里接收新 prop**

把:

```tsx
    categories = DEFAULT_CATEGORIES, onAddCategory, onDeleteCategory
}: any) => {
```

改为:

```tsx
    categories = DEFAULT_CATEGORIES, onAddCategory, onDeleteCategory, onChangeCategory
}: any) => {
```

- [ ] **Step 4: 在 `AssetLibraryContent` 内加"当前正在改分类的素材 id"局部状态**

在 `const [deleteConfirmId, setDeleteConfirmId] = useState<string | null>(null);` 之后加:

```tsx
    const [categoryMenuId, setCategoryMenuId] = useState<string | null>(null);
```

- [ ] **Step 5: 在素材卡上加"改分类"按钮 + 下拉菜单**

找到非多选模式下的单删按钮块(`<button ... title="删除素材"><Trash2 size={14} /></button>`)。在它**之前**插入改分类按钮 + 菜单(同在 `manageMode ? null : ...` 之外、卡片内):

```tsx
                                {/* 改分类(非多选模式) */}
                                {!manageMode && (
                                    <div className="absolute top-1 left-1 z-10" onClick={(e) => e.stopPropagation()}>
                                        <button
                                            className="p-1.5 bg-black/60 text-white rounded-md opacity-0 group-hover:opacity-100 transition-opacity hover:bg-neutral-700"
                                            onClick={(e) => { e.stopPropagation(); setCategoryMenuId(categoryMenuId === asset.id ? null : asset.id); }}
                                            title="改分类"
                                        >
                                            <FolderInput size={14} />
                                        </button>
                                        {categoryMenuId === asset.id && (
                                            <div className="absolute top-8 left-0 w-32 max-h-48 overflow-y-auto bg-[#1a1a1a] border border-neutral-700 rounded-lg shadow-xl py-1 z-30">
                                                {categories.map((cat: string) => (
                                                    <button
                                                        key={cat}
                                                        onClick={(e) => { e.stopPropagation(); onChangeCategory?.(asset.id, cat); setCategoryMenuId(null); }}
                                                        className={`w-full px-3 py-1.5 text-left text-xs hover:bg-neutral-800 flex items-center justify-between ${asset.category === cat ? 'text-white' : 'text-neutral-400'}`}
                                                    >
                                                        {cat}{asset.category === cat && <Check size={12} />}
                                                    </button>
                                                ))}
                                            </div>
                                        )}
                                    </div>
                                )}
```

- [ ] **Step 6: 引入 `FolderInput` 图标**

把文件顶部:

```tsx
import { X, Trash2, Upload, Loader2, Plus, Check } from 'lucide-react';
```

改为:

```tsx
import { X, Trash2, Upload, Loader2, Plus, Check, FolderInput } from 'lucide-react';
```

- [ ] **Step 7: 类型检查**

Run: `npx tsc --noEmit`
Expected: 0 报错。

- [ ] **Step 8: 提交**

```bash
git add src/components/AssetLibraryPanel.tsx
git commit -m "feat(library-ui): 素材卡新增『改分类』下拉,可事后调整素材分类"
```

---

## 收尾

- [ ] **把 user001 的分类测试残留清掉(可选):** Task 4 给 admin 加的 `AdminOnlyCat` 是真实数据,如不需要可删:
  `curl -s -X DELETE "localhost:3501/api/library/categories/AdminOnlyCat" -H "Authorization: Bearer $TOKEN"`
- [ ] **push:** `git push origin feat/p0-auth`

完成后即可进入 **实现计划 2(公共素材库:publish / from-public + 面板我的/公共切换)**。
