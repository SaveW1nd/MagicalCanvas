# MagicalCanvas 公共库与共享 — 设计文档

> **Status:** 设计稿,基于当前 `feat/p0-auth` 分支(JWT 鉴权 + 文件型持久化 + 每用户 `ownerId` 隔离 + SQLite 注册表/用户)。本文档定义**公共素材库**、**公共工作流(发布/只读/fork)**、**分类个人化**、**管理员素材库管理**四块改造。
>
> **核心心智模型(一句话):**
> - **素材 = 指针 → 永不拷贝。** 字节只有一份,所有"保存/发布/收藏"都只是新增一行指向同一文件的元数据。
> - **工作流 = 文档 → 跨边界深拷贝(含引用图片)。** 发布到公共、fork 到个人,都复制出彼此独立的副本。
>
> **决策锁定(2026-06-27,与用户确认):**
> - **存储策略 = 混合模型**(素材引用 / 工作流副本)。企业级正确做法,且规避视频体量的存储灾难。
> - **公共内容删除权 = 仅管理员。** 公共素材、公共工作流,原作者发布后均不可删,只有管理员能下架/删除。这条规则免费换来"已发布内容不可变",使引用模型的生命周期大幅简化。
> - **物理文件删除护栏:** 任何"被公共素材引用"或"被他人引用"的文件,均不得被 unlink。引用清零前文件保留(轻量引用计数)。
> - **激进的孤儿文件 GC = 不做**(YAGNI)。孤儿文件无害,留待后续统一清扫。
> - **管理员侧入口 = AdminConsole**(管理员登录后进后台,不进画布)。所有"管理全体素材/公共工作流"的能力放在 AdminConsole;画布侧只保留用户自己的发布/收藏/fork。

---

## 1. 现状摘要(动手前的事实基线)

### 1.1 素材库(`/api/library`)
- 数据:单文件 `library/assets/assets.json`,数组 `{id, ownerId, name, category, url, type, createdAt, ...meta}`。
- `GET /api/library` 按 `canAccess(ownerId, user)` 过滤 → **已经是每用户私有**。
- **问题 1:`POST /api/library` 会复制文件**(`copyFileSync` 到 `library/users/{id}/assets/{cat}/`)→ 违背"不备份"。
- **问题 2:分类全局共享**(`library/assets/categories.json` 一个文件)→ 任何人增删影响所有人。
- 物理文件删除:`DELETE /api/library/:id` 删行 + `unlink` 文件(无引用保护)。

### 1.2 工作流
- 我的:`library/workflows/{id}.json`,`ownerId` 隔离,owner-scoped 读写。
- 公共:仅仓库同梱 `public/workflows/*.json`(3 个,只读),**用户无法发布**。
- 加载公共:`onLoadWorkflow('public:'+id)` → 直接灌进活动画布、`workflowId=null`(保存即新 ID 分叉)→ **可在画布直接编辑**(用户要禁止)。

### 1.3 画布图片引用机制(已确认正确,无需改)
- 出图接口落盘后只回 `resultUrl`(`/library/.../images/{file}`);节点存指针。
- 保存工作流时 `sanitizeWorkflowNodes` 把残留 base64 转文件 → 工作流 JSON 只含 URL,不含字节。

### 1.4 权限基线
- `canAccess(ownerId, user)`:本人 OR(无 owner && admin)。
- 全局 `requireAuth` on `/api/*`;`requireAdmin` on `/api/admin/*` 与 `/api/settings`。
- Gate:`role==='admin' → AdminConsole`;`user → App(画布)`。

---

## 2. 数据模型变更

### 2.1 素材行(assets.json)新增字段

| 字段 | 取值 | 说明 |
|---|---|---|
| `visibility` | `'private'` \| `'public'` | 缺省视为 `private`(老数据无需迁移) |
| `sourceAssetId` | string \| null | 若本行是"从公共收藏来的引用",记来源公共素材 id;原创为 null |
| `publishedAt` | ISO string | 发布到公共的时间(仅 public) |
| `publishedBy` | userId | 发布者(= 原 owner) |

**关键不变量:** 同一个物理文件可被 N 行 `url` 相同的素材行引用。**发布/收藏永不改动文件,只增删行。**

### 2.2 视图定义

| 视图 | 查询 |
|---|---|
| 我的素材库 | `ownerId === me`(任意 visibility) |
| 公共素材库 | `visibility === 'public'`(任意 owner) |
| 管理员·全部素材 | 全表 + 附 `ownerName` |

### 2.3 分类:全局 → 每用户

