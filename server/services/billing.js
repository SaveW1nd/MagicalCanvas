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
