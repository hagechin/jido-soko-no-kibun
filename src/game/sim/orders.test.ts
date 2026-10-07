import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { stepWorld } from './step';
import { backpressureFactor, generateOrder, isOrderComplete, lateLimitTicks, orderInterval, queuedCount, unblockVisible, visibleOrders } from './orders';
import { ORDERS, TICKS_PER_SECOND } from '../data/balance';
import { rewardFor, speedBonus } from './economy';

describe('orders', () => {
  it('generates orders within rank-0 limits using only the first 6 items', () => {
    const w = createWorld({ seed: 1 });
    for (let i = 0; i < 200; i++) {
      const o = generateOrder(w);
      const [lmin, lmax] = ORDERS.linesByRank[0];
      expect(o.lines.length).toBeGreaterThanOrEqual(lmin);
      expect(o.lines.length).toBeLessThanOrEqual(lmax);
      const ids = new Set(o.lines.map((l) => l.item));
      expect(ids.size).toBe(o.lines.length); // 重複なし
      for (const l of o.lines) {
        expect(l.qty).toBeGreaterThanOrEqual(ORDERS.qtyByRank[0][0]);
        expect(l.qty).toBeLessThanOrEqual(ORDERS.qtyByRank[0][1]);
      }
    }
  });

  it('orders arrive at the configured interval; at most 5 visible, rest queued', () => {
    const w = createWorld({ seed: 2 });
    const interval = orderInterval(w);
    // 4月は「新生活」イベント中（間隔 ×0.9）
    expect(interval).toBe(Math.round(ORDERS.intervalByRank[0] * 0.9));
    const until = ORDERS.firstOrderDelayTicks + interval * 7 + 1;
    for (let t = 0; t < until; t++) stepWorld(w);
    expect(w.orders.length).toBe(8);
    expect(visibleOrders(w)).toHaveLength(ORDERS.visibleMax);
    expect(queuedCount(w)).toBe(3);
    expect(visibleOrders(w).every((o) => o.shownTick !== null)).toBe(true);
    expect(w.orders[7].shownTick).toBeNull();
  });

  it('applies the late penalty once per order after 180s + 15s per line', () => {
    const w = createWorld({ seed: 3 });
    const rep0 = w.reputation;
    w.nextOrderTick = 1;
    stepWorld(w);
    stepWorld(w);
    w.nextOrderTick = 1e9; // 1件だけにする
    const o = w.orders[0];
    const limit = lateLimitTicks(o);
    expect(limit).toBe(ORDERS.latePenaltyTicks + ORDERS.latePenaltyPerLineTicks * o.lines.length);
    while (w.tick - o.arrivedTick < limit) stepWorld(w);
    expect(o.penalized).toBe(false); // 猶予内はまだ
    for (let t = 0; t < 3; t++) stepWorld(w);
    expect(o.penalized).toBe(true);
    expect(w.reputation).toBe(rep0 - ORDERS.latePenaltyRep);
  });

  it('backpressure: a long queue stretches the order interval up to the cap', () => {
    const w = createWorld({ seed: 4 });
    const base = orderInterval(w);
    expect(backpressureFactor(w)).toBe(1);
    for (let i = 0; i < ORDERS.visibleMax + ORDERS.backpressure.startAt + 10; i++) w.orders.push(generateOrder(w));
    expect(backpressureFactor(w)).toBeCloseTo(1 + 10 * ORDERS.backpressure.perOrder);
    expect(orderInterval(w)).toBe(Math.round(base * (1 + 10 * ORDERS.backpressure.perOrder)));
    for (let i = 0; i < 100; i++) w.orders.push(generateOrder(w));
    expect(backpressureFactor(w)).toBe(ORDERS.backpressure.maxFactor);
  });

  it('completion requires every line picked', () => {
    const o = { id: 1, lines: [{ item: 'apple', qty: 2, picked: 1 }], arrivedTick: 0, shownTick: 0, penalized: false };
    expect(isOrderComplete(o)).toBe(false);
    o.lines[0].picked = 2;
    expect(isOrderComplete(o)).toBe(true);
  });
});

describe('economy', () => {
  it('speed bonus tiers match the spec table', () => {
    expect(speedBonus(10)).toBe(2.0);
    expect(speedBonus(30)).toBe(2.0);
    expect(speedBonus(45)).toBe(1.5);
    expect(speedBonus(75)).toBe(1.2);
    expect(speedBonus(200)).toBe(1.0);
  });
  it('reward = items × 10 × repMult × bonus', () => {
    const w = createWorld({ seed: 4 });
    w.reputation = 100; // repMult = max (1.4)
    const o = { id: 1, lines: [{ item: 'apple', qty: 3, picked: 3 }], arrivedTick: 0, shownTick: 0, penalized: false };
    w.tick = 20 * TICKS_PER_SECOND;
    const r = rewardFor(w, o);
    expect(r.total).toBe(Math.round(3 * 10 * 1.4 * 2.0));
  });
});

describe('head-of-line blocking', () => {
  it('brings a completable queued order forward when every visible order waits for stock', () => {
    const w = createWorld({ seed: 5 });
    const mk = (id: number, item: string) => ({ id, lines: [{ item, qty: 1, picked: 0 }], arrivedTick: id, shownTick: null, penalized: false });
    for (let i = 1; i <= 5; i++) w.orders.push(mk(i, 'cake')); // ケーキは在庫なし
    w.orders.push(mk(6, 'apple'));
    expect(unblockVisible(w)).toBe(true);
    expect(visibleOrders(w).map((o) => o.id)).toEqual([6, 1, 2, 3, 4]);
    expect(w.orders).toHaveLength(6);
    // 1 件でも完了できる表示中オーダーがあれば動かさない
    expect(unblockVisible(w)).toBe(false);
  });
});
