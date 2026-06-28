# 用户积分系统 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 给 MagicalCanvas 增加面向用户的积分计费——按模型+参数扣费、成功才扣、管理员发放、完整流水、后台可配价格，带总开关默认关。

**Architecture:** 计价/扣费集中在 `server/services/billing.js`；余额存 `users.balance`、价格存 `models.pricing`(JSON)、流水存新表 `credit_ledger`，单位统一为「百分单位整数」(1 积分=100)。生成路由发起前预检、成功后扣费。前端顶栏显示余额、402 提示积分不足。

**Tech Stack:** Express + better-sqlite3(ESM)、React+TS+Vite、vitest(仅给计价纯逻辑做单测，新引入)。

**约定（所有任务共用）**
- **单位**：DB/计算用「百分单位整数」(units)，1 积分 = 100 units。`toUnits(c)=Math.round(c*100)`，`toCredits(u)=u/100`。
- **类别(category)**：`'image' | 'video' | 'vision' | 'text'`（与 registry 现有 `models.category` 一致）。
- **价格写法**：`models.pricing` 和 `default_price` 里的数字都是**积分**（可带小数），计算时转 units。

---

## File Structure

**新建**
- `server/services/billing.js` — 计价 + 扣费/发放/预检/豁免（核心）。
- `server/services/billing.test.js` — vitest 单测（计价纯逻辑）。
- `server/routes/credits.js` — 用户态接口：余额、本人流水。
- `vitest.config.js` — 最小 vitest 配置（只测 `server/**/*.test.js`）。

**修改**
- `server/db/index.js` — `users.balance` 列 + 迁移；`credit_ledger` 表 + 仓库函数；余额读写函数。
- `server/db/registry.js` — `models.pricing` 列 + 迁移；create/update/rowToModel 带 pricing；allowed 加 pricing。
- `server/routes/generation.js` — image/video 预检 + 成功后扣费。
- `server/index.js` — vision-describe、text(chat/optimize) 预检 + 扣费；挂载 credits 路由。
- `server/routes/admin.js` — 发放积分、流水查询、billing 配置接口。
- `src/services/generationService.ts` — 402 → 抛 `InsufficientCreditsError`。
- `src/contexts/AuthContext.tsx` — user 带 balance + `refreshUser()`。
- `src/components/TopBar.tsx` — 显示余额。
- `src/components/admin/UserManagement.tsx` — 余额列 + 发放弹框。
- `src/components/admin/ModelConfig.tsx` / `ModelModal.tsx` — 价格编辑器。
- `src/components/admin/AdminConsole.tsx` — billing 设置 + 流水页签。

---

## Phase 1 — 数据模型 + 计价核心

### Task 1: vitest 脚手架

**Files:**
- Create: `vitest.config.js`
- Modify: `package.json`（scripts 加 `test`）

- [ ] **Step 1: 安装 vitest（devDependency）**

Run: `npm i -D vitest`
Expected: 安装成功，`package.json` devDependencies 出现 `vitest`。

- [ ] **Step 2: 写 vitest.config.js**

```js
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['server/**/*.test.js'],
    environment: 'node',
  },
});
```

- [ ] **Step 3: package.json 加 test 脚本**

在 `"scripts"` 内加一行：
```json
"test": "vitest run",
```

- [ ] **Step 4: 验证 vitest 能跑（暂无用例）**

Run: `npx vitest run`
Expected: `No test files found` 或 0 失败（命令退出码 0/1 均可，关键是 vitest 可执行）。

- [ ] **Step 5: Commit**

```bash
git add package.json vitest.config.js package-lock.json
git commit -m "chore: add vitest for billing unit tests"
```

---

### Task 2: 计价纯逻辑 `computePrice` + 单位换算（TDD）

**Files:**
- Create: `server/services/billing.js`
- Test: `server/services/billing.test.js`

- [ ] **Step 1: 写失败测试**

