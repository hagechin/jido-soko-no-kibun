import { describe, expect, it } from 'vitest';
import { CLOUD_NEWER_MS, shouldOfferCloud } from './cloud';

describe('iCloud のセーブを提案するか', () => {
  it('端末より十分新しいときだけ', () => {
    expect(shouldOfferCloud(1000, 1000 + CLOUD_NEWER_MS + 1, 0)).toBe(true);
    expect(shouldOfferCloud(1000, 1000 + CLOUD_NEWER_MS, 0)).toBe(false);
    expect(shouldOfferCloud(5000, 1000, 0)).toBe(false);
    expect(shouldOfferCloud(null, 1, 0)).toBe(false); // savedAt 0/1 は「無い」扱い… 1 は提案（端末に何も無い）
  });
  it('端末にセーブが無ければクラウドのものを提案する', () => {
    expect(shouldOfferCloud(null, CLOUD_NEWER_MS + 10, 0)).toBe(true);
  });
  it('自分が送ったセーブが戻ってきたときは提案しない', () => {
    expect(shouldOfferCloud(1000, 99_000, 99_000)).toBe(false);
  });
  it('クラウドが空なら提案しない', () => {
    expect(shouldOfferCloud(1000, 0, 0)).toBe(false);
  });
});
