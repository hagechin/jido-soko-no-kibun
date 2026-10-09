import { limitsFor } from './limits';
import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { buyAmr, buyBinsToRecommended, buyBinsToRecommendedCost, binsToRecommended, buyEmptyBin, buyShelfRobot, freeBinSlots, maxOutRobots, recommendedBins, upgradeAllRobots, upgradeAllRobotsCost, upgradeLevels, upgradeSpeed } from './shop';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';
import { BIN, ROBOT } from '../data/balance';

describe('shop', () => {
  it('buys robots when affordable and places them on free cells', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1000;
    expect(buyShelfRobot(w)).toEqual({ ok: true });
    expect(buyAmr(w)).toEqual({ ok: true });
    expect(w.coins).toBe(1000 - ROBOT.shelfRobotCost - ROBOT.amrCost);
    const cells = w.robots.map((r) => `${r.kind}:${r.pose.x},${r.pose.z}`);
    expect(new Set(cells).size).toBe(cells.length);
  });
  it('全ロボを最大強化: 合計コインは機体ごとに 1 段ずつ上げた額と同じ。払うと全機が最大になり、その後は null', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    buyShelfRobot(w);
    buyAmr(w);
    // 1 台だけ先に速度を 1 段上げておく（残りの合計が減る）
    upgradeSpeed(w, w.robots[0].id);
    const cost = upgradeAllRobotsCost(w)!;
    expect(cost).toBeGreaterThan(0);
    let expected = 0;
    for (const r of w.robots) {
      for (let lv = r.speedLevel; lv < ROBOT.maxSpeedLevel; lv++) expected += ROBOT.speedUpgradeCosts[Math.min(lv, ROBOT.speedUpgradeCosts.length - 1)];
      if (r.kind === 'shelf') for (let lv = r.liftLevel; lv < ROBOT.maxLiftLevel; lv++) expected += ROBOT.liftUpgradeCosts[Math.min(lv, ROBOT.liftUpgradeCosts.length - 1)];
      if (r.kind === 'amr') for (let lv = r.cargoLevel; lv < limitsFor(w).maxCargoLevel; lv++) expected += ROBOT.cargoUpgradeCosts[lv];
    }
    expect(cost).toBe(expected);
    const before = w.coins;
    expect(upgradeAllRobots(w).ok).toBe(true);
    expect(w.coins).toBe(before - cost);
    for (const r of w.robots) {
      expect(r.speedLevel).toBe(ROBOT.maxSpeedLevel);
      if (r.kind === 'shelf') expect(r.liftLevel).toBe(ROBOT.maxLiftLevel);
      if (r.kind === 'amr') expect(r.cargoLevel).toBe(limitsFor(w).maxCargoLevel);
    }
    expect(upgradeAllRobotsCost(w)).toBeNull();
    expect(upgradeAllRobots(w).ok).toBe(false);
    // 1 段階ぶんも買えなければ何も変わらない
    const w2 = createWorld({ seed: 1 });
    w2.coins = 1;
    expect(upgradeAllRobots(w2).ok).toBe(false);
    expect(w2.robots.every((r) => r.speedLevel === 0)).toBe(true);
  });
  it('upgrades as far as the coins go when short, cheapest steps first, and becomes available again after adding a robot', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    expect(upgradeAllRobots(w).ok).toBe(true);
    expect(upgradeAllRobotsCost(w)).toBeNull();
    // ロボを追加すると、そのロボのぶんがまた買える
    buyAmr(w);
    const full = upgradeAllRobotsCost(w)!;
    expect(full).toBeGreaterThan(0);
    // 安い段階 2 つぶん（速度 Lv1 150 + 積載 Lv1 250）だけのコインで押す
    w.coins = ROBOT.speedUpgradeCosts[0] + ROBOT.cargoUpgradeCosts[0];
    const r = upgradeAllRobots(w);
    expect(r.ok).toBe(true);
    const added = w.robots[w.robots.length - 1];
    expect(added.speedLevel).toBe(1);
    expect(added.cargoLevel).toBe(1);
    expect(w.coins).toBe(0);
    expect(upgradeAllRobotsCost(w)).toBe(full - ROBOT.speedUpgradeCosts[0] - ROBOT.cargoUpgradeCosts[0]);
  });
  it('refuses when coins are short', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 10;
    expect(buyAmr(w).ok).toBe(false);
    expect(w.robots).toHaveLength(2);
  });
  it('speed upgrade is per robot and capped', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    const r = w.robots[0];
    for (let i = 0; i < ROBOT.maxSpeedLevel; i++) expect(upgradeSpeed(w, r.id).ok).toBe(true);
    expect(upgradeSpeed(w, r.id).ok).toBe(false);
    expect(w.robots[1].speedLevel).toBe(0);
  });
});

