/**
 * ★ サイバーウィークの事前入荷（3 週間前から大型トラック）で出荷が何週間も止まった件の回帰テスト。
 * 原因: 入荷ビンが大量に出ると、搬送ロボが全員「一番近い入荷ステーション」の列に並び（ピックのビンを抱えたまま）、ピックステーションが空いた。
 * 対策: 入荷専任の搬送ロボは入荷ステーションの能力まで、残りはピックのビンを先に、入荷ステーションは空いているところへ、順番待ち中は空いた別の入荷ステーションへ。
 */
import { describe, expect, it } from 'vitest';
import { CALENDAR } from '../data/balance';
import { calendarFromTick } from './calendar';
import { updateEvents } from './events';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';

describe('サイバーウィークの事前入荷', () => {
  it('メガDC（全自動）で 10月3週 から 7 週間、どの週も出荷が止まらず、評判が保たれる', () => {
    const w = buildPreset('mega', { seed: 20261008 });
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'balanced', lastRetrieveTick: 0 };
    const rt = createRuntime();
    const c = w.calendar;
    const yearStart = w.tick - (((c.month - CALENDAR.startMonth + 12) % 12) * CALENDAR.ticksPerMonth + (c.week - 1) * CALENDAR.ticksPerWeek + (w.tick % CALENDAR.ticksPerWeek));
    const t = yearStart + (((10 - CALENDAR.startMonth + 12) % 12) * CALENDAR.ticksPerMonth + 2 * CALENDAR.ticksPerWeek);
    w.tick = t;
    w.calendar = calendarFromTick(t);
    w.nextOrderTick = t + 1;
    updateEvents(w);
    const perWeek: number[] = [];
    let last = w.stats.totalShipped;
    let lastWeek = w.calendar.week;
    let maxDock = 0;
    for (let i = 0; i < CALENDAR.ticksPerWeek * 7; i++) {
      stepSim(w, rt);
      w.events.length = 0;
      maxDock = Math.max(maxDock, w.pallets.reduce((a, p) => a + p.qty, 0));
      if (w.calendar.week !== lastWeek) {
        perWeek.push(w.stats.totalShipped - last);
        last = w.stats.totalShipped;
        lastWeek = w.calendar.week;
      }
    }
    expect(maxDock).toBeGreaterThan(1000); // 事前入荷は来ている
    // 以前は 11月2週〜12月1週 の 4 週間が 0 件だった
    for (const n of perWeek.slice(1)) expect(n).toBeGreaterThan(0);
    expect(w.reputation).toBeGreaterThan(90);
    expect(w.pallets.reduce((a, p) => a + p.qty, 0)).toBeLessThan(500); // 入荷口もさばけている
  });
});
