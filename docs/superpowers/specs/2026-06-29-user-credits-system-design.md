# 用户积分系统 — 设计文档

- 日期：2026-06-29
- 状态：已确认，待写实现计划
- 范围：MagicalCanvas（Vite+React+Express+better-sqlite3，分支 `feat/p0-auth`）

## 1. 目标

给多租户画布增加**面向用户的积分计费**：用户每次生成消耗积分，积分由管理员发放；
管理员可在后台配置**每个模型按参数**的扣费额度，并查看消费流水。

非目标（后续单独项目）：用户自助**充值购买**（涉及支付网关）。

## 2. 核心决策（已确认）

| 项 | 决策 |
|---|---|
| 计价颗粒度 | **按模型 + 参数**（图片按 1K/2K/4K，视频按时长/档位） |
| 数值精度 | **支持小数**，保留 2 位；内部按**百分单位整数**（×100）存储，杜绝浮点误差 |
| 扣费范围 | 图片生成、视频生成、看图识别(视觉)、文字对话/提示词优化 —— **全部扣费** |
| 扣费时机 | **成功才扣**；发起前先检查余额，不足则拦截 |
| 管理员 | `role=admin` **豁免**，不扣费 |
| 积分来源 | **仅管理员手动发放/调整**（无注册赠送、无充值） |
| 流水 | **完整流水账本**（每笔扣费/发放/调整都记录） |
| 价格存储 | **方案 A**：`models` 表加 `pricing` JSON 列 |
| 总开关 | `billing_enabled`，**默认关**，配好价格后手动开启才扣费 |
| 与 fp 关系 | 与 fp 账号的 `remaining_quota` 完全无关，是应用层独立积分 |

## 3. 数据模型（`magicalcanvas.db`）

所有金额字段单位 = **1/100 积分**（整数）。例：余额 `250` = 2.50 积分。

### 3.1 `users` 表新增
```sql
ALTER TABLE users ADD COLUMN balance INTEGER NOT NULL DEFAULT 0;  -- 百分单位
```
迁移：现有用户默认 0，由管理员发放。

### 3.2 `models` 表新增（registry.js，与 users 同在 `magicalcanvas.db`）
```sql
ALTER TABLE models ADD COLUMN pricing TEXT NOT NULL DEFAULT '{}';
```
`pricing` JSON 结构（金额用**积分**写，可带小数；解析时 ×100 转百分单位）：
```json
{
  "base": 2.5,
  "byResolution": { "1k": 1, "2k": 2, "4k": 4 },
  "byDuration":   { "5s": 1, "10s": 2 },
  "byTier":       { "lite": 1, "fast": 2, "quality": 4 }
}
```
- 最终价 = `base × 命中的各参数系数`（缺省系数按 1）。
- 文字 / 视觉：无参数，价 = `base`。
- `pricing` 为空 `{}` 或 `base` 缺失 → 用**类别兜底价**（见 3.4）；兜底也没有 → 价 0（免费，仍记 0 流水）。

### 3.3 新表 `credit_ledger`（完整流水）
```sql
CREATE TABLE IF NOT EXISTS credit_ledger (
  id           TEXT PRIMARY KEY,
  userId       TEXT NOT NULL,
  delta        INTEGER NOT NULL,        -- 百分单位，正=入账(发放/退回)，负=扣费
  balanceAfter INTEGER NOT NULL,        -- 该笔后的余额(百分单位)
  type         TEXT NOT NULL,           -- 'charge' | 'grant' | 'adjust'
  category     TEXT,                    -- 'images'|'videos'|'vision'|'text'（charge 时）
  modelId      TEXT,                    -- 扣费对应模型（charge 时）
  params       TEXT,                    -- JSON：{resolution,duration,tier,...}（charge 时）
  refId        TEXT,                    -- 关联 nodeId / 资产 id，便于追溯
  note         TEXT,                    -- 备注（grant/adjust 必填原因）
  operatorId   TEXT,                    -- 发放/调整的管理员 id（charge 为空）
  createdAt    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ledger_user ON credit_ledger(userId, createdAt);
```

### 3.4 全局设置（`meta` 键值表）
- `billing_enabled`：`'0'|'1'`，默认 `'0'`。
- `default_price`：JSON，各类别兜底价（积分），如 `{"images":2,"videos":20,"vision":0.5,"text":0.2}`。

## 4. 计价模块 `server/services/billing.js`

纯函数 + DB 操作集中于此，generation 路由只调用它。

- `computePrice(model, category, params) -> number`
  读 `model.pricing`，按 base × 参数系数算价（百分单位）；缺失走 `default_price`；再缺为 0。
  参数映射（复用 generation 路由已收到的字段）：
  - 图片：`resolution`（`1k/2k/4k`）。
  - 视频：`duration` → `byDuration` 键；`videoModel`/档位 → `byTier` 键。
  - 视觉 / 文字：无参数。
