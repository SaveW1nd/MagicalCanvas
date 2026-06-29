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

import { isExempt } from './billing.js';
describe('isExempt', () => {
  it('总开关关 → 豁免', () => { expect(isExempt({ role: 'user' }, false)).toBe(true); });
  it('开关开 + 普通用户 → 不豁免', () => { expect(isExempt({ role: 'user' }, true)).toBe(false); });
  it('开关开 + 管理员 → 豁免', () => { expect(isExempt({ role: 'admin' }, true)).toBe(true); });
});
