import { describe, it, expect } from 'vitest';
import { toUnits, toCredits, computePrice } from './billing.js';

describe('units', () => {
  it('转换无浮点漂移', () => {
    expect(toUnits(2.5)).toBe(250);
    expect(toUnits(0.1)).toBe(10);
    expect(toCredits(250)).toBe(2.5);
  });
});

describe('computePrice (单位=units，基础价×倍率)', () => {
  const defaults = { image: 2, video: 20, vision: 0.5, text: 0.2 };

  it('图片：base × 分辨率倍率', () => {
    const m = { category: 'image', pricing: { base: 2, byResolution: { '1k': 1, '2k': 1.5, '4k': 2 } } };
    expect(computePrice(m, 'image', { resolution: '4k' }, defaults)).toBe(400); // 2×2
    expect(computePrice(m, 'image', { resolution: '2K' }, defaults)).toBe(300); // 2×1.5，大小写不敏感
    expect(computePrice(m, 'image', { resolution: '8k' }, defaults)).toBe(200); // 未命中→×1
  });

  it('视频：每秒积分 × 时长', () => {
    const m = { category: 'video', pricing: { perSecond: 15 } };
    expect(computePrice(m, 'video', { duration: 8 }, defaults)).toBe(12000); // 15×8 = 120 积分
    expect(computePrice(m, 'video', { duration: 10 }, defaults)).toBe(15000); // 15×10 = 150 积分
    expect(computePrice(m, 'video', {}, defaults)).toBe(0); // 没时长 → 0
  });

  it('视觉/文字：只用 base（无倍率）', () => {
    expect(computePrice({ category: 'vision', pricing: { base: 0.5 } }, 'vision', {}, defaults)).toBe(50);
  });

  it('没配 base → 用类别兜底价当 base', () => {
    expect(computePrice({ category: 'image', pricing: { byResolution: { '4k': 2 } } }, 'image', { resolution: '4k' }, defaults)).toBe(400); // 兜底2 ×2
  });

  it('什么都没配 → 0(免费)', () => {
    expect(computePrice({ category: 'image', pricing: {} }, 'image', { resolution: '4k' }, {})).toBe(0);
  });
});

import { isExempt } from './billing.js';
describe('isExempt', () => {
  it('总开关关 → 豁免', () => { expect(isExempt({ role: 'user' }, false)).toBe(true); });
  it('开关开 + 普通用户 → 不豁免', () => { expect(isExempt({ role: 'user' }, true)).toBe(false); });
  it('开关开 + 管理员 → 豁免', () => { expect(isExempt({ role: 'admin' }, true)).toBe(true); });
});
