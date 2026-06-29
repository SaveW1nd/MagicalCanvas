import { describe, it, expect } from 'vitest';
import { toUnits, toCredits, computePrice } from './billing.js';

describe('units', () => {
  it('转换无浮点漂移', () => {
    expect(toUnits(2.5)).toBe(250);
    expect(toUnits(0.1)).toBe(10);
    expect(toCredits(250)).toBe(2.5);
  });
});

describe('computePrice (单位=units，直接档位价)', () => {
  const defaults = { image: 2, video: 20, vision: 0.5, text: 0.2 };

  it('图片：按分辨率直接定价', () => {
    const m = { category: 'image', pricing: { byResolution: { '1k': 2, '2k': 4, '4k': 8 } } };
    expect(computePrice(m, 'image', { resolution: '4k' }, defaults)).toBe(800);
    expect(computePrice(m, 'image', { resolution: '1K' }, defaults)).toBe(200); // 大小写不敏感
  });

  it('视频：按时长直接定价', () => {
    const m = { category: 'video', pricing: { byDuration: { '5s': 10, '10s': 20 } } };
    expect(computePrice(m, 'video', { duration: 10 }, defaults)).toBe(2000);
    expect(computePrice(m, 'video', { duration: 5 }, defaults)).toBe(1000);
  });

  it('视觉/文字：用模型单价 base', () => {
    expect(computePrice({ category: 'vision', pricing: { base: 0.5 } }, 'vision', {}, defaults)).toBe(50);
  });

  it('档位没命中 → 回退模型 base，再回退类别兜底', () => {
    expect(computePrice({ category: 'image', pricing: { base: 3 } }, 'image', { resolution: '8k' }, defaults)).toBe(300); // 8k 未配 → base 3
    expect(computePrice({ category: 'image', pricing: {} }, 'image', { resolution: '4k' }, defaults)).toBe(200); // 全未配 → 兜底 2
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