- 新位置:`library/users/{userId}/categories.json`,内容 `{ all: [...] }`。
- 首次读取且无文件 → 用旧全局 `categories.json`(若存在)初始化,否则用 `DEFAULT_CATEGORIES`。
- 增删分类只动调用者自己的列表;删分类时的"改挂回退"只遍历**本人**的素材行。
- **公共素材库的分类**不单独管理:分类只是素材行上的字符串标签;公共视图的筛选 pill 由"当前公共素材里出现过的分类字符串"动态推导。

### 2.4 工作流存储

| 存储 | 路径 | 可写 | 删除权 |
|---|---|---|---|
| 我的工作流 | `library/workflows/{id}.json` | 本人 | 本人 |
| 公共·仓库同梱 | `public/workflows/*.json` | 否(随代码) | — |
| 公共·用户发布 | `library/public-workflows/{id}.json` | 发布时写入 | **仅管理员** |
| 公共工作流自带图片 | `library/public-workflows/assets/{id}/...` | 发布时复制写入 | 随公共工作流 |

公共工作流 JSON 增字段:`publishedBy`、`publishedAt`、`source: 'bundled'|'user'`。

---

## 3. 后端接口

### 3.1 素材:发布 / 收藏 / 删除护栏

| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/api/library` **(改)** | 若 `sourceUrl` 已是服务器 `/library/...` 路径 → **不复制**,直接建行指向它;若是 `data:` URL(真·新字节,本地上传)→ 一次性落盘(唯一一份,非备份),建行。 |
| `POST` | `/api/library/:id/publish` **(新)** | 本人素材 → `visibility='public'` + 记 `publishedAt/publishedBy`。已 public 则幂等。 |
| `POST` | `/api/library/from-public/:publicId` **(新)** | 公共素材 → 给调用者建一行新引用 `{ownerId:me, url:<同>, sourceAssetId:publicId, visibility:'private', category:<默认/选择>}`。**零拷贝。** |
| `DELETE` | `/api/library/:id` **(改)** | 行为分流:① 该行 `visibility==='public'` → **403,提示仅管理员可删**;② 该行是引用(有 `sourceAssetId`)→ 只删行,绝不动文件;③ 私有原创 → 删行,且**仅当无其他行引用同 url 且非 public** 时才 `unlink` 文件(护栏)。 |

**物理删除护栏(贯穿全部删文件路径):** 抽出 `isUrlReferencedElsewhere(url, excludeRowId)` 扫描 assets.json。在 `DELETE /api/library/:id`、`DELETE /api/assets/:type/:id`、历史清空等任何 `unlink` 前调用:若被他人行或 public 行引用 → **跳过 unlink,只删元数据**。保证公共/收藏引用永不裂。

### 3.2 工作流:发布 / fork / 公共删除

| 方法 | 路径 | 行为 |
|---|---|---|
| `POST` | `/api/public-workflows` **(新)** | body `{ workflowId }`。校验本人拥有 → 深拷贝:新 public id;把节点引用的图片(`resultUrl/lastFrame/editorCanvasData/editorBackgroundUrl` + `coverUrl`)逐个**复制**到 `library/public-workflows/assets/{newId}/`,重写 URL;写 `library/public-workflows/{newId}.json`(`publishedBy/publishedAt/source:'user'`)。→ 公共工作流自包含、稳定。 |
| `GET` | `/api/public-workflows` **(改)** | 合并列出仓库同梱 + 用户发布两源,带 `source/publishedBy`。 |
| `GET` | `/api/public-workflows/:id` **(改)** | 两源任一读取。 |
| `POST` | `/api/workflows/fork` **(新)** | body `{ publicId }`。读公共工作流 → 深拷贝:新 workflow id、`ownerId=me`;引用图片**复制**到调用者空间(`library/images/` 新文件)并重写 URL;写 `library/workflows/{newId}.json`。返回新 id。→ 与原作者彻底解耦。 |
| `DELETE` | `/api/public-workflows/:id` **(新)** | **`requireAdmin`**。删用户发布的公共工作流 JSON + 其 `assets/{id}/` 目录。仓库同梱的不可删(404/忽略)。 |

### 3.3 管理员·素材库管理(`requireAdmin`,挂 `/api/admin`)

| 方法 | 路径 | 行为 |
|---|---|---|
| `GET` | `/api/admin/assets` | 全表 + `ownerName`;筛选 `?userId&?category&?visibility&?q`;返回 `users`(下拉用)与分类集合。复用 P3 `/api/admin/history` 的聚合范式。 |
| `POST` | `/api/admin/assets/:id/visibility` | body `{ visibility }`。管理员可强制公开/下架任意素材。 |
| `DELETE` | `/api/admin/assets/:id` | 管理员删除(公共素材唯一可删入口)。删行;物理文件经护栏(引用清零才 unlink)。 |
| `GET` | `/api/admin/public-workflows` | 列用户发布的公共工作流 + `ownerName`。 |
| `DELETE` | `/api/admin/public-workflows/:id` | 同 3.2 的管理员删除(此处为 AdminConsole 提供入口)。 |

---

## 4. 前端改动

### 4.1 `AssetLibraryPanel`(画布·素材库)
- 顶部加 **我的 / 公共** 切换。
- **我的**:每张自有素材 hover 出 **发布到公共**;已 public 的显示"公共"角标,且**删除按钮禁用 + tooltip**"已发布,仅管理员可删";分类 pill = 本人分类(每用户)。
- **公共**:每张素材 hover 出 **加入我的库**(调 `from-public`);分类 pill = 公共素材推导集合;**无删除**(只有管理员能删,且在 AdminConsole)。
- 收藏来的引用行在"我的"里可移除(只删指针)。

### 4.2 `WorkflowPanel`(画布·工作流)
- **我的工作流**卡片加 **发布到公共** 动作(调 `POST /api/public-workflows`)。
- **公共工作流** tab:**去掉"点击直接灌进画布编辑"**;改为点击 → 确认弹窗"**复制到我的工作流并编辑?**" → 调 `/api/workflows/fork` → 成功后切到"我的" tab 并加载可编辑副本。卡片展示封面/标题/描述/节点数足以决策。
  - *(开放项,见 §7)* 是否需要"只读图形预览"——本设计暂不做,留作后续。
- 公共工作流面板**无删除按钮**(管理员在 AdminConsole 删)。

### 4.3 `AdminConsole`(管理员后台)
- 新增 tab **素材库**:全部素材表格/网格,按用户/分类/可见性/关键词筛选;每项可切换公开/下架、删除;复用 P3 范式(`HistoryBrowser` 同款筛选栏 + 卡片)。
- 同页或邻 tab 提供**公共工作流管理**(列出用户发布的、可删除)。

### 4.4 `useWorkflow.ts`
- 移除/收敛 `public:` 前缀的"加载即编辑"分支(改为 fork 流程驱动)。保留普通加载。

---

## 5. 迁移与兼容

- **素材 visibility:** 老行无字段 → 读时默认 `private`,无需脚本。
- **分类:** 首次每用户读取时,若无个人文件则从旧全局 `categories.json` 初始化(存在即继承,否则默认集)。旧全局文件保留为只读回退,不再写入。
- **已复制的旧素材文件**(`library/users/{id}/assets/...`)其行 `url` 仍指向它们,继续有效;不回迁、不清理。
- **`library/` 全程 gitignore**,公共素材/公共工作流数据均落在 `library/` 下,不入库。

---

## 6. 安全与一致性校验点

- 普通用户**仍无法**访问任何 `/api/admin/*`(沿用 `requireAdmin`,已验证 403)。
- `from-public` / `publish` 必须校验调用者身份与目标素材的合法性(收藏只读公共行;发布只许本人原创行)。
- fork / publish 的"复制图片"要走与 `sanitizeWorkflowNodes` 一致的字段清单,避免漏掉 `lastFrame/editorCanvasData/editorBackgroundUrl/coverUrl`。
- 删除护栏覆盖**所有** unlink 路径,防止跨用户引用裂图。
- 公共写入目录 `library/public-workflows/` 启动时 `mkdirSync`。

---

## 7. 开放项(请在评审时拍板)

1. **公共工作流只读预览:** 本设计仅"卡片信息 + fork",不做画布内只读图形预览。是否够用?(够 → 维持;不够 → 追加只读画布模式,工作量更大。)
2. **原作者撤回:** 当前"公共内容仅管理员可删/下架",原作者发布后无法自行撤回。是否给原作者保留"撤回自己发布"的权限?(默认:不给,保持"仅管理员"。)
3. **收藏时的分类归属:** 从公共"加入我的库"时,默认归到哪个分类?(建议:默认 `Others` 或弹一个轻量分类选择;默认走 `Others`。)

---

## 8. 落地顺序(建议)

> 素材引用模型是地基,先做;再分类个人化;再工作流;最后管理员页。

1. **素材引用化 + 删除护栏**:改 `POST /api/library`(去复制)、`DELETE` 护栏、`isUrlReferencedElsewhere`。
2. **分类个人化**:categories 三个端点改每用户 + 前端分类来源。
3. **公共素材库**:`publish` / `from-public` 端点 + `AssetLibraryPanel` 我的/公共切换。
4. **公共工作流**:`publish` / `fork` / 合并列表 + `WorkflowPanel` 改造 + 收敛 `useWorkflow`。
5. **管理员页**:`/api/admin/assets*` + `/api/admin/public-workflows*` + AdminConsole 新 tab。

每步独立可验证、可提交。
