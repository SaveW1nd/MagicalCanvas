# 画布列表客户端缓存(stale-while-revalidate)Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax.

**Goal:** 历史(HistoryPanel)/素材库(AssetLibraryPanel)等列表视图改为客户端 stale-while-revalidate 缓存:再次点开**立即显示**上次缓存的内容,后台静默刷新,自己增删/发布/生成时主动失效。消除"每次点进去都等 ~6.6s 隧道 API"的卡顿。

**Architecture:** 新增一个零依赖的模块级缓存 + `useSWR` hook(内存 Map 即时命中 + localStorage 跨刷新持久 + 后台 revalidate)。把 HistoryPanel / AssetLibraryPanel 里 `useEffect` 内的原生 `fetch` 列表请求替换为该 hook;在增删/发布/生成成功处调用 `invalidate(key)`。**不引入 react-query 等大依赖**(项目当前无任何缓存库)。

**Tech Stack:** React + TS(Vite),无现成数据缓存库;运行/构建在 wincanvas(`E:\savewind\MagicalCanvas`,`vite build` → `dist`,生产 `node server/index.js` 服务 dist)。编辑在 Mac clone `~/Documents/github/MagicalCanvas`,改完 push → Windows pull + `npm run build` + 重启。

**环境/约束:** 无 JS 单测框架——验证用 `npx tsc --noEmit`(类型)+ `npm run build`(构建通过)+ 部署后浏览器实测(Network 面板看二次打开是否走缓存/不再卡)。控制面 API 走 CF 隧道约 6.6s;本缓存让"重复点开"不再付这 6.6s(首次仍需一次)。

---

## File Structure
- **新增** `src/utils/swrCache.ts` — 模块级 SWR 缓存 + `useSWR` hook + `invalidateCache(prefix)`(唯一新文件)
- **改** `src/components/HistoryPanel.tsx` — 列表/分页拉取改用 `useSWR`;删除/清空成功后 `invalidateCache('assets:')`
- **改** `src/components/AssetLibraryPanel.tsx` — `/api/library`、`/api/library/categories`、`/api/library/public` 拉取改用 `useSWR`;增删/分类/发布/导入成功后 `invalidateCache('library')`
- **改(可选)** `src/App.tsx` — 生成/保存素材成功处调用 `invalidateCache('assets:')` 与 `invalidateCache('library')`,保证新内容即时可见

---

## Task 1: SWR 缓存工具 + hook

**Files:** Create `src/utils/swrCache.ts`

- [ ] **Step 1: 写 `src/utils/swrCache.ts`**
```ts
import { useEffect, useRef, useState, useCallback } from 'react';

type Entry = { data: any; ts: number };
const mem = new Map<string, Entry>();
const LS_PREFIX = 'swr:';
const MAX_LS_BYTES = 1_000_000; // 单条超过则不写 localStorage,避免塞爆

function lsGet(key: string): Entry | undefined {
  try { const s = localStorage.getItem(LS_PREFIX + key); return s ? JSON.parse(s) as Entry : undefined; } catch { return undefined; }
}
function lsSet(key: string, entry: Entry) {
  try { const s = JSON.stringify(entry); if (s.length <= MAX_LS_BYTES) localStorage.setItem(LS_PREFIX + key, s); } catch { /* 配额满则忽略 */ }
}

export function getCached(key: string): any | undefined {
  if (mem.has(key)) return mem.get(key)!.data;
  const e = lsGet(key);
  if (e) { mem.set(key, e); return e.data; }
  return undefined;
}
export function setCached(key: string, data: any) {
  const entry = { data, ts: Date.now() };
  mem.set(key, entry);
  lsSet(key, entry);
}
/** 失效所有以 prefix 开头的缓存键(内存 + localStorage)。 */
export function invalidateCache(prefix: string) {
  for (const k of Array.from(mem.keys())) if (k.startsWith(prefix)) mem.delete(k);
  try {
    for (let i = localStorage.length - 1; i >= 0; i--) {
      const full = localStorage.key(i);
      if (full && full.startsWith(LS_PREFIX + prefix)) localStorage.removeItem(full);
    }
  } catch { /* ignore */ }
}

/**
 * stale-while-revalidate:命中缓存立即返回(loading=false),同时后台 fetcher 刷新;
 * 无缓存则 loading=true 直到首次拉到。key 变化会重新评估。
 */
export function useSWR<T = any>(key: string | null, fetcher: () => Promise<T>) {
  const [data, setData] = useState<T | undefined>(() => (key ? getCached(key) : undefined));
  const [loading, setLoading] = useState<boolean>(() => (key ? getCached(key) === undefined : false));
  const fetcherRef = useRef(fetcher); fetcherRef.current = fetcher;

  const revalidate = useCallback(async () => {
    if (!key) return;
    try {
      const fresh = await fetcherRef.current();
      setCached(key, fresh);
      setData(fresh);
    } catch (e) {
      // 刷新失败保留旧缓存,不清空
      console.warn('[swr] revalidate failed for', key, e);
    } finally {
      setLoading(false);
    }
  }, [key]);

  useEffect(() => {
    if (!key) { setData(undefined); setLoading(false); return; }
    const cached = getCached(key);
    if (cached !== undefined) { setData(cached); setLoading(false); } else { setLoading(true); }
    revalidate(); // 总是后台刷新
  }, [key, revalidate]);

  return { data, loading, refetch: revalidate };
}
```

