import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { CALENDAR, ORDERS } from '../data/balance';
import { calendarFromTick } from './calendar';
import { bannerText, isCyberWeek, weeksUntilCyberWeek } from './events';
import { orderInterval } from './orders';
import { CYBER_WEEK_PRESTOCK, activeEvents } from '../data/seasons';
import type { WorldState } from './types';

/** 指定の月・週の先頭 tick（1年目） */
function tickAt(month: number, week: number): number {
  const months = month - CALENDAR.startMonth;
  return months * CALENDAR.ticksPerMonth + (week - 1) * CALENDAR.ticksPerWeek;
}

function jumpTo(w: WorldState, rt: ReturnType<typeof createRuntime>, tick: number): void {
  // 直前まで飛ばしてから数 tick 進める（週替わり処理を踏ませる）
  w.tick = tick - 2;
  w.calendar = calendarFromTick(w.tick);
  w.nextOrderTick = 1e9;
  stepMany(w, rt, 3);
}

describe('M8 seasons & cyber week (§6)', () => {
  it('yearly event table: June = rainy season, Nov W4..Dec W1 = cyber week, Dec W3-4 = christmas', () => {
    expect(activeEvents(6, 2).map((e) => e.id)).toContain('rainy');
    expect(activeEvents(11, 3).map((e) => e.id)).not.toContain('cyberWeek');
    expect(activeEvents(11, 4).map((e) => e.id)).toContain('cyberWeek');
    expect(activeEvents(12, 1).map((e) => e.id)).toContain('cyberWeek');
    expect(activeEvents(12, 2).map((e) => e.id)).not.toContain('cyberWeek');
    expect(activeEvents(12, 3).map((e) => e.id)).toContain('christmas');
    expect(activeEvents(1, 1).map((e) => e.id)).toContain('newYear');
    expect(activeEvents(5, 2)).toHaveLength(0);
  });

  it('cyber week makes orders arrive 5x faster and pays x1.5', () => {
    const w = createWorld({ seed: 1 });
    const rt = createRuntime();
    jumpTo(w, rt, tickAt(5, 1));
    const normal = orderInterval(w);
    expect(normal).toBe(ORDERS.intervalByRank[0]);
    jumpTo(w, rt, tickAt(11, 4));
    expect(isCyberWeek(w)).toBe(true);
    expect(orderInterval(w)).toBe(Math.round(normal * 0.2));
    expect(activeEvents(11, 4).find((e) => e.id === 'cyberWeek')!.rewardFactor).toBe(1.5);
    expect(bannerText(w)).toMatch(/サイバーウィーク/);
  });

  it('announces 3 weeks ahead and schedules big pre-stock trucks once', () => {
    const w = createWorld({ seed: 2 });
    const rt = createRuntime();
    jumpTo(w, rt, tickAt(11, 1));
    expect(weeksUntilCyberWeek(w)).toBe(3);
    expect(bannerText(w)).toMatch(/あと3週/);
    const prestock = w.trucks.filter((t) => t.kind === 'prestock');
    expect(prestock).toHaveLength(CYBER_WEEK_PRESTOCK.trucks);
    expect(w.season.cyberNoticeYear).toBe(w.calendar.year);
    const notice = w.events.filter((e) => e.type === 'notice' && /サイバーウィーク/.test(e.text));
    expect(notice).toHaveLength(1);
    // 次の週になっても二重に手配しない
    const before = w.trucks.length;
    jumpTo(w, rt, tickAt(11, 2));
    expect(w.trucks.filter((t) => t.kind === 'prestock').length).toBeLessThanOrEqual(before);
    expect(bannerText(w)).toMatch(/あと2週/);
  });

  it('records a report when cyber week ends and keeps yearly records', () => {
    const w = createWorld({ seed: 3 });
    const rt = createRuntime();
    jumpTo(w, rt, tickAt(11, 4));
    expect(w.season.cyber).not.toBeNull();
    // 期間中に出荷があったことにする
    w.stats.totalShipped += 7;
    w.stats.totalCoins += 900;
    w.stats.stockouts += 2;
    w.season.cyber!.leadSum = 210;
    w.season.cyber!.leadCount = 7;
    jumpTo(w, rt, tickAt(12, 2));
    expect(isCyberWeek(w)).toBe(false);
    expect(w.stats.cyberWeekRecords).toHaveLength(1);
    expect(w.stats.cyberWeekRecords[0]).toEqual({ year: 1, shipped: 7, avgLeadSec: 30, stockouts: 2, coins: 900 });
    expect(w.season.pendingReport).not.toBeNull();
    expect(w.events.some((e) => e.type === 'cyberWeekReport')).toBe(true);
  });

  it('a full year passes in 72 minutes of ticks with events firing in order', () => {
    const w = createWorld({ seed: 4 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    const seen: string[] = [];
    for (let t = 0; t < CALENDAR.ticksPerYear; t += 1) {
      stepSim(w, rt);
      for (const e of w.events) if (e.type === 'eventStart') seen.push(e.id);
      w.events = [];
      w.nextOrderTick = 1e9;
    }
    expect(w.calendar.year).toBe(2);
    // 4月開始なので「新生活」は年初（開始時）と翌年3月の 2 回
    expect(seen).toEqual(['newLife', 'rainy', 'midsummerGift', 'halloween', 'cyberWeek', 'christmas', 'newYear', 'newLife']);
  });
});
