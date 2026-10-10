import { describe, expect, it } from 'vitest';
import { PHOTO_TITLE, apertureForF, aspectRatio, captionLines, fovForFocal, photoSize, shutterFrames } from './photo';

describe('フォトモードのパラメータ', () => {
  it('焦点距離 → 縦の画角（35mm 換算、センサー縦 24mm）', () => {
    expect(fovForFocal(50)).toBeCloseTo(26.99, 1);
    expect(fovForFocal(24)).toBeGreaterThan(fovForFocal(85));
    expect(fovForFocal(135)).toBeCloseTo(10.16, 1);
  });
  it('F 値が小さいほど絞り（ボケ）が強い', () => {
    expect(apertureForF(1.4)).toBeGreaterThan(apertureForF(16));
    expect(apertureForF(16)).toBeLessThan(0.005);
  });
  it('縦横比と出力サイズ（長辺を揃える）', () => {
    expect(aspectRatio('screen', 0.46)).toBeCloseTo(0.46);
    expect(photoSize('3:2', 1, 1500)).toEqual({ width: 1500, height: 1000 });
    expect(photoSize('4:5', 1, 1500)).toEqual({ width: 1200, height: 1500 });
    expect(photoSize('1:1', 1, 1500)).toEqual({ width: 1500, height: 1500 });
    expect(photoSize('screen', 390 / 844, 2000)).toEqual({ width: 924, height: 2000 });
  });
  it('シャッターの合成コマ数', () => {
    expect(shutterFrames(0)).toBe(1);
    expect(shutterFrames(0.6)).toBe(4);
    expect(shutterFrames(5)).toBe(15);
    expect(shutterFrames(100)).toBe(16);
  });
  it('ロゴの行: なし／ロゴ／ロゴ＋倉庫情報', () => {
    const info = { rank: 'メガDC', year: 3, month: 5, shipped: 12345 };
    expect(captionLines('none', info)).toEqual([]);
    expect(captionLines('logo', info)).toEqual([PHOTO_TITLE]);
    const two = captionLines('logoInfo', info);
    expect(two).toHaveLength(2);
    expect(two[1]).toContain('メガDC');
    expect(two[1]).toContain('3 年目 5 月');
    expect(two[1]).toContain('12,345');
  });
});
