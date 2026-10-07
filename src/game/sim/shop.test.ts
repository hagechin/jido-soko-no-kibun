import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { buyAmr, buyEmptyBin, buyShelfRobot, freeBinSlots, maxOutRobots, upgradeLevels, upgradeSpeed } from './shop';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';
import { ROBOT } from '../data/balance';

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
      if (ro.kind === 'amr') expect(ro.cargoLevel).toBe(ROBOT.cargo.length - 1);
    }
    const rt = createRuntime();
    for (let t = 0; t < 600; t++) stepSim(w, rt);
    expect(w.robots.every((ro) => ro.stuckTicks < 300)).toBe(true);
  });
});