- [ ] **Step 2: 类型检查**
Run: `cd /Users/savewind/Documents/github/MagicalCanvas && npx tsc --noEmit -p tsconfig.json 2>&1 | grep -i "swrCache" || echo SWR_TS_OK`
Expected: `SWR_TS_OK`(swrCache.ts 无类型错误)。

- [ ] **Step 3: 提交**
`git add src/utils/swrCache.ts && git commit -m "feat(cache): add stale-while-revalidate cache util + useSWR hook"`

---

## Task 2: HistoryPanel 用 useSWR

**Files:** Modify `src/components/HistoryPanel.tsx`

- [ ] **Step 1: 读文件,定位三处**
Read `src/components/HistoryPanel.tsx`。关键:
- 计数预取 `/api/assets/images?limit=1` `/api/assets/videos?limit=1`(~158-159)
- 主列表分页 `/api/assets/${activeTab}?limit=${PAGE_SIZE}&offset=${pageOffset}`(~208,在某 `useEffect`/loader 里 setState)
- 删除 `/api/assets/${activeTab}/${id}`(~248)、清空 `/api/assets/${activeTab}/clean`(~270)

- [ ] **Step 2: 主列表改用 useSWR(按 tab+offset 作 key)**
把"加载当前 tab 当前页"的 `useEffect`+`fetch`+`setItems` 改为:
```ts
import { useSWR, invalidateCache } from '../utils/swrCache';
// ...
const listKey = `assets:${activeTab}:${pageOffset}`;
const { data: pageData, loading, refetch } = useSWR(listKey, () =>
  fetch(`/api/assets/${activeTab}?limit=${PAGE_SIZE}&offset=${pageOffset}`).then(r => r.json())
);
// 用 pageData 渲染(替换原 items state 来源);保留原有对 pageData 结构的处理(如 {items,total})。
```
> 适配:若原代码把多页累加进一个 items 数组(无限滚动),改为按 offset 分页缓存、渲染时合并已加载页(用一个 `loadedOffsets` 列表 + 各页 `getCached`),或保持原累加逻辑但每页结果来自 useSWR 命中。**以实际代码结构为准**,核心是"每页结果走缓存,重开即时显示首页"。报告你的适配方式。

- [ ] **Step 3: 删除/清空后失效缓存**
在删除成功(~248 之后)与清空成功(~270 之后)处加:
```ts
invalidateCache('assets:');
refetch();
```

- [ ] **Step 4: 验证 + 提交**
`npx tsc --noEmit 2>&1 | grep -i HistoryPanel || echo HP_TS_OK`;预期 `HP_TS_OK`。
`git add src/components/HistoryPanel.tsx && git commit -m "feat(cache): HistoryPanel uses SWR cache (instant re-open + invalidate on delete/clean)"`

---

## Task 3: AssetLibraryPanel 用 useSWR

**Files:** Modify `src/components/AssetLibraryPanel.tsx`

