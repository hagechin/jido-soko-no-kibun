import { describe, expect, it } from 'vitest';
import { PHOTO_TITLE, apertureForF, aspectRatio, captionLines, captureFov, fovForFocal, photoSize, shutterFrames } from './photo';

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
  it('シャッターの合成コマ数（1 tick あたり 3 コマ、4〜24）', () => {
    expect(shutterFrames(0)).toBe(1);
    expect(shutterFrames(0.33)).toBe(4);
    expect(shutterFrames(5)).toBe(15);
    expect(shutterFrames(100)).toBe(24);
  });
  it('撮影の画角はプレビューの枠と同じ範囲（横長の出力は横の画角を合わせる）', () => {
    expect(captureFov(27, 0.46, 0.46)).toBeCloseTo(27);
    expect(captureFov(27, 0.46, 0.4)).toBeCloseTo(27); // 縦長 → 縦の画角そのまま
    const wide = captureFov(27, 0.46, 1.5); // スマホ縦で 3:2 → 縦の画角はぐっと狭くなる
    expect(wide).toBeLessThan(10);
    expect(wide).toBeGreaterThan(5);
    expect(captureFov(27, 1.78, 1.78)).toBeCloseTo(27);
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
