# 管理员端素材/工作流重命名 Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development. Steps use `- [ ]`.

**Goal:** 管理员后台对「全部历史」的图片/视频、「素材库」的素材、以及工作流支持**重命名**(重命名按钮 + 弹框)。仅管理员端。

**Architecture:** 后端在 `server/routes/admin.js` 加 3 个 rename 端点(改对应 JSON 的 title/name 字段);前端新增共享 `RenameModal`,在 `HistoryBrowser` / `AssetAdmin` 每项加「重命名」按钮 → 弹框 → 保存后 POST + 失效 SWR 缓存重拉。

**数据模型(已查证):**
- 历史项:`library/{type}/{id}.json`;`normalizeHistory` 中 images/videos/workflows/edit-projects 均优先读 `d.title` → 设 `.title` 即生效。前端每项带 `{id, type}`。
- 素材:`library/assets/assets.json` 数组,每行 `{id, name, ...}`(`readAssets/writeAssets` 已有;`visibility` 端点是改写模板)。列表按 `a.name` 显示/搜索。
- 公共工作流:`library/public-workflows/{id}.json`,列表读 `w.title`。

---

## Task 1: 后端 3 个 rename 端点(admin.js)
**Files:** Modify `server/routes/admin.js`

- [ ] **Step 1:** 在 `/assets/:id/visibility`(~334)附近加三个端点:
```js
// 重命名历史项(图/视频/工作流等):改 library/{type}/{id}.json 的 title
router.post('/history/:type/:id/rename', (req, res) => {
    try {
        const { type, id } = req.params;
        if (!HISTORY_TYPES[type]) return res.status(400).json({ error: '类型不支持' });
        const title = String(req.body?.title ?? '').trim().slice(0, 200);
        if (!title) return res.status(400).json({ error: '名称不能为空' });
        const fp = path.join(req.app.locals.LIBRARY_DIR, type, `${id}.json`);
        if (!fs.existsSync(fp)) return res.status(404).json({ error: '不存在' });
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        d.title = title;
        fs.writeFileSync(fp, JSON.stringify(d, null, 2));
        res.json({ success: true, title });
    } catch (e) { console.error('admin history rename error:', e); res.status(500).json({ error: e.message }); }
});

// 重命名素材库素材:改 assets.json 行的 name
router.post('/assets/:id/rename', (req, res) => {
    try {
        const name = String(req.body?.name ?? '').trim().slice(0, 200);
        if (!name) return res.status(400).json({ error: '名称不能为空' });
        const rows = readAssets(req);
        const asset = rows.find(a => a.id === req.params.id);
        if (!asset) return res.status(404).json({ error: 'Asset not found' });
        asset.name = name;
        writeAssets(req, rows);
        res.json({ success: true, asset });
    } catch (e) { console.error('admin asset rename error:', e); res.status(500).json({ error: e.message }); }
});

// 重命名公共工作流:改 library/public-workflows/{id}.json 的 title
router.post('/public-workflows/:id/rename', (req, res) => {
    try {
        const title = String(req.body?.title ?? '').trim().slice(0, 200);
        if (!title) return res.status(400).json({ error: '名称不能为空' });
        const fp = path.join(req.app.locals.LIBRARY_DIR, 'public-workflows', `${req.params.id}.json`);
        if (!fs.existsSync(fp)) return res.status(404).json({ error: '不存在' });
        const d = JSON.parse(fs.readFileSync(fp, 'utf8'));
        d.title = title;
        fs.writeFileSync(fp, JSON.stringify(d, null, 2));
        res.json({ success: true, title });
    } catch (e) { console.error('admin public-workflow rename error:', e); res.status(500).json({ error: e.message }); }
});
```
确认 `HISTORY_TYPES`、`readAssets`/`writeAssets`、`path`、`fs` 都在 admin.js 作用域内(已确认存在)。

- [ ] **Step 2:** `node --check server/routes/admin.js && echo ADMIN_OK`;import 冒烟。
- [ ] **Step 3:** commit `feat(admin): rename endpoints for history/assets/public-workflows`

---

## Task 2: 前端 RenameModal + 接入 HistoryBrowser / AssetAdmin
**Files:** Create `src/components/admin/RenameModal.tsx`; Modify `src/components/admin/HistoryBrowser.tsx`, `src/components/admin/AssetAdmin.tsx`

