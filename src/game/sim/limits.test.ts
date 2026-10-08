import { afterEach, describe, expect, it } from 'vitest';
import { LIMITS, RANKS, ROBOT } from '../data/balance';
import { expand, expansionCost } from './build';
import { limitsFor, setLimitsExpanded } from './limits';
import { buyAmr, buyShelfRobot, cargoUpgradeCost, levelUpgradeCost, maxLevelsForRank, maxOutRobots, upgradeCargo, upgradeLevels } from './shop';
import { createWorld } from './world';

afterEach(() => setLimitsExpanded(false));

function rich(): ReturnType<typeof createWorld> {
  const w = createWorld({ seed: 1 });
  w.coins = 10_000_000;
  w.rank = RANKS.length - 1;
  w.stats.totalShipped = RANKS[RANKS.length - 1].shipped;
  return w;
}

describe('上限突破（I4）', () => {
  it('通常は base、購入後は expanded', () => {
    expect(limitsFor()).toBe(LIMITS.base);
    setLimitsExpanded(true);
    expect(limitsFor()).toBe(LIMITS.expanded);
  });

  it('搬送ロボは通常 60 台で止まり、上限突破で 120 台まで買える', () => {
    const w = rich();
    // 大きな倉庫にしないと置き場所が足りない
    for (let i = 0; i < 6 && expansionCost(w) !== null; i++) expect(expand(w).ok).toBe(true);
    let n = 0;
    while (buyAmr(w).ok) n++;
    expect(w.robots.filter((r) => r.kind === 'amr').length).toBe(LIMITS.base.maxAmrs);
    const stop = buyAmr(w);
    expect(stop.ok).toBe(false);
    expect(stop.ok ? '' : stop.reason).toContain('上限 60');
    setLimitsExpanded(true);
    while (buyAmr(w).ok) n++;
    expect(w.robots.filter((r) => r.kind === 'amr').length).toBe(LIMITS.expanded.maxAmrs);
    expect(n).toBe(LIMITS.expanded.maxAmrs - 1); // 初期 1 台
  });

  it('棚ロボも同じ（40 → 80）', () => {
    const w = rich();
    for (let i = 0; i < 6 && expansionCost(w) !== null; i++) expand(w);
    while (buyShelfRobot(w).ok) {}
    const shelves = () => w.robots.filter((r) => r.kind === 'shelf').length;
    expect(shelves()).toBeLessThanOrEqual(LIMITS.base.maxShelfRobots);
    const cap = shelves();
    setLimitsExpanded(true);
    while (buyShelfRobot(w).ok) {}
    // スタックの数が足りなければそこまで。足りていれば 80
    expect(shelves()).toBeGreaterThanOrEqual(cap);
    expect(shelves()).toBeLessThanOrEqual(LIMITS.expanded.maxShelfRobots);
  });

  it('段数は通常 8 まで、最終ランク＋上限突破で 12 まで（費用が全段ぶんある）', () => {
    const w = rich();
    while (upgradeLevels(w).ok) {}
    expect(w.levels).toBe(LIMITS.base.maxLevels);
    expect(levelUpgradeCost(w)).toBeNull();
    setLimitsExpanded(true);
    expect(maxLevelsForRank(w)).toBe(LIMITS.expanded.maxLevels);
    expect(levelUpgradeCost(w)).toBeGreaterThan(0);
    while (upgradeLevels(w).ok) {}
    expect(w.levels).toBe(LIMITS.expanded.maxLevels);
    // 最終ランクでなければ従来どおりランクの段数まで
    const w2 = createWorld({ seed: 2 });
    expect(maxLevelsForRank(w2)).toBe(RANKS[0].maxLevels);
  });

  it('積載 Lv4（8 ビン）は上限突破のときだけ。ロボ MAX もそこまで', () => {
    const w = rich();
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    while (upgradeCargo(w, amr.id).ok) {}
    expect(amr.cargoLevel).toBe(LIMITS.base.maxCargoLevel);
    expect(ROBOT.cargo[amr.cargoLevel].bins).toBe(4);
    expect(cargoUpgradeCost(amr)).toBeNull();
    setLimitsExpanded(true);
    expect(cargoUpgradeCost(amr)).toBe(ROBOT.cargoUpgradeCosts[2]);
    expect(upgradeCargo(w, amr.id).ok).toBe(true);
    expect(ROBOT.cargo[amr.cargoLevel].bins).toBe(8);
    const w3 = rich();
    maxOutRobots(w3);
    expect(w3.robots.find((r) => r.kind === 'amr')!.cargoLevel).toBe(LIMITS.expanded.maxCargoLevel);
    setLimitsExpanded(false);
    const w4 = rich();
    maxOutRobots(w4);
    expect(w4.robots.find((r) => r.kind === 'amr')!.cargoLevel).toBe(LIMITS.base.maxCargoLevel);
  });

  it('倉庫は通常 40×28 まで、上限突破で 64×48 まで広げられる', () => {
    const w = rich();
    while (expansionCost(w, 'east') !== null && expand(w, 'east').ok) {}
    while (expansionCost(w, 'south') !== null && expand(w, 'south').ok) {}
    expect(w.width).toBe(LIMITS.base.maxWidth);
    expect(w.height).toBe(LIMITS.base.maxHeight);
    setLimitsExpanded(true);
    while (expansionCost(w, 'east') !== null && expand(w, 'east').ok) {}
    while (expansionCost(w, 'south') !== null && expand(w, 'south').ok) {}
    expect(w.width).toBe(LIMITS.expanded.maxWidth);
    expect(w.height).toBe(LIMITS.expanded.maxHeight);
  });
});
