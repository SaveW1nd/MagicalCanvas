# 公共库与共享 · 实现计划 3+4 — 公共工作流 + 管理员素材库管理

> 接计划 1/2(素材引用模型 + 公共素材库已落地)。本计划做:**公共工作流**(发布/只读预览/fork 深拷贝)与**管理员素材库管理页**。设计见 `docs/public-library-and-sharing-design.md` §3.2 / §3.3 / §4。

**心智模型:** 工作流=文档,跨边界**深拷贝(含引用图片)**;公共内容**仅管理员可删**。

---

## 计划 3 — 公共工作流

### 后端(server/index.js)
- 新目录 `library/public-workflows/`(JSON)+ `library/public-workflows/assets/{id}/`(随发布复制的图片);启动 mkdir。
- 媒体深拷贝 helper `copyWorkflowMedia(workflow, destAbsDir, destUrlPrefix)`:复制节点 `resultUrl/lastFrame/editorCanvasData/editorBackgroundUrl` + 顶层 `coverUrl` 指向的 `/library/...` 文件到目标目录,重写为新 URL;源缺失则保留原 URL。
- `POST /api/public-workflows`(body `{workflowId}`):校验本人拥有→深拷贝 JSON(新 id)+ `copyWorkflowMedia` 到 public assets→写 `library/public-workflows/{id}.json`(`publishedBy/publishedAt/source:'user'`)。
- `GET /api/public-workflows`(改):合并列仓库同梱 `public/workflows/*` 与用户发布 `library/public-workflows/*`,带 `source`。
- `GET /api/public-workflows/:id`(改):两源任一读取。
- `POST /api/workflows/fork`(body `{publicId}`):读公共工作流→深拷贝 JSON(新 id、`ownerId=me`)+ `copyWorkflowMedia` 到 `library/users/{me}/wf-assets/{id}/`→写 `library/workflows/{id}.json`,返回新 id。
- `DELETE /api/public-workflows/:id`(改/新):**requireAdmin 行为**——这里直接在 index.js 用 `req.user.role==='admin'` 守卫;删用户发布的 JSON + 其 assets 目录;仓库同梱不可删。

### 前端
- `src/components/canvas/WorkflowPreview.tsx`(新):只读预览模态。自前简易渲染——固定节点卡尺寸(W=200,H=130),按 `node.x/node.y` 摆位于 fit-to-content 的本地 viewport;SVG 画 parent→child 贝塞尔连线(自绘,不复用 ConnectionsLayer 以保证几何一致);节点卡显示缩略图(`resultUrl`)+ 标题/类型。支持只读 pan/zoom。底部「复制到我的工作流并编辑」→ `fork` → 成功回调加载副本。
- `WorkflowPanel.tsx`(改):我的工作流卡片加「发布到公共」;公共 tab 点击→开 `WorkflowPreview`(不再 `onLoadWorkflow('public:')` 直灌画布);公共卡片去掉删除(管理员在后台删)。
- `useWorkflow.ts`:fork 后用返回的新 id 走普通 `handleLoadWorkflow(id)`。保留 `public:` 仅用于预览取数据(`GET /api/public-workflows/:id`)。

---

## 计划 4 — 管理员素材库管理页

### 后端(server/routes/admin.js,均 requireAdmin)
- `GET /api/admin/assets`:全表 assets.json + `ownerName`;筛选 `?userId&?category&?visibility&?q`;返回 `users`、分类集合。
- `POST /api/admin/assets/:id/visibility`(body `{visibility}`):管理员强制公开/下架任意素材。
- `DELETE /api/admin/assets/:id`:管理员删除;物理文件经引用护栏(被他人/公开引用则只删行)。
- `GET /api/admin/public-workflows`:列用户发布的公共工作流 + `ownerName`。
- `DELETE /api/admin/public-workflows/:id`:删 JSON + assets 目录。

> assets.json / public-workflows 在 LIBRARY 下,admin.js 经 `req.app.locals.LIBRARY_DIR` 取路径。

### 前端
- `src/components/admin/AssetAdmin.tsx`(新):复用 P3 `HistoryBrowser` 范式——筛选栏(用户/可见性/分类/搜索)+ 卡片网格;每项可切换公开/下架、删除;下方「公共工作流」小节(列出+删除)。
- `AdminConsole.tsx`:新增 tab「素材库」→ `AssetAdmin`。

---

## 验证 & 顺序
1. 后端计划3 五端点 → curl(发布/列表合并/fork 深拷贝[校验图片复制+节点 URL 重写]/管理员删除)。
2. 后端计划4 五端点 → curl(全表筛选/visibility/删除护栏/公共工作流列删)。
3. 前端 WorkflowPreview + WorkflowPanel + useWorkflow → tsc + Playwright(发布/预览/fork 加载)。
4. 前端 AssetAdmin + AdminConsole → tsc + Playwright(筛选/切公开/删除)。
每步独立提交。