`server/services/billing.test.js`:
```js
import { describe, it, expect } from 'vitest';
import { toUnits, toCredits, computePrice } from './billing.js';

describe('units', () => {
  it('转换无浮点漂移', () => {
    expect(toUnits(2.5)).toBe(250);
    expect(toUnits(0.1)).toBe(10);
    expect(toCredits(250)).toBe(2.5);
  });
});

describe('computePrice (单位=units)', () => {
  const defaults = { image: 2, video: 20, vision: 0.5, text: 0.2 };

  it('图片：base × 分辨率系数', () => {
    const m = { category: 'image', pricing: { base: 2.5, byResolution: { '1k': 1, '2k': 2, '4k': 4 } } };
    expect(computePrice(m, 'image', { resolution: '4k' }, defaults)).toBe(1000); // 2.5*4*100
    expect(computePrice(m, 'image', { resolution: '1k' }, defaults)).toBe(250);
    expect(computePrice(m, 'image', {}, defaults)).toBe(250); // 无分辨率→系数1
  });

  it('视频：base × 时长 × 档位', () => {
    const m = { category: 'video', pricing: { base: 10, byDuration: { '10s': 2 }, byTier: { quality: 4 } } };
    expect(computePrice(m, 'video', { duration: 10, tier: 'quality' }, defaults)).toBe(8000); // 10*2*4*100
  });

  it('视觉/文字：只用 base', () => {
    const m = { category: 'vision', pricing: { base: 0.5 } };
    expect(computePrice(m, 'vision', {}, defaults)).toBe(50);
  });

  it('无 pricing → 用类别兜底价', () => {
    const m = { category: 'image', pricing: {} };
    expect(computePrice(m, 'image', { resolution: '4k' }, defaults)).toBe(200); // 兜底2，无系数→2*100
  });

  it('兜底也没有 → 0(免费)', () => {
    const m = { category: 'image', pricing: {} };
    expect(computePrice(m, 'image', {}, {})).toBe(0);
  });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/services/billing.test.js`
Expected: FAIL（`billing.js` 还没导出这些函数）。

- [ ] **Step 3: 写 `server/services/billing.js`（先只放纯逻辑）**

