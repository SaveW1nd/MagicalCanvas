# 公共库与共享 · 实现计划 2 — 公共素材库(发布 / 收藏,零拷贝)

> **For agentic workers:** 接计划 1(素材引用模型已落地)。本计划加"公共素材库":用户发布自有素材到公共、从公共收藏到自己库(全程零拷贝,只增减元数据行)。设计见 `docs/public-library-and-sharing-design.md` §3.1 / §4.1。

**Goal:** 让素材能在"我的库 ↔ 公共库"之间流转,全程指针、零文件拷贝;公共素材原作者不可删(仅管理员,计划 4)。

**Tech Stack:** Express 文件型后端(`server/index.js`,assets.json)+ React/Vite(`AssetLibraryPanel.tsx`)。验证:curl(复用计划 1 顶部 TOKEN 片段)+ `npx tsc --noEmit` + Playwright。

**前置事实(计划 1 已就绪):** 素材行含 `visibility`('private'|'public')、`sourceAssetId`;`POST /api/library` 零拷贝;删除护栏齐全;`canAccess(ownerId,user)`、`crypto.randomUUID()`、`LIBRARY_ASSETS_DIR` 可用。

---

## 后端(server/index.js,均挂在现有 `/api/library` 同区)

### Task 1 — `POST /api/library/:id/publish`(发布到公共)
- 本人原创素材(`!sourceAssetId`)→ `visibility='public'` + `publishedAt`/`publishedBy`。
- 收藏行(有 sourceAssetId)拒绝:`400 收藏的素材不能再发布`。
- 验证:发布后 `GET /api/library/public` 能见到。

### Task 2 — `POST /api/library/from-public/:publicId`(收藏到我的库,零拷贝)
- 找到 `visibility==='public'` 的目标 → 给调用者建一行 `{ownerId:me, url:<同>, category:'Others', type, sourceAssetId:publicId, visibility:'private'}`。
- **幂等**:我若已有指向同一 `url` 的行,直接返回它(`already:true`),不重复建。
- 验证:收藏后媒体文件数不变(零拷贝);重复收藏不新增行。

### Task 3 — `GET /api/library/public`(列公共素材)
- 返回所有 `visibility==='public'` 行,脱敏为 `{id,name,category,url,type,publishedBy,mine}`(`mine = ownerId===我`)。
- 路径与 `GET /api/library`、`GET /api/library/categories` 互不冲突(精确匹配)。

---

## 前端(src/components/AssetLibraryPanel.tsx)

### Task 4 — 我的 / 公共 切换 + 发布 / 收藏
- `AssetLibraryPanel`:新增 `activeTab:'my'|'public'`、`publicAssets`、`fetchPublic()`;`handlePublish(id)`(发布后本地置 public + 刷新公共);`handleAddFromPublic(id)`(收藏后刷新我的库)。`LibraryAsset` 接口加 `visibility?/sourceAssetId?/publishedBy?/mine?`。
- `AssetLibraryContent`:接 `activeTab/setActiveTab/publicAssets/onPublish/onAddFromPublic`;`source = activeTab==='public'?publicAssets:assets`;公共页分类 pill 由公共素材推导;顶部加 我的/公共 切换。
  - **我的页**卡片:改分类 + 删除(若 `visibility==='public'` → 删除禁用 + 提示"已发布,仅管理员可删") + **发布**按钮(仅非 public 且非收藏行)。批量删除仅我的页。
  - **公共页**卡片:**加入我的库**(`!mine`)或角标"我发布的"(`mine`);无删除/改分类/批量。
- 验证:`npx tsc --noEmit` + Playwright(两 tab 切换、发布、收藏、已发布素材删除禁用)。

---

## 落地顺序:Task 1→2→3 后端各自 curl 验证并提交;Task 4 前端 tsc+Playwright 后提交。完成即进入计划 3(公共工作流 + 只读预览)。