describe('empty bins never exceed stack slots', () => {
  it('refuses to buy a bin into a slot that a bin in transit will need', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    expect(freeBinSlots(w)).toBe(0);
    // ビンを 1 つ棚から出して運搬中にする
    const s = w.stacks[0];
    const id = s.bins.pop()!;
    w.robots[0].carrying = [id];
    expect(s.bins).toHaveLength(0);
    expect(buyEmptyBin(w).ok).toBe(false);
    upgradeLevels(w);
    expect(freeBinSlots(w)).toBe(12);
    expect(buyEmptyBin(w).ok).toBe(true);
    expect(freeBinSlots(w)).toBe(11);
    // 掘り出し用の空き（段数 2 + 棚ロボ 1 = 3 スロット）は残す
    while (buyEmptyBin(w).ok) {}
    expect(freeBinSlots(w)).toBe(3);
  });
});

describe('buy bins up to the recommended count', () => {
  it('targets 3/4 of the slots (all but the reserve at 1 level) and buys the difference, paying once', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    w.rank = 4; // 段数の解放
    const stacks = w.stacks.length;
    // 1 段: 掘り出しが無いので予約ぶん（段数 + 棚ロボ 1）以外すべて
    expect(recommendedBins(w)).toBe(stacks * 1 - (w.levels + 1));
    upgradeLevels(w);
    upgradeLevels(w);
    expect(w.levels).toBe(3);
    const rec = recommendedBins(w);
    expect(rec).toBe(Math.min(Math.floor(stacks * 3 * BIN.recommendedFillRatio), stacks * 3 - (3 + 1)));
    const need = binsToRecommended(w);
    expect(need).toBe(rec - Object.keys(w.bins).length);
    expect(need).toBeGreaterThan(0);
    expect(buyBinsToRecommendedCost(w)).toBe(need * BIN.emptyBinCost);
    const coins = w.coins;
    expect(buyBinsToRecommended(w).ok).toBe(true);
    expect(w.coins).toBe(coins - need * BIN.emptyBinCost);
    expect(Object.keys(w.bins).length).toBe(rec);
    expect(binsToRecommended(w)).toBe(0);
    expect(buyBinsToRecommendedCost(w)).toBeNull();
    expect(buyBinsToRecommended(w).ok).toBe(false);
    // 掘り出し用の空きはまだ残っている
    expect(freeBinSlots(w)).toBeGreaterThanOrEqual(w.levels + 1);
    for (const s of w.stacks) expect(s.bins.length).toBeLessThanOrEqual(w.levels);
  });

  it('refuses when coins are short and buys nothing', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    upgradeLevels(w);
    w.coins = 1;
    const before = Object.keys(w.bins).length;
    expect(binsToRecommended(w)).toBeGreaterThan(0);
    expect(buyBinsToRecommended(w).ok).toBe(false);
    expect(Object.keys(w.bins).length).toBe(before);
    expect(w.coins).toBe(1);
  });
});

describe('debug: max out robots', () => {
  it('sets every robot to max speed / lift / cargo without paying', () => {
    const w = buildPreset('medium');
    const coins = w.coins;
    const r = maxOutRobots(w);
    expect(r.upgraded).toBe(w.robots.length);
    expect(r.skipped).toBe(0);
    expect(w.coins).toBe(coins);
    for (const ro of w.robots) {
      expect(ro.speedLevel).toBe(ROBOT.maxSpeedLevel);
      if (ro.kind === 'shelf') expect(ro.liftLevel).toBe(ROBOT.maxLiftLevel);
      if (ro.kind === 'amr') expect(ro.cargoLevel).toBe(limitsFor(w).maxCargoLevel); // 通常は Lv3（4 ビン）。Lv4 は上限突破のみ
    }
    const rt = createRuntime();
    for (let t = 0; t < 600; t++) stepSim(w, rt);
    expect(w.robots.every((ro) => ro.stuckTicks < 300)).toBe(true);
  });
});
