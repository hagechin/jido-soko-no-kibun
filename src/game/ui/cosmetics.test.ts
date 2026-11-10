import { describe, expect, it } from 'vitest';
import { CONTRACTS } from '../data/balance';
import { CLIENTS } from '../data/clients';
import { inStore, isUnlocked, ownedKey, PAINT_BY_ID, PAINTS, THEME_BY_ID, THEMES } from './cosmetics';
import { secondsUntilTomorrow } from './notify';

describe('1.2 見た目の入手先', () => {
  const none = { owned: [], trust: {} };

  it('標準は誰でも。コインの見た目は買うまで使えず、塗装とテーマで記録の名前が重ならない', () => {
    expect(isUnlocked('paint', 'standard', PAINT_BY_ID.standard.source, none)).toBe(true);
    expect(isUnlocked('theme', 'standard', THEME_BY_ID.standard.source, none)).toBe(true);
    const neon = PAINT_BY_ID.neon;
    expect(isUnlocked('paint', neon.id, neon.source, none)).toBe(false);
    expect(isUnlocked('paint', neon.id, neon.source, { owned: [ownedKey('paint', 'neon')], trust: {} })).toBe(true);
    expect(isUnlocked('paint', neon.id, neon.source, { owned: [ownedKey('theme', 'neon')], trust: {} })).toBe(false);
    // サポーターパックの見た目は、購入していなければ使えない（Web 版・未購入）
    expect(isUnlocked('paint', 'gold', PAINT_BY_ID.gold.source, none)).toBe(false);
  });

  it('取引先の塗装は、その取引先のレベルで解放', () => {
    const p = PAINT_BY_ID['client-kotori'];
    const need = CONTRACTS.trustLevels[CONTRACTS.paintLevel - 1];
    expect(isUnlocked('paint', p.id, p.source, { owned: [], trust: { kotori: need - 1 } })).toBe(false);
    expect(isUnlocked('paint', p.id, p.source, { owned: [], trust: { kotori: need } })).toBe(true);
    expect(isUnlocked('paint', p.id, p.source, { owned: [], trust: { popo: 9999 } })).toBe(false);
    for (const c of CLIENTS) expect(PAINT_BY_ID[`client-${c.id}`]?.colors?.shelf).toBe(c.color);
  });

  it('季節のテーマは実際のその月にだけ店に並ぶ。1 年のどの月にも何か 1 つは並ぶ季節がある', () => {
    expect(inStore(THEME_BY_ID.sakura.source, 3)).toBe(true);
    expect(inStore(THEME_BY_ID.sakura.source, 5)).toBe(false);
    expect(inStore(THEME_BY_ID.snow.source, 1)).toBe(true);
    expect(inStore(THEME_BY_ID.forest.source, 6)).toBe(true); // 季節なしはいつでも
    expect(inStore(THEME_BY_ID.midnight.source, 6)).toBe(false); // コイン以外は店に並ばない
    const seasonal = THEMES.filter((t) => t.source.type === 'coins' && t.source.months);
    expect(seasonal).toHaveLength(4);
    // id の重複なし、色は 6 桁
    expect(new Set(PAINTS.map((p) => p.id)).size).toBe(PAINTS.length);
    expect(new Set(THEMES.map((t) => t.id)).size).toBe(THEMES.length);
    for (const p of PAINTS) if (p.colors) for (const v of Object.values(p.colors)) expect(v).toMatch(/^#[0-9a-f]{6}$/);
    for (const t of THEMES) expect(t.backdrop).toMatch(/^#[0-9a-f]{6}$/);
  });

  it('通知: 翌朝 9 時までの秒数', () => {
    expect(secondsUntilTomorrow(9, new Date(2026, 10, 10, 9, 0, 0))).toBe(24 * 3600);
    expect(secondsUntilTomorrow(9, new Date(2026, 10, 10, 23, 30, 0))).toBe(9.5 * 3600);
    expect(secondsUntilTomorrow(9, new Date(2026, 10, 10, 3, 0, 0))).toBe(30 * 3600);
  });
});
