/**
 * billing.js — 积分计价与扣费。单位统一为「百分单位整数」(units)，1 积分 = 100 units。
 */

import {
  getMeta, setMeta,
  getUserBalanceUnits, addUserBalanceUnits, setUserBalanceUnits, insertLedger,
} from '../db/index.js';
import { resolveModel } from '../db/registry.js';

export function toUnits(credits) { return Math.round(Number(credits || 0) * 100); }
export function toCredits(units) { return Math.round(Number(units || 0)) / 100; }

/** 视频时长(秒)→ byDuration 的键，如 10 → "10s"。 */
function durationKey(d) { return `${parseInt(d, 10)}s`; }

/**
 * 计算一次生成的价格（返回 units 整数）。基础价 × 命中倍率：
 * - 基础价 = pricing.base（没配则用类别兜底价 defaults[category]，再没有 = 0）
 * - 倍率：图片看 pricing.byResolution[分辨率]、视频看 pricing.byDuration[时长]；未命中 = ×1
 * @param model    registry 模型对象（含 category 与 pricing）
 * @param category 'image'|'video'|'vision'|'text'
 * @param params   { resolution?, duration? }
 * @param defaults 类别兜底价 { image, video, vision, text }（积分）
 */
export function computePrice(model, category, params = {}, defaults = {}) {
  const pricing = (model && model.pricing) || {};
  const baseCredits = typeof pricing.base === 'number' ? pricing.base
    : (typeof defaults[category] === 'number' ? defaults[category] : 0);
  let mult = 1;
  if (category === 'image' && params.resolution != null && pricing.byResolution) {
    const v = pricing.byResolution[String(params.resolution).toLowerCase()];
    if (typeof v === 'number') mult = v;
  }
  if (category === 'video' && params.duration != null && pricing.byDuration) {
    const v = pricing.byDuration[durationKey(params.duration)];
    if (typeof v === 'number') mult = v;
  }
  return Math.round(baseCredits * mult * 100);
}

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

/** 是否豁免计费。enabled 显式传入便于单测；默认读全局开关。 */
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
    userId, delta, balanceAfter, type: mode === 'grant' ? 'grant' : 'adjust',
    note: note || null, operatorId: operatorId || null,
  });
  return { balanceAfter };
}