```js
/**
 * billing.js — 积分计价与扣费。单位统一为「百分单位整数」(units)，1 积分 = 100 units。
 */

export function toUnits(credits) { return Math.round(Number(credits || 0) * 100); }
export function toCredits(units) { return Math.round(Number(units || 0)) / 100; }

/** 视频时长(秒)→ byDuration 的键，如 10 → "10s"。 */
function durationKey(d) { return `${parseInt(d, 10)}s`; }

/**
 * 计算一次生成的价格（返回 units 整数）。
 * @param model    registry 模型对象（含 category 与 pricing）
 * @param category 'image'|'video'|'vision'|'text'
 * @param params   { resolution?, duration?, tier? }
 * @param defaults 类别兜底价 { image, video, vision, text }（积分）
 */
export function computePrice(model, category, params = {}, defaults = {}) {
  const pricing = (model && model.pricing) || {};
  let baseCredits = typeof pricing.base === 'number' ? pricing.base
    : (typeof defaults[category] === 'number' ? defaults[category] : 0);

  let mult = 1;
  if (category === 'image' && params.resolution && pricing.byResolution) {
    mult *= pricing.byResolution[String(params.resolution).toLowerCase()] ?? 1;
  }
  if (category === 'video') {
    if (params.duration != null && pricing.byDuration) mult *= pricing.byDuration[durationKey(params.duration)] ?? 1;
    if (params.tier && pricing.byTier) mult *= pricing.byTier[params.tier] ?? 1;
  }
  return Math.round(baseCredits * mult * 100);
}
```

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/services/billing.test.js`
Expected: PASS（所有用例绿）。

- [ ] **Step 5: Commit**

```bash
git add server/services/billing.js server/services/billing.test.js
git commit -m "feat(billing): computePrice + units helpers (TDD)"
```

---

### Task 3: DB —— users.balance、credit_ledger、余额仓库函数

**Files:**
- Modify: `server/db/index.js`

- [ ] **Step 1: 建表/迁移（在现有 `db.exec(...)` 建表块之后追加）**

在 `server/db/index.js` 现有 `CREATE TABLE ... token_denylist` 的 `db.exec(\`...\`)` 之后，新增一段：
```js
// --- 积分系统：users.balance 迁移 + 流水表 ---
const _userCols = db.prepare(`PRAGMA table_info(users)`).all();
if (!_userCols.some(c => c.name === 'balance')) {
  db.exec(`ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0`); // 百分单位
}
db.exec(`
  CREATE TABLE IF NOT EXISTS credit_ledger (
    id           TEXT PRIMARY KEY,
    userId       TEXT NOT NULL,
    delta        INTEGER NOT NULL,
    balanceAfter INTEGER NOT NULL,
    type         TEXT NOT NULL,
    category     TEXT,
    modelId      TEXT,
    params       TEXT,
    refId        TEXT,
    note         TEXT,
    operatorId   TEXT,
    createdAt    TEXT NOT NULL
  );
  CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(userId, createdAt);
`);
```

- [ ] **Step 2: 加余额读写 + 流水仓库函数（在 users repo 区域末尾追加并 export）**

```js
// --- 积分余额（units = 百分单位整数）---
const _getBalance = db.prepare('SELECT balance FROM users WHERE id = ?');
export function getUserBalanceUnits(id) { const r = _getBalance.get(id); return r ? r.balance : 0; }

const _addBalance = db.prepare('UPDATE users SET balance = balance + ?, updatedAt = ? WHERE id = ?');
const _setBalance = db.prepare('UPDATE users SET balance = ?, updatedAt = ? WHERE id = ?');
/** 增量改余额（正=加，负=扣），返回改后余额。 */
export function addUserBalanceUnits(id, deltaUnits) {
  _addBalance.run(deltaUnits, new Date().toISOString(), id);
  return getUserBalanceUnits(id);
}
export function setUserBalanceUnits(id, units) {
  _setBalance.run(units, new Date().toISOString(), id);
  return units;
}

// --- 流水 ---
const _insLedger = db.prepare(`
  INSERT INTO credit_ledger(id, userId, delta, balanceAfter, type, category, modelId, params, refId, note, operatorId, createdAt)
  VALUES(@id, @userId, @delta, @balanceAfter, @type, @category, @modelId, @params, @refId, @note, @operatorId, @createdAt)
`);
export function insertLedger(row) {
  _insLedger.run({
    id: crypto.randomUUID(),
    category: null, modelId: null, params: null, refId: null, note: null, operatorId: null,
    ...row,
    createdAt: new Date().toISOString(),
  });
}
export function listLedger({ userId, type, limit = 50, offset = 0 } = {}) {
  const where = [], args = [];
  if (userId) { where.push('userId = ?'); args.push(userId); }
  if (type) { where.push('type = ?'); args.push(type); }
  const sql = `SELECT * FROM credit_ledger ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY createdAt DESC LIMIT ? OFFSET ?`;
  return db.prepare(sql).all(...args, limit, offset);
}
```

> `crypto` 已在文件顶部 `import` 用于 jwt secret；若未导入，在文件头加 `import crypto from 'crypto';`。

- [ ] **Step 3: 确认 `publicUser` 会带出 balance（无需改）**

`publicUser` 做 `const { passwordHash, ...rest } = u; return rest;` —— `balance` 自动包含。无需改动；记录确认即可。

- [ ] **Step 4: 启动服务器验证迁移不报错**

Run: `npm run server`（本地，需本地有 config）
Expected: 日志正常打印 `Backend server running on http://localhost:3501`，无 `no such column / no such table`。Ctrl+C 退出。

- [ ] **Step 5: Commit**

```bash
git add server/db/index.js
git commit -m "feat(db): users.balance + credit_ledger + balance/ledger repos"
```

---

### Task 4: registry —— models.pricing 列与读写

**Files:**
- Modify: `server/db/registry.js`

- [ ] **Step 1: 建表/迁移（在现有 `db.exec` 建表块后追加）**

```js
const _modelCols = db.prepare(`PRAGMA table_info(models)`).all();
if (!_modelCols.some(c => c.name === 'pricing')) {
  db.exec(`ALTER TABLE models ADD COLUMN pricing TEXT NOT NULL DEFAULT '{}'`);
}
```

- [ ] **Step 2: rowToModel 解析 pricing**

在 `rowToModel` 内 `caps` 解析旁，新增 pricing 解析并加入返回对象：
```js
let pricing = {};
try { pricing = JSON.parse(r.pricing || '{}'); } catch { pricing = {}; }
```
返回对象里加 `pricing,`（与 `capabilities` 并列）。

- [ ] **Step 3: createModel 支持 pricing**

`createModel({ ... , capabilities = {}, sortOrder = 0 })` 形参加 `pricing = {}`；INSERT 列加 `pricing`，VALUES 传 `JSON.stringify(pricing)`。同步把 `INSERT INTO models(...)` 列清单补上 `pricing`。

- [ ] **Step 4: updateModel 允许 pricing**

`updateModel` 的 `const allowed = [...]` 数组追加 `'pricing'`；并在赋值循环里：若字段是 `pricing` 且为对象，则 `JSON.stringify` 后再写。示例：
```js
const allowed = ['modelId', 'label', 'category', 'providerId', 'enabled', 'isDefault', 'sortOrder', 'pricing'];
// ...组装时：
const val = (k === 'pricing' && typeof fields[k] === 'object') ? JSON.stringify(fields[k]) : fields[k];
```

- [ ] **Step 5: 验证**

Run: `npm run server`
Expected: 启动无报错；`models` 表有 `pricing` 列（可选 `sqlite3` 检查，或靠后续接口验证）。Ctrl+C。

- [ ] **Step 6: Commit**

```bash
git add server/db/registry.js
git commit -m "feat(registry): models.pricing column + create/update/rowToModel"
```

---

## Phase 2 — 后端扣费集成

### Task 5: billing 服务的 DB 部分（quote/charge/grant/isExempt）

**Files:**
- Modify: `server/services/billing.js`
- Modify: `server/services/billing.test.js`（补 isExempt 纯逻辑测试）

- [ ] **Step 1: 给 isExempt 补失败测试**

在 `billing.test.js` 末尾追加：
```js
import { isExempt } from './billing.js';
describe('isExempt', () => {
  it('总开关关 → 豁免', () => { expect(isExempt({ role: 'user' }, false)).toBe(true); });
  it('开关开 + 普通用户 → 不豁免', () => { expect(isExempt({ role: 'user' }, true)).toBe(false); });
  it('开关开 + 管理员 → 豁免', () => { expect(isExempt({ role: 'admin' }, true)).toBe(true); });
});
```

- [ ] **Step 2: 跑测试确认失败**

Run: `npx vitest run server/services/billing.test.js`
Expected: FAIL（`isExempt` 未导出）。

- [ ] **Step 3: 在 billing.js 追加 DB 相关逻辑**

```js
import {
  getMeta, setMeta,
  getUserBalanceUnits, addUserBalanceUnits, setUserBalanceUnits, insertLedger,
} from '../db/index.js';
import { resolveModel } from '../db/registry.js';

const DEFAULT_PRICES = { image: 0, video: 0, vision: 0, text: 0 };

export function isBillingEnabled() { return getMeta('billing_enabled') === '1'; }
export function getDefaultPrices() {
  try { return { ...DEFAULT_PRICES, ...JSON.parse(getMeta('default_price') || '{}') }; }
  catch { return { ...DEFAULT_PRICES }; }
}
export function setBillingConfig({ enabled, defaultPrice }) {
  if (enabled != null) setMeta('billing_enabled', enabled ? '1' : '0');
  if (defaultPrice && typeof defaultPrice === 'object') setMeta('default_price', JSON.stringify(defaultPrice));
}

/** 纯逻辑版 isExempt 便于测试：传入 enabled 显式控制。 */
export function isExempt(user, enabled = isBillingEnabled()) {
  return !enabled || user?.role === 'admin';
}

/** 预检：返回 { priceUnits, balanceUnits, ok }。 */
export function quote(user, category, modelId, params = {}) {
  const model = resolveModel(category, modelId)?.model || null;
  const priceUnits = computePrice(model, category, params, getDefaultPrices());
  const balanceUnits = getUserBalanceUnits(user.id);
  return { priceUnits, balanceUnits, ok: balanceUnits >= priceUnits };
}

/** 成功后扣费 + 写流水。返回 { priceUnits, balanceAfter }。 */
export function charge(user, { category, modelId, params = {}, refId = null }) {
  const model = resolveModel(category, modelId)?.model || null;
  const priceUnits = computePrice(model, category, params, getDefaultPrices());
  const balanceAfter = addUserBalanceUnits(user.id, -priceUnits);
  insertLedger({
    userId: user.id, delta: -priceUnits, balanceAfter, type: 'charge',
    category, modelId: modelId || null, params: JSON.stringify(params || {}), refId,
  });
  return { priceUnits, balanceAfter };
}

/** 管理员发放/扣减/设置。mode: 'grant'|'deduct'|'set'。amountCredits 为积分。 */
export function grant(userId, amountCredits, operatorId, note, mode = 'grant') {
  const amt = toUnits(amountCredits);
  let balanceAfter, delta;
  if (mode === 'set') {
    const before = getUserBalanceUnits(userId);
    balanceAfter = setUserBalanceUnits(userId, amt);
    delta = amt - before;
  } else {
    delta = mode === 'deduct' ? -amt : amt;
    balanceAfter = addUserBalanceUnits(userId, delta);
  }
  insertLedger({
    userId, delta, balanceAfter, type: mode === 'set' ? 'adjust' : (mode === 'deduct' ? 'adjust' : 'grant'),
    note: note || null, operatorId: operatorId || null,
  });
  return { balanceAfter };
}
```

> `resolveModel(category, modelId)` 现有返回 `{ model, provider }`（见 generation.js pickEndpoint 用法）。

- [ ] **Step 4: 跑测试确认通过**

Run: `npx vitest run server/services/billing.test.js`
Expected: PASS（含新 isExempt 用例）。

- [ ] **Step 5: Commit**

```bash
git add server/services/billing.js server/services/billing.test.js
git commit -m "feat(billing): quote/charge/grant/config + isExempt"
```

---

### Task 6: 图片/视频生成接入扣费

**Files:**
- Modify: `server/routes/generation.js`

- [ ] **Step 1: 导入 billing**

`server/routes/generation.js` 顶部 import 区追加：
```js
import { isExempt, quote, charge } from '../services/billing.js';
```

- [ ] **Step 2: 图片——发起前预检**

在 `/generate-image` handler 内、解出 `effectiveImageModel` 之后、真正调用生成之前，加：
```js
// 积分预检（管理员/总开关关 → 豁免）
if (!isExempt(req.user)) {
  const q = quote(req.user, 'image', imageModel, { resolution });
  if (!q.ok) {
    return res.status(402).json({ error: '积分不足', balance: q.balanceUnits / 100, price: q.priceUnits / 100 });
  }
}
```

- [ ] **Step 3: 图片——成功后扣费**

在写完元数据、`return res.json({ resultUrl });` 之前加：
```js
if (!isExempt(req.user)) {
  try { charge(req.user, { category: 'image', modelId: imageModel, params: { resolution }, refId: nodeId || saved.id }); }
  catch (e) { console.error('[billing] charge image failed:', e.message); }
}
```

- [ ] **Step 4: 视频——预检 + 扣费（同理）**

`/generate-video` handler：解出模型后、生成前加预检（参数 `{ duration, tier: videoModel }`）：
```js
if (!isExempt(req.user)) {
  const q = quote(req.user, 'video', videoModel, { duration, tier: videoModel });
  if (!q.ok) return res.status(402).json({ error: '积分不足', balance: q.balanceUnits / 100, price: q.priceUnits / 100 });
}
```
`return res.json({ resultUrl });` 前加：
```js
if (!isExempt(req.user)) {
  try { charge(req.user, { category: 'video', modelId: videoModel, params: { duration, tier: videoModel }, refId: nodeId || saved.id }); }
  catch (e) { console.error('[billing] charge video failed:', e.message); }
}
```

- [ ] **Step 5: 手动验证（本地起服务 + curl）**

```bash
# 起服务
npm run server &
# 登录拿 token（admin 账号会被豁免，这里用普通用户验证扣费；若只有 admin，先在后台/DB 造一个普通用户）
TOKEN=$(curl -s -XPOST localhost:3501/api/auth/login -H 'Content-Type: application/json' -d '{"username":"user001","password":"12345678"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
# 开启计费 + 给该用户发放积分（用 Task 8 的 admin 接口或临时直接置 meta；此步可在 Task 8 完成后回归）
```
Expected（开关开 + 余额不足时）：`/api/generate-image` 返回 HTTP 402 `{"error":"积分不足",...}`，且不生成。余额足够时正常返回 `resultUrl`，余额减少。
> 注：完整闭环验证依赖 Task 8 的发放接口；本任务先确认 402 拦截与 import 不报错（开关开、余额 0 时图片请求应 402）。

- [ ] **Step 6: Commit**

```bash
git add server/routes/generation.js
git commit -m "feat(billing): charge image/video generation (precheck + on-success)"
```

---

### Task 7: 视觉(看图)/文字 接入扣费

**Files:**
- Modify: `server/index.js`

- [ ] **Step 1: 导入 billing**

`server/index.js` 顶部 import 区追加：
```js
import { isExempt, quote, charge } from './services/billing.js';
```

- [ ] **Step 2: 看图(DescribeV2)预检 + 扣费**

在 DescribeV2 handler 内，确定使用视觉模型(`getKey('VISION_MODEL')`)后、调用 `gpt2apiChatComplete` 之前加预检；成功拿到 `text` 之后、返回前扣费：
```js
const visionModelId = getKey('VISION_MODEL');
if (!isExempt(req.user)) {
  const q = quote(req.user, 'vision', visionModelId, {});
  if (!q.ok) return res.status(402).json({ error: '积分不足', balance: q.balanceUnits / 100, price: q.priceUnits / 100 });
}
// ... 调 gpt2apiChatComplete 得到 text 之后、res.json 之前：
if (!isExempt(req.user)) {
  try { charge(req.user, { category: 'vision', modelId: visionModelId, params: {}, refId: null }); }
  catch (e) { console.error('[billing] charge vision failed:', e.message); }
}
```

- [ ] **Step 3: 文字(chat/optimize)预检 + 扣费**

定位文字对话/提示词优化的 handler（调用文字模型 `getKey('TEXT_MODEL')` 处）。在调用前预检、成功后扣费，`category: 'text'`，`modelId: getKey('TEXT_MODEL')`，`params: {}`。代码形态同 Step 2（把 `'vision'`/`VISION_MODEL` 换成 `'text'`/`TEXT_MODEL`）。
> 若文字入口有多个（聊天 + 优化），每个入口都加同样两段。

- [ ] **Step 4: 验证**

Run: `npm run server`，开关开、余额 0 时调用看图识别接口 → HTTP 402。Ctrl+C。
Expected: 402 拦截；import 不报错。

- [ ] **Step 5: Commit**

```bash
git add server/index.js
git commit -m "feat(billing): charge vision describe + text chat/optimize"
```

---

### Task 8: 用户态 credits 路由 + 管理员 credits/流水/配置接口

**Files:**
- Create: `server/routes/credits.js`
- Modify: `server/index.js`（挂载）
- Modify: `server/routes/admin.js`

- [ ] **Step 1: 写 credits 路由**

`server/routes/credits.js`:
```js
import express from 'express';
import { requireAuth } from '../auth/middleware.js';
import { getUserBalanceUnits, listLedger } from '../db/index.js';

const router = express.Router();
router.use(requireAuth);

router.get('/balance', (req, res) => {
  res.json({ balance: getUserBalanceUnits(req.user.id) / 100 });
});

router.get('/ledger', (req, res) => {
  const limit = parseInt(req.query.limit) || 50;
  const offset = parseInt(req.query.offset) || 0;
  const rows = listLedger({ userId: req.user.id, limit, offset })
    .map(r => ({ ...r, amount: r.delta / 100, balanceAfter: r.balanceAfter / 100 }));
  res.json(rows);
});

export default router;
```

- [ ] **Step 2: 挂载（server/index.js）**

在其它 `app.use('/api/...')` 旁加：
```js
import creditsRoutes from './routes/credits.js';
app.use('/api/credits', creditsRoutes);
```
> 须在全局 `/api` requireAuth 中间件之后（本身也 requireAuth，幂等无碍）。

- [ ] **Step 3: admin —— 发放积分**

`server/routes/admin.js` 顶部 import：`import { grant } from '../services/billing.js';`，并在 users 区加：
```js
router.post('/users/:id/credits', (req, res) => {
  const { amount, mode = 'grant', note } = req.body || {};
  if (typeof amount !== 'number' || amount < 0) return res.status(400).json({ error: 'amount 非法' });
  if (!['grant', 'deduct', 'set'].includes(mode)) return res.status(400).json({ error: 'mode 非法' });
  const { balanceAfter } = grant(req.params.id, amount, req.user.id, note, mode);
  res.json({ success: true, balance: balanceAfter / 100 });
});
```

- [ ] **Step 4: admin —— 流水查询**

`import { listLedger } from '../db/index.js';`，加：
```js
router.get('/ledger', (req, res) => {
  const { userId, type } = req.query;
  const limit = parseInt(req.query.limit) || 100;
  const offset = parseInt(req.query.offset) || 0;
  const rows = listLedger({ userId, type, limit, offset })
    .map(r => ({ ...r, amount: r.delta / 100, balanceAfter: r.balanceAfter / 100 }));
  res.json(rows);
});
```

- [ ] **Step 5: admin —— billing 配置**

`import { isBillingEnabled, getDefaultPrices, setBillingConfig } from '../services/billing.js';`，加：
```js
router.get('/billing-config', (_req, res) => {
  res.json({ enabled: isBillingEnabled(), defaultPrice: getDefaultPrices() });
});
router.post('/billing-config', (req, res) => {
  const { enabled, defaultPrice } = req.body || {};
  setBillingConfig({ enabled, defaultPrice });
  res.json({ success: true, enabled: isBillingEnabled(), defaultPrice: getDefaultPrices() });
});
```

- [ ] **Step 6: 端到端手动验证（curl）**

```bash
npm run server &
ADMIN=$(curl -s -XPOST localhost:3501/api/auth/login -H 'Content-Type: application/json' -d '{"username":"admin","password":"admin12345"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
# 开启计费 + 设兜底价
curl -s -XPOST localhost:3501/api/admin/billing-config -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"enabled":true,"defaultPrice":{"image":2,"video":20,"vision":0.5,"text":0.2}}'
# 给 user001 发 100 积分
UID=$(curl -s localhost:3501/api/admin/users -H "Authorization: Bearer $ADMIN" | python3 -c 'import sys,json;print([u["id"] for u in json.load(sys.stdin) if u["username"]=="user001"][0])')
curl -s -XPOST localhost:3501/api/admin/users/$UID/credits -H "Authorization: Bearer $ADMIN" -H 'Content-Type: application/json' -d '{"amount":100,"mode":"grant","note":"测试发放"}'
# 用户查余额
USER=$(curl -s -XPOST localhost:3501/api/auth/login -H 'Content-Type: application/json' -d '{"username":"user001","password":"12345678"}' | python3 -c 'import sys,json;print(json.load(sys.stdin)["token"])')
curl -s localhost:3501/api/credits/balance -H "Authorization: Bearer $USER"
```
Expected: 余额接口返回 `{"balance":100}`；流水接口能看到该笔 grant；关闭计费后生成不扣。

- [ ] **Step 7: Commit**

```bash
git add server/routes/credits.js server/routes/admin.js server/index.js
git commit -m "feat(billing): credits routes + admin grant/ledger/config endpoints"
```

---

## Phase 3 — 管理员后台 UI

### Task 9: 模型价格编辑器

**Files:**
- Modify: `src/components/admin/ModelModal.tsx`
- Modify: `src/components/admin/ModelConfig.tsx`（透传保存 pricing）

- [ ] **Step 1: ModelModal 增加 pricing 表单**

在 ModelModal 的模型编辑表单里，依据 `category` 渲染：
- 所有类别：`base`（数字输入，积分，允许小数）。
- `image`：`byResolution` 三个输入 `1k/2k/4k` 系数。
- `video`：`byDuration`（动态键值对，如 `5s/10s`）+ `byTier`（`lite/fast/quality`）系数。
- `vision/text`：只显示 base。

state 形如 `const [pricing, setPricing] = useState(model?.pricing || {})`，编辑后随模型一起 `onSave({ ...fields, pricing })`。示例（base 输入）：
```tsx
<label className="block text-sm">单价(积分)
  <input type="number" step="0.01" min="0"
    value={pricing.base ?? ''}
    onChange={e => setPricing(p => ({ ...p, base: e.target.value === '' ? undefined : Number(e.target.value) }))}
    className="..." />
</label>
```
图片系数示例：
```tsx
{category === 'image' && ['1k','2k','4k'].map(k => (
  <label key={k} className="...">{k} 系数
    <input type="number" step="0.1" min="0"
      value={pricing.byResolution?.[k] ?? ''}
      onChange={e => setPricing(p => ({ ...p, byResolution: { ...(p.byResolution||{}), [k]: Number(e.target.value) } }))} />
  </label>
))}
```
（video 的 byDuration/byTier 同构，键分别为 `['5s','10s']` 与 `['lite','fast','quality']`。）

- [ ] **Step 2: ModelConfig 保存时带上 pricing**

确认 ModelConfig 调 `PUT /api/admin/models/:id` 的 body 包含 `pricing`（透传 ModelModal onSave 的对象即可，后端 Task 4 已允许该字段）。

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 构建通过，无 TS 报错。

- [ ] **Step 4: 浏览器验证**

本地 `npm run dev`（或部署后），后台「模型配置」打开某模型 → 填价格 → 保存 → 重开确认回显；调 `GET /api/models` 或 admin models 确认 `pricing` 已存。

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/ModelModal.tsx src/components/admin/ModelConfig.tsx
git commit -m "feat(admin-ui): per-model pricing editor"
```

---

### Task 10: 用户积分管理 + billing 设置

**Files:**
- Modify: `src/components/admin/UserManagement.tsx`
- Modify: `src/components/admin/AdminConsole.tsx`（billing 设置区）

- [ ] **Step 1: UserManagement 显示余额列 + 发放按钮**

用户列表（来自 `GET /api/admin/users`，现已含 `balance`，单位百分→显示 `balance/100`）加一列「积分」，每行加「发放/调整」按钮，点开弹框：金额输入 + 模式选择(`grant/deduct/set`) + 备注，提交 `POST /api/admin/users/:id/credits`，成功后刷新列表。
```tsx
// 发放提交
await fetch(`/api/admin/users/${id}/credits`, {
  method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
  body: JSON.stringify({ amount: Number(amount), mode, note }),
});
```

- [ ] **Step 2: AdminConsole 加 billing 设置区**

新增「积分设置」区块：总开关(`enabled`) + 各类别兜底价输入，读 `GET /api/admin/billing-config`、存 `POST /api/admin/billing-config`。
```tsx
await fetch('/api/admin/billing-config', { method: 'POST', headers: {...},
  body: JSON.stringify({ enabled, defaultPrice }) });
```

- [ ] **Step 3: 构建验证**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 4: 浏览器验证**

后台给某用户发放积分→列表余额变化；开/关计费开关→`GET /api/admin/billing-config` 反映；普通用户登录后生成会扣费、admin 不扣。

- [ ] **Step 5: Commit**

```bash
git add src/components/admin/UserManagement.tsx src/components/admin/AdminConsole.tsx
git commit -m "feat(admin-ui): user credits management + billing settings"
```

---

### Task 11: 后台流水页

**Files:**
- Modify: `src/components/admin/AdminConsole.tsx`（新增「积分流水」页签/区块）

- [ ] **Step 1: 流水列表**

新增「积分流水」视图，调 `GET /api/admin/ledger?userId=&type=&limit=&offset=`，表格列：时间、用户、类型、模型、参数、金额(`amount`)、操作后余额(`balanceAfter`)、备注。支持按用户/类型筛选 + 分页。
```tsx
const rows = await (await fetch(`/api/admin/ledger?limit=100&offset=${offset}` + (userId?`&userId=${userId}`:''), { headers: { Authorization: `Bearer ${token}` } })).json();
```

- [ ] **Step 2: 构建验证**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 3: 浏览器验证**

发放 + 生成几次后，流水页能看到 grant 与 charge 记录，金额/余额正确。

- [ ] **Step 4: Commit**

```bash
git add src/components/admin/AdminConsole.tsx
git commit -m "feat(admin-ui): credit ledger viewer"
```

---

## Phase 4 — 用户端 UI

### Task 12: 顶栏余额显示 + AuthContext 刷新

**Files:**
- Modify: `src/contexts/AuthContext.tsx`
- Modify: `src/components/TopBar.tsx`

- [ ] **Step 1: AuthContext 暴露 balance 与 refreshUser**

`/api/auth/me` 返回的 user 已含 `balance`（百分单位）。在 AuthContext 增加 `refreshUser()`（重新拉 `/api/auth/me` 或 `/api/credits/balance` 更新 `user.balance`），并通过 context 暴露。
```tsx
const refreshUser = useCallback(async () => {
  const r = await fetch('/api/auth/me', { headers: authHeader() });
  if (r.ok) setUser(await r.json());
}, []);
```

- [ ] **Step 2: TopBar 显示余额**

在用户名旁显示积分（`user.balance/100`，2 位小数）：
```tsx
{typeof user.balance === 'number' && (
  <span title="积分余额" className="px-2 py-0.5 rounded-full text-xs ...">
    积分 {(user.balance / 100).toFixed(2)}
  </span>
)}
```

- [ ] **Step 3: 生成成功后刷新余额**

在生成成功的回调处（`generationService` 调用方，App 层 onSuccess）调用 `refreshUser()`，让顶栏数字更新。

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: Commit**

```bash
git add src/contexts/AuthContext.tsx src/components/TopBar.tsx
git commit -m "feat(ui): show credit balance in top bar + refresh after generation"
```

---

### Task 13: 402 积分不足处理

**Files:**
- Modify: `src/services/generationService.ts`
- Modify: 生成调用方（捕获错误弹 toast；如 `src/App.tsx` 或对应 hook）

- [ ] **Step 1: generationService 抛出专用错误**

在 `generateImage`/`generateVideo` 的 fetch 之后，对 402 单独处理：
```ts
if (response.status === 402) {
  const d = await response.json().catch(() => ({}));
  const err: any = new Error(d.error || '积分不足');
  err.code = 'INSUFFICIENT_CREDITS';
  err.price = d.price; err.balance = d.balance;
  throw err;
}
```

- [ ] **Step 2: 调用方弹提示并中止**

生成调用方 catch 到 `code === 'INSUFFICIENT_CREDITS'` 时，`showToast('积分不足，请联系管理员', 'error')`，把该节点置回非 loading（不标记为可重试的中断错误），批量时停止后续发起。
```ts
catch (e:any) {
  if (e.code === 'INSUFFICIENT_CREDITS') { showToast(e.message || '积分不足，请联系管理员', 'error'); /* 复位节点 */ return; }
  throw e;
}
```

- [ ] **Step 3: 看图/文字调用方同样处理**

DescribeV2、文字优化的前端调用处，对 402 同样弹「积分不足」提示（可复用同一判断）。

- [ ] **Step 4: 构建验证**

Run: `npm run build`
Expected: 通过。

- [ ] **Step 5: 端到端验证**

开关开、把某用户余额设为很小 → 生成 → 顶栏不变、弹「积分不足」、不产生历史；发放后再生成成功、余额减少、流水出现 charge。

- [ ] **Step 6: Commit**

```bash
git add src/services/generationService.ts src/App.tsx
git commit -m "feat(ui): handle 402 insufficient-credits with toast"
```

---

## 部署（全部完成后）

- [ ] 本地 `npm run build` 通过；`npx vitest run` 全绿。
- [ ] 推送 `feat/p0-auth`；Windows `git pull && npm run build`；重启 node（后端改动）。
- [ ] 线上默认 `billing_enabled=0`（不影响现有使用）；管理员配好各模型价格 + 兜底价后再手动开启。

## Self-Review 备注（写计划时已核对）

- **Spec 覆盖**：数据模型(T3/T4)、计价(T2/T5)、扣费时机+预检+成功才扣(T6/T7)、管理员豁免+总开关(T5)、价格配置 UI(T9)、用户积分管理(T10)、流水(T8/T11)、用户端余额+402(T12/T13)、小数精度(T2 units)、fp 无关（无需代码）。均有对应任务。
- **类型一致**：单位贯穿 units（整数），接口边界 `/100` 转积分；`computePrice` 返回 units；`grant` 入参积分→`toUnits`。
- **占位符**：无 TBD；每个代码步均给出完整代码。
- **已知取舍**：成功才扣 + 预检，极端并发可能轻微扣负（spec 已认可）；文字入口可能多处，T7 注明逐处接入。
