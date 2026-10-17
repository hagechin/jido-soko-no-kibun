import { describe, expect, it } from 'vitest';
import { TEXT_SIZES, isTextSize, scaleFor } from './textSize';

describe('文字の大きさ', () => {
  it('4 段階。標準は 1 倍、大は 1.2、特大は 1.4', () => {
    expect(TEXT_SIZES.map((t) => t.id)).toEqual(['small', 'normal', 'large', 'xlarge']);
    expect(scaleFor('normal')).toBe(1);
    expect(scaleFor('large')).toBeCloseTo(1.2);
    expect(scaleFor('xlarge')).toBeCloseTo(1.4);
    expect(scaleFor('small')).toBeLessThan(1);
  });
  it('保存値の検証', () => {
    expect(isTextSize('large')).toBe(true);
    expect(isTextSize('huge')).toBe(false);
    expect(isTextSize(null)).toBe(false);
  });
});