- `getBalance(userId) -> number`（百分单位）。
- `quote(userId, category, modelId, params) -> { price, balance, ok }`：发起前预检用。
- `charge(userId, { category, modelId, params, refId }) -> { ok, price, balanceAfter }`
  原子扣费 + 写流水。SQL：`UPDATE users SET balance = balance - :price WHERE id = :id`（成功才扣，结果已产出）。
- `grant(userId, deltaCredits, operatorId, note, type='grant') -> { balanceAfter }`
  发放/扣减/设置（`adjust`），写流水。
- `isExempt(user) -> bool`：`role === 'admin'` 或 `billing_enabled !== '1'` 时为 true（豁免/不计费）。

## 5. 扣费流程（成功才扣 + 先检查）

接入四个入口（`server/routes/generation.js` 的 image/video，`server/index.js` 的 vision-describe、text/chat·optimize）：

1. **发起前预检**：`isExempt` 为真则跳过计费直接放行；否则 `quote()`，若 `!ok`（余额 < 价）→ 返回 `402`，body `{ error: '积分不足', balance, price }`。前端弹提示、不生成。
2. **成功后**：生成成功并存好结果 → `charge()` 原子扣费 + 写流水（`refId = nodeId`）。
3. **失败**：不扣（不进入 charge）。
4. **并发取舍**：成功才扣 + 预检可挡绝大多数；同一瞬间批量并发极端情况可能轻微扣负，可接受（文档记录，不做预占/冻结）。

## 6. 管理员后台

### 6.1 价格配置（现有「模型配置」页）
- 每个模型行增加**价格编辑器**：base + 各参数系数（按该模型 `category` 显示对应参数组：图片显示 byResolution，视频显示 byDuration/byTier，文字/视觉只有 base）。
- 存入 `models.pricing`。复用现有 `/api/admin/models` 更新通道，新增 `pricing` 字段。
- 页面顶部：**总开关 `billing_enabled`** + **类别兜底价 `default_price`** 编辑。

### 6.2 用户积分管理（现有用户管理页）
- 列表展示每个用户余额。
- 操作：发放 / 扣减 / 设置余额（弹框填数值 + 必填备注）→ `POST /api/admin/users/:id/credits`（调 `grant`，写流水 `type=grant|adjust`）。

### 6.3 流水查看
- `GET /api/admin/ledger?userId=&type=&limit=&offset=`：分页查 `credit_ledger`，可按用户/类型筛选。
- 后台一个「积分流水」页：时间、用户、类型、模型、参数、金额、操作后余额、备注。

## 7. 用户端

- 顶部栏显示当前余额（`GET /api/credits/balance`），生成成功后刷新。
- 余额不足：生成请求返回 `402` → 前端 toast「积分不足，请联系管理员」并中止该次生成（批量时跳过后续）。
- 「我的积分明细」轻量面板（`GET /api/credits/ledger`，仅本人）：看自己的消费记录。

## 8. API 一览（新增）

用户态：
- `GET /api/credits/balance` → `{ balance }`（积分，2 位小数）
- `GET /api/credits/ledger?limit=&offset=` → 本人流水

管理态（`verify_admin`）：
- `POST /api/admin/users/:id/credits` → `{ amount, mode: 'grant'|'deduct'|'set', note }`
- `GET /api/admin/ledger?userId=&type=&limit=&offset=`
- 模型配置：`models.pricing` 经现有 `/api/admin/models` 更新
- 设置：`GET/POST /api/admin/billing-config`（`billing_enabled` + `default_price`）

## 9. 边界与约定

- **小数**：API/界面用积分（2 位小数）；DB/计算用百分单位整数；`computePrice` 结果四舍五入到整数百分单位。
- **免费**：价 0 时仍写一条 `delta=0` 的 charge 流水，便于审计。
- **总开关关**：`billing_enabled=0` 时所有请求豁免，余额/价格照常可配但不扣 —— 保证上线后不影响现有 `canvas.savewind.top` 使用，配好再开。
- **管理员豁免**：admin 不预检不扣费。
- **迁移安全**：`ALTER TABLE ADD COLUMN` 带默认值，老数据不破坏；老模型 `pricing='{}'` 即走兜底/免费。
- **fp 无关**：本积分独立于 fp 账号 `remaining_quota`。

## 10. 测试要点

- `computePrice`：各类别 + 参数组合 + 缺省回退 + 兜底 + 免费。
- `charge/grant` 原子性与流水 `balanceAfter` 正确性。
- 预检拦截：余额不足返回 402 且不生成、不扣费。
- 成功才扣：失败路径不扣费；成功路径恰扣一次。
- 管理员豁免、总开关关闭：均不扣费。
- 小数精度：2.5 × 4 = 10.00，无浮点漂移。
