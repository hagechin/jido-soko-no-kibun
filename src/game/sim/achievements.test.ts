import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepMany } from './sim';
import { achievementStatuses, achievementValue, formatAchievementValue, initAchievementsSilently, mergeProfile, tierOf, updateAchievements, ACHIEVEMENT_BY_ID, type AchievementProfile } from './achievements';
import { ACHIEVEMENTS, CALENDAR, MEDALS } from '../data/balance';
import { migrate } from './save';
import { buildPreset } from './presets';
import type { SimEvent } from './types';

describe('achievements', () => {
  it('every definition has ascending tiers and a value; distance climbs to the moon', () => {
    const w = createWorld({ seed: 1 });
    for (const def of ACHIEVEMENTS) {
      for (let i = 1; i < def.tiers.length; i++) expect(def.tiers[i].value).toBeGreaterThan(def.tiers[i - 1].value);
      expect(Number.isFinite(achievementValue(w, def.id))).toBe(true);
      expect(def.tiers.length).toBeLessThanOrEqual(MEDALS.length);
    }
    const d = ACHIEVEMENT_BY_ID.distance;
    expect(d.tiers.map((t) => t.value)).toEqual([100, 2_000, 20_000, 40_000, 384_400]);
    expect(tierOf(d, 99)).toBe(0);
    expect(tierOf(d, 100)).toBe(1);
    expect(tierOf(d, 400_000)).toBe(5);
    expect(formatAchievementValue(d, 2.345)).toBe('2.3 km');
    expect(formatAchievementValue(d, 20_000)).toBe('20,000 km');
  });

  it('travel distance accumulates from robot moves and unlocks bronze once with an event', () => {
    const w = createWorld({ seed: 1 });
    const rt = createRuntime();
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'balanced', lastRetrieveTick: 0 };
    stepMany(w, rt, 600 * 3);
    expect(w.stats.travelCells).toBeGreaterThan(0);
    expect(w.stats.fullAutomationTick).not.toBeNull();
    // 100 km 相当を足して銅
    w.stats.travelCells = 100_000;
    w.events.length = 0;
    updateAchievements(w);
    const ev = w.events.filter((e): e is Extract<SimEvent, { type: 'achievement' }> => e.type === 'achievement' && e.id === 'distance');
    expect(ev).toHaveLength(1);
    expect(ev[0].tier).toBe(1);
    expect(w.achievements?.distance?.tier).toBe(1);
    // 同じ段ではもう出ない
    w.events.length = 0;
    updateAchievements(w);
    expect(w.events.some((e) => e.type === 'achievement' && e.id === 'distance')).toBe(false);
    // 月まで
    w.stats.travelCells = 384_400_000;
    updateAchievements(w);
    expect(w.achievements?.distance?.tier).toBe(5);
    expect(achievementStatuses(w).find((s) => s.def.id === 'distance')?.medal).toBe('月');
  });

  it('automation tiers follow sim minutes; negative titles count queue, late, reputation zero', () => {
    const w = createWorld({ seed: 1 });
    w.stats.fullAutomationTick = 600 * 30; // 30 分
    expect(achievementValue(w, 'automation')).toBe(3);
    w.stats.fullAutomationTick = 600 * 60;
    expect(achievementValue(w, 'automation')).toBe(2);
    w.stats.fullAutomationTick = 600 * 200;
    expect(achievementValue(w, 'automation')).toBe(1);
    for (let i = 0; i < 60; i++) w.orders.push({ ...w.orders[0], id: 1000 + i } as (typeof w.orders)[number]);
    updateAchievements(w);
    expect(w.stats.queueMax).toBeGreaterThanOrEqual(60);
    expect(w.achievements?.hoarder?.tier).toBe(1);
    w.stats.latePenalties = 1000;
    w.stats.reputationZeroCount = 5;
    updateAchievements(w);
    expect(w.achievements?.late?.tier).toBe(2);
    expect(w.achievements?.rockbottom?.tier).toBe(2);
  });

  it('reputation 100 streak is measured in calendar months', () => {
    const w = createWorld({ seed: 1 });
    w.reputation = 100;
    w.tick = 0;
    updateAchievements(w);
    w.tick = CALENDAR.ticksPerMonth * 6;
    updateAchievements(w);
    expect(achievementValue(w, 'reputation')).toBeCloseTo(6, 5);
    expect(w.achievements?.reputation?.tier).toBe(2);
    // 途切れたら最長だけ残る
    w.reputation = 90;
    updateAchievements(w);
    expect(w.stats.rep100SinceTick).toBeNull();
    expect(achievementValue(w, 'reputation')).toBeCloseTo(6, 5);
  });

  it('old saves get already-earned tiers recorded silently; the mega preset starts with scale medals', () => {
    const old = createWorld({ seed: 1 }) as unknown as Record<string, unknown>;
    delete old.achievements;
    const st = (old as { stats: Record<string, unknown> }).stats;
    delete st.travelCells;
    st.totalShipped = 1500;
    const w = migrate(old as never, 2);
    expect(w.stats.travelCells).toBe(0);
    expect(w.achievements?.shipped?.tier).toBe(1);
    expect(w.events.some((e) => e.type === 'achievement')).toBe(false);
    const m = buildPreset('mega');
    initAchievementsSilently(m);
    expect(m.achievements?.stacks?.tier).toBe(2);
    expect(m.achievements?.rank?.tier).toBe(3);
  });

  it('player profile keeps the highest tier across worlds; sandbox worlds are excluded and silent', () => {
    const profile: AchievementProfile = {};
    const a = createWorld({ seed: 1 });
    a.stats.totalShipped = 1500;
    updateAchievements(a);
    expect(mergeProfile(profile, a)).toBe(true);
    expect(profile.shipped?.tier).toBe(1);
    // 別の倉庫（記録なし）でも一覧はプレイヤーの記録を見る
    const b = createWorld({ seed: 2 });
    expect(achievementStatuses(b, profile).find((s) => s.def.id === 'shipped')?.tier).toBe(1);
    // サンドボックスのプリセットはイベントも記録も出さない
    const m = buildPreset('mega');
    expect(m.sandbox).toBe(true);
    m.events.length = 0;
    updateAchievements(m);
    expect(m.events.some((e) => e.type === 'achievement')).toBe(false);
    expect(m.achievements?.rank?.tier).toBe(3);
    expect(mergeProfile(profile, m)).toBe(false);
    expect(profile.rank).toBeUndefined();
    expect(achievementStatuses(m, profile).find((s) => s.def.id === 'shipped')?.tier).toBe(0);
  });
});