- [ ] **Step 1:** 新建 `src/components/admin/RenameModal.tsx`(受控弹框):
```tsx
import React, { useState, useEffect } from 'react';

export const RenameModal: React.FC<{
  open: boolean; initial: string; label?: string;
  onSave: (v: string) => Promise<void> | void; onClose: () => void;
}> = ({ open, initial, label = '名称', onSave, onClose }) => {
  const [v, setV] = useState(initial);
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) setV(initial); }, [open, initial]);
  if (!open) return null;
  const submit = async () => { if (!v.trim() || busy) return; setBusy(true); try { await onSave(v.trim()); onClose(); } finally { setBusy(false); } };
  return (
    <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }} onClick={onClose}>
      <div style={{ background: '#1e1e1e', color: '#eee', padding: 20, borderRadius: 12, width: 360, maxWidth: '90vw' }} onClick={e => e.stopPropagation()}>
        <div style={{ marginBottom: 10, fontWeight: 600 }}>重命名</div>
        <div style={{ fontSize: 12, opacity: .7, marginBottom: 6 }}>{label}</div>
        <input autoFocus value={v} onChange={e => setV(e.target.value)} onKeyDown={e => { if (e.key === 'Enter') submit(); }}
          style={{ width: '100%', padding: '8px 10px', borderRadius: 8, border: '1px solid #444', background: '#111', color: '#eee', boxSizing: 'border-box' }} />
        <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 16 }}>
          <button onClick={onClose} disabled={busy} style={{ padding: '6px 14px', borderRadius: 8, border: '1px solid #444', background: 'transparent', color: '#ccc', cursor: 'pointer' }}>取消</button>
          <button onClick={submit} disabled={busy || !v.trim()} style={{ padding: '6px 14px', borderRadius: 8, border: 'none', background: '#3b82f6', color: '#fff', cursor: 'pointer' }}>{busy ? '保存中…' : '确定'}</button>
        </div>
      </div>
    </div>
  );
};
```

- [ ] **Step 2: HistoryBrowser.tsx** — Read it. Add state `const [renameItem, setRenameItem] = useState<any|null>(null);`. On each history item card, add a「重命名」按钮(图标或文字),onClick `setRenameItem(item)`(用现有 `adminFetch` 助手 + `invalidateCache`,已 import)。在组件末尾渲染:
```tsx
<RenameModal open={!!renameItem} initial={renameItem?.title || ''} label="标题"
  onClose={() => setRenameItem(null)}
  onSave={async (title) => {
    await adminFetch(`/api/admin/history/${renameItem.type}/${renameItem.id}/rename`, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ title }) });
    invalidateCache('admin:history:'); refetchHist();
  }} />
```
import `RenameModal`(`./RenameModal`)。`refetchHist` 是 Task C 里 useSWR 的 refetch(已存在)。

- [ ] **Step 3: AssetAdmin.tsx** — Read it. 同法:素材项加「重命名」→ `POST /api/admin/assets/${a.id}/rename` body `{name}`,initial `a.name`,label「名称」,成功后 `invalidateCache('admin:assets:'); refetchAssets();`;公共工作流项加「重命名」→ `POST /api/admin/public-workflows/${w.id}/rename` body `{title}`,initial `w.title`,成功后 `invalidateCache('admin:public-workflows'); refetchPublic();`。用一个或两个 RenameModal 实例(可共用一个 + 一个 `renameTarget` 区分类型)。

- [ ] **Step 4:** `npx tsc --noEmit 2>&1 | grep -iE "RenameModal|HistoryBrowser|AssetAdmin" || echo RENAME_TS_OK`;commit。

---

## Task 3: 构建 + 部署 + 实测(controller)
- [ ] push → Windows pull → `npm run build` → 重启 → 浏览器:在全部历史/素材库/公共工作流点「重命名」→ 改名 → 立即生效(缓存失效重拉)。

## Self-Review
- 覆盖:历史图/视频(setTitle)、素材(setName)、公共工作流(setTitle)。chats/edit-projects 不在用户范围(edit-projects 也会因读 title fallback 而生效,无害)。
- 风险:rename 端点已 requireAdmin(admin 路由整体挂在 requireAdmin 下,沿用);输入 trim+截断 200 防滥用;失败 toast 由 adminFetch 抛错链路处理(沿用现有)。
