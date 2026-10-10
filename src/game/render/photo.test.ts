import { describe, expect, it } from 'vitest';
import { MAX_COC_RADIUS, PHOTO_TITLE, aspectRatio, captionLines, captureFov, cocAt, cocScale, fovForFocal, photoSize, shutterFrames } from './photo';

describe('フォトモードのパラメータ', () => {
  it('焦点距離 → 縦の画角（35mm 換算、センサー縦 24mm）', () => {
    expect(fovForFocal(50)).toBeCloseTo(26.99, 1);
    expect(fovForFocal(24)).toBeGreaterThan(fovForFocal(85));
    expect(fovForFocal(135)).toBeCloseTo(10.16, 1);
  });
  it('被写界深度は物理的な錯乱円（画像の高さに対する直径の比率）', () => {
    // F 値が小さいほど、焦点距離が長いほど、ピントが近いほど大きくボケる
    expect(cocScale(50, 1.4, 12)).toBeGreaterThan(cocScale(50, 16, 12));
    expect(cocScale(135, 2.8, 12)).toBeGreaterThan(cocScale(24, 2.8, 12));
    expect(cocScale(50, 2.8, 3)).toBeGreaterThan(cocScale(50, 2.8, 12));
    // 50mm F16 でピント 12 m: 24 m 先でも 0.1% 未満（1500px の写真で 1px 未満 → 鮮明）
    expect(cocAt(50, 16, 12, 24)).toBeLessThan(0.001);
    // 50mm F1.4 で遠く（60 m）にピント: 100 m 先の背景も鮮明
    expect(cocAt(50, 1.4, 60, 100)).toBeLessThan(0.001);
    // 135mm F1.4 でピント 5 m: 8 m 先は大きくボケる（3% 以上 = 上限に届く）
    expect(cocAt(135, 1.4, 5, 8)).toBeGreaterThan(0.03);
    // 50mm F2.8 でピント 3 m: 10 m 先は中くらい（1500px で十数 px）
    const mid = cocAt(50, 2.8, 3, 10);
    expect(mid).toBeGreaterThan(0.005);
    expect(mid).toBeLessThan(0.015);
    // ピント位置はボケない
    expect(cocAt(85, 1.4, 6, 6)).toBe(0);
    expect(MAX_COC_RADIUS).toBeGreaterThan(0.01);
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
