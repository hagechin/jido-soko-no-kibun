import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { backpressureFactor, generateOrder, lateLimitTicks, orderInterval, difficultyOf } from './orders';
import { rewardFor } from './economy';
import { deserialize, serialize } from './save';
import { DIFFICULTY, DIFFICULTY_ORDER, ORDERS, SAVE } from '../data/balance';
import { createRuntime, stepSim } from './sim';

describe('difficulty (orders only, switchable mid-game)', () => {
  it('harder = more customers, weaker backpressure, shorter grace, bigger penalty, better pay', () => {
    const w = createWorld({ seed: 1 });
    expect(w.difficulty).toBe('normal');
    const intervals: number[] = [];
    const limits: number[] = [];
    const pays: number[] = [];
    const o = generateOrder(w);
    for (const d of DIFFICULTY_ORDER) {
      w.difficulty = d;
      intervals.push(orderInterval(w));
      limits.push(lateLimitTicks(o, w));
      pays.push(rewardFor(w, o).total);
    }
    for (let i = 1; i < intervals.length; i++) {
      expect(intervals[i]).toBeLessThan(intervals[i - 1]);
      expect(limits[i]).toBeLessThan(limits[i - 1]);
      expect(pays[i]).toBeGreaterThanOrEqual(pays[i - 1]);
    }
    // 受注抑制: キュー 20 件のとき
    for (let i = 0; i < ORDERS.visibleMax + 20; i++) w.orders.push(generateOrder(w));
    w.difficulty = 'easy';
    expect(backpressureFactor(w)).toBe(DIFFICULTY.easy.backpressure.maxFactor);
    w.difficulty = 'normal';
    expect(backpressureFactor(w)).toBe(DIFFICULTY.normal.backpressure.maxFactor);
    w.difficulty = 'hard';
    expect(backpressureFactor(w)).toBeCloseTo(Math.min(DIFFICULTY.hard.backpressure.maxFactor, 1 + 12 * DIFFICULTY.hard.backpressure.perOrder));
    w.difficulty = 'superhard';
    expect(backpressureFactor(w)).toBe(1); // 抑制なし
  });

  it('old saves load as normal; the chosen difficulty round-trips', () => {
    const w = createWorld({ seed: 2 });
    w.difficulty = 'hard';
    const text = serialize(w);
    const back = deserialize(text);
    expect(back.ok && back.world.difficulty).toBe('hard');
    const old = JSON.parse(text);
    old.version = SAVE.version - 1;
    delete old.world.difficulty;
    const migrated = deserialize(JSON.stringify(old));
    expect(migrated.ok && migrated.world.difficulty).toBe('normal');
    expect(difficultyOf({ ...w, difficulty: 'bogus' as never }).name).toBe('ノーマル');
  });

  it('changing difficulty mid-game only changes future orders', () => {
    const w = createWorld({ seed: 3 });
    const rt = createRuntime();
    for (let t = 0; t < 600; t++) stepSim(w, rt);
    const snapshot = JSON.stringify({ bins: w.bins, robots: w.robots, stacks: w.stacks });
    w.difficulty = 'superhard';
    expect(JSON.stringify({ bins: w.bins, robots: w.robots, stacks: w.stacks })).toBe(snapshot);
    const before = w.orders.length;
    for (let t = 0; t < 600; t++) stepSim(w, rt);
    expect(w.orders.length).toBeGreaterThan(before);
  });
});