- [ ] **Step 1: 读文件**,定位:`/api/library`(~74)、`/api/library/categories`(~87)、`/api/library/public`(~64);以及增删/分类/发布/导入(~144/169/187/200/215/227)。

- [ ] **Step 2: 三个列表拉取改用 useSWR**
```ts
import { useSWR, invalidateCache } from '../utils/swrCache';
const { data: libraryData, refetch: refetchLib } = useSWR('library:mine', () => fetch('/api/library').then(r => r.json()));
const { data: categories } = useSWR('library:categories', () => fetch('/api/library/categories').then(r => r.json()));
const { data: publicData, refetch: refetchPublic } = useSWR('library:public', () => fetch('/api/library/public').then(r => r.json()));
```
用这些 data 替换原 state 来源;保留原渲染对数据结构的处理。

- [ ] **Step 3: 变更后失效**
在每个写操作(上传 ~144、删除 ~169/187、改分类 ~200、发布 ~215、从公共导入 ~227、增删分类 ~98/113)成功分支后加:
```ts
invalidateCache('library'); refetchLib();
```
(发布/公共相关再加 `refetchPublic()`。)

- [ ] **Step 4: 验证 + 提交**
`npx tsc --noEmit 2>&1 | grep -i AssetLibraryPanel || echo ALP_TS_OK`;预期 `ALP_TS_OK`。
`git add src/components/AssetLibraryPanel.tsx && git commit -m "feat(cache): AssetLibraryPanel uses SWR cache + invalidate on mutations"`

---

## Task 4: 生成/保存后失效(可选但推荐,保证新内容即时可见)

**Files:** Modify `src/App.tsx`(或 `useGeneration.ts` 成功回调处)

- [ ] **Step 1:** 在图片/视频生成成功(写入历史/库)后、以及手动保存素材成功后,调用:
```ts
import { invalidateCache } from './utils/swrCache';
invalidateCache('assets:'); invalidateCache('library');
```
找最贴近"生成成功后更新画布/历史"的位置(useGeneration 的 SUCCESS 分支或 App 的对应 handler)。报告落点。

- [ ] **Step 2: 验证 + 提交**
`npx tsc --noEmit 2>&1 | grep -iE "App.tsx|useGeneration" || echo APP_TS_OK`;预期 `APP_TS_OK`。
`git add -A && git commit -m "feat(cache): invalidate list caches after generation/save"`

---

## Task 5: 构建 + 部署 + 实测(controller 执行)

- [ ] **Step 1:** Mac push 分支 → Windows `git pull` → `npm run build` → 重启 MagicalCanvas 任务(同 OSS 部署流程)。三处同步。
- [ ] **Step 2: 浏览器实测**(开 DevTools Network):
  - 打开历史/素材库 → 关闭 → **再次打开**:列表**立即显示**(无 ~6.6s 等待),后台有一次 revalidate 请求(可见但不阻塞 UI)。
  - 删除/发布/生成一张 → 列表即时反映(缓存已失效重拉)。
  - 刷新整个页面 → 再开历史/素材库:仍**立即显示**(localStorage 命中),后台刷新。

---

## Self-Review
- **覆盖**:历史(T2)、素材库(T3)、新内容即时可见(T4)、工具(T1)、部署实测(T5)。"管理员端看素材"——若是同 `/api/assets`/`/api/library`,自动受益;若有独立 admin 面板组件,按 T2/T3 同法补一个任务(执行时确认 admin 面板文件名)。
- **占位符**:工具与 hook 给了完整代码;面板改动因需贴合现有结构,给了精确锚点 + 改法 + "报告适配方式"要求。
- **风险**:① 缓存导致他人新增的内容延迟可见——可接受(后台 revalidate 秒级补上;自己的写操作主动失效即时);② localStorage 配额——超 1MB 单条不写,只走内存;③ 分页/无限滚动的合并逻辑需贴合 HistoryPanel 实际结构(T2 Step2 已标注按实际适配并报告)。
- **类型一致**:`useSWR(key,fetcher)→{data,loading,refetch}`、`invalidateCache(prefix)`、`getCached/setCached` 在 T1 定义,T2-T4 一致引用。
