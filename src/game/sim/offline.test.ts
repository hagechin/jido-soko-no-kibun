import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { applyOffline, nextCyberWeekStartTick, recentPace } from './offline';
import { CALENDAR, OFFLINE, TICKS_PER_SECOND } from '../data/balance';
import { calendarFromTick } from './calendar';

function withPace(w: ReturnType<typeof createWorld>, perMin: number, coinsEach = 40, itemsEach = 2) {
  w.tick = OFFLINE.windowTicks;
  w.calendar = calendarFromTick(w.tick);
  const n = perMin * 10;
  for (let i = 0; i < n; i++) w.stats.recentShipments.push({ tick: Math.floor((i / n) * OFFLINE.windowTicks), coins: coinsEach, items: itemsEach });
  w.stats.shippedByItem = { apple: 50, book: 50 };
}

describe('M10 offline progress (§10.2)', () => {
  it('computes pace from the last 10 minutes', () => {
    const w = createWorld({ seed: 1 });
    withPace(w, 3);
    const p = recentPace(w);
    expect(p.shipmentsPerMin).toBeCloseTo(3, 5);
    expect(p.coinsPerMin).toBeCloseTo(120, 5);
  });

  it('applies shipments, coins and stock consumption for the elapsed time', () => {
    const w = createWorld({ seed: 2 });
    withPace(w, 2);
    const coins0 = w.coins;
    const tick0 = w.tick;
    const r = applyOffline(w, 30 * 60_000); // 30 分
    expect(r.cappedBy).toBe('none');
    expect(r.shipped).toBe(60);
    expect(r.coins).toBe(60 * 40);
    expect(w.coins).toBe(coins0 + 2400);
    expect(w.tick).toBe(tick0 + 30 * 60 * TICKS_PER_SECOND);
    expect(w.stats.totalShipped).toBe(60);
    // 在庫（りんご・本 各 20）は 120 個の出荷で尽きる → 欠品
    expect(r.stockouts).toEqual(expect.arrayContaining(['apple', 'book']));
    expect(r.trucks).toBe(20); // 30 分 = 20 週
  });

  it('never advances more than 8 hours (1 year = 72 min, so cyber week always stops it first)', () => {
    const w = createWorld({ seed: 3 });
    withPace(w, 1);
    const tick0 = w.tick;
    const r = applyOffline(w, 20 * 3600_000);
    expect(['max', 'cyberWeek']).toContain(r.cappedBy);
    expect(w.tick - tick0).toBeLessThanOrEqual(8 * 3600 * TICKS_PER_SECOND);
    expect(w.tick - tick0).toBeLessThan(CALENDAR.ticksPerYear);
  });

  it('stops right before cyber week and does not consume it', () => {
    const w = createWorld({ seed: 4 });
    withPace(w, 1);
    const cw = nextCyberWeekStartTick(w);
    expect(calendarFromTick(cw)).toMatchObject({ month: 11, week: 4 });
    const r = applyOffline(w, 8 * 3600_000);
    expect(r.cappedBy).toBe('cyberWeek');
    expect(w.tick).toBe(cw - 1);
    expect(calendarFromTick(w.tick)).toMatchObject({ month: 11, week: 3 });
    // サイバーウィーク中に戻ってきたら 1 tick も進めない
    w.tick = cw + 5;
    w.calendar = calendarFromTick(w.tick);
    const r2 = applyOffline(w, 3600_000);
    expect(r2.cappedBy).toBe('cyberWeek');
    expect(w.tick).toBe(cw + 5);
  });

  it('lists season events that happened while away', () => {
    const w = createWorld({ seed: 5 });
    withPace(w, 1);
    const r = applyOffline(w, 3 * CALENDAR.ticksPerMonth * 100); // 4月→7月 (18分)
    expect(r.events).toContain('梅雨');
    expect(r.events).toContain('お中元');
  });
});
