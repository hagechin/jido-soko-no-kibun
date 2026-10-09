/**
 * 放置中の進行（§10.2）。ロボを 1 台ずつ再計算せず、直近 10 分のペースからまとめて計算する。
 *  - 上限 8 時間
 *  - サイバーウィークは放置では消化しない（直前で止める）
 *  - 戻ってきたら「お留守番レポート」
 */
import { CALENDAR, INBOUND_FREQ, OFFLINE, TICKS_PER_SECOND } from '../data/balance';
import { eventById, weekIndex, activeEvents } from '../data/seasons';
import { calendarFromTick } from './calendar';
import { forecastRestock, inboundSettings } from './inbound';
import { changeReputation } from './economy';
import type { WorldState } from './types';
import { tr } from '../i18n';

export interface OfflineReport {
  /** 実際に進めた時間（ms） */
  elapsedMs: number;
  /** 上限や サイバーウィークで止めたか */
  cappedBy: 'none' | 'max' | 'cyberWeek';
  shipped: number;
  coins: number;
  stockouts: string[];
  events: string[];
  trucks: number;
}

/** 直近 10 分のペース（1 分あたり） */
export function recentPace(w: WorldState): { shipmentsPerMin: number; coinsPerMin: number; itemsPerMin: number } {
  const from = w.tick - OFFLINE.windowTicks;
  const recent = w.stats.recentShipments.filter((s) => s.tick >= from);
  const windowMin = Math.max(1, Math.min(OFFLINE.windowTicks, w.tick) / TICKS_PER_SECOND / 60);
  if (!recent.length) return { shipmentsPerMin: OFFLINE.fallbackShipmentsPerMinute, coinsPerMin: 0, itemsPerMin: 0 };
  return {
    shipmentsPerMin: recent.length / windowMin,
    coinsPerMin: recent.reduce((a, s) => a + s.coins, 0) / windowMin,
    itemsPerMin: recent.reduce((a, s) => a + s.items, 0) / windowMin,
  };
}

/** 次のサイバーウィーク開始 tick（今より後） */
export function nextCyberWeekStartTick(w: WorldState): number {
  const cw = eventById('cyberWeek');
  const startWeek = weekIndex(cw.from[0], cw.from[1]);
  const weeksPerYear = CALENDAR.monthsPerYear * CALENDAR.weeksPerMonth;
  // 今の年の開始 tick（startMonth を基準にした暦なので週番号で計算）
  const cal = w.calendar;
  const nowWeek = weekIndex(cal.month, cal.week);
  let delta = startWeek - nowWeek;
  if (delta <= 0) delta += weeksPerYear;
  const weekStartTick = w.tick - (w.tick % CALENDAR.ticksPerWeek);
  return weekStartTick + delta * CALENDAR.ticksPerWeek;
}

export function applyOffline(w: WorldState, elapsedMs: number): OfflineReport {
  let ms = Math.max(0, elapsedMs);
  let cappedBy: OfflineReport['cappedBy'] = 'none';
  if (ms > OFFLINE.maxOfflineMs) {
    ms = OFFLINE.maxOfflineMs;
    cappedBy = 'max';
  }
  let ticks = Math.floor((ms / 1000) * TICKS_PER_SECOND);
  // サイバーウィーク中／直前で止める
  const inCyber = activeEvents(w.calendar.month, w.calendar.week).some((e) => e.id === 'cyberWeek');
  if (inCyber) {
    ticks = 0;
    cappedBy = 'cyberWeek';
  } else {
    const cwStart = nextCyberWeekStartTick(w);
    if (w.tick + ticks >= cwStart) {
      ticks = Math.max(0, cwStart - 1 - w.tick);
      cappedBy = 'cyberWeek';
    }
  }
  const minutes = ticks / TICKS_PER_SECOND / 60;
  const pace = recentPace(w);
  const shipped = Math.floor(pace.shipmentsPerMin * minutes);
  const coins = Math.round(pace.coinsPerMin * minutes);
  const items = Math.floor(pace.itemsPerMin * minutes);

  const report: OfflineReport = { elapsedMs: (ticks / TICKS_PER_SECOND) * 1000, cappedBy, shipped, coins, stockouts: [], events: [], trucks: 0 };

  // 暦を進め、途中のイベントと週替わりを数える
  const startTick = w.tick;
  const startCal = w.calendar;
  const endTick = startTick + ticks;
  const seen = new Set(activeEvents(startCal.month, startCal.week).map((e) => e.id as string));
  for (let t = startTick - (startTick % CALENDAR.ticksPerWeek) + CALENDAR.ticksPerWeek; t <= endTick; t += CALENDAR.ticksPerWeek) {
    const c = calendarFromTick(t);
    report.trucks++;
    for (const e of activeEvents(c.month, c.week)) {
      if (!seen.has(e.id)) {
        seen.add(e.id);
        report.events.push(e.name);
      }
    }
  }
  // トラックの回数は設定の頻度で（週 1 以外は週数 × 週あたりの回数）
  report.trucks = Math.floor(report.trucks * INBOUND_FREQ[inboundSettings(w).freq].perWeek);
  w.tick = endTick;
  w.nextTruckTick = undefined; // 留守中のトラックはここでまとめて足すので、次の定期トラックは次の区切りから
  w.calendar = calendarFromTick(endTick);
  w.season.active = activeEvents(w.calendar.month, w.calendar.week).map((e) => e.id as string);

  // 在庫を減らす（出荷実績の比率で）。入荷はトラック回数ぶんビンに直接足す（自動補充 AI があれば）
  consumeStock(w, items, report);
  if (report.trucks > 0) {
    const restock = forecastRestock(w);
    for (const r of restock) {
      const total = r.qty * report.trucks;
      if (w.automation.restock) refill(w, r.item, total);
      else {
        const p = w.pallets.find((p) => p.item === r.item);
        if (p) p.qty += total;
        else w.pallets.push({ item: r.item, qty: total, arrivedTick: w.tick });
      }
    }
    w.stats.trucks += report.trucks;
  }

  w.coins += coins;
  w.stats.totalCoins += coins;
  w.stats.totalShipped += shipped;
  if (shipped === 0 && minutes > 5 && w.orders.length) changeReputation(w, -Math.min(10, Math.floor(minutes / 10)), tr('留守中にオーダーが溜まった'));
  // 溜まっていたオーダーは「留守中に処理された」扱いにはせず、遅延ペナルティだけ避ける
  for (const o of w.orders) {
    o.arrivedTick = w.tick;
    o.shownTick = null;
    o.penalized = false;
  }
  w.nextOrderTick = w.tick + 1;
  w.stats.recentShipments = w.stats.recentShipments.map((s) => ({ ...s, tick: w.tick - (startTick - s.tick) }));
  if (shipped > 0) {
    // ペース維持のため、留守中の出荷を窓の中に薄く記録
    const n = Math.min(shipped, 20);
    for (let i = 0; i < n; i++) w.stats.recentShipments.push({ tick: w.tick - Math.floor((OFFLINE.windowTicks * (n - i)) / (n + 1)), coins: Math.round(coins / shipped), items: Math.round(items / shipped) || 1 });
    while (w.stats.recentShipments.length > 200) w.stats.recentShipments.shift();
  }
  return report;
}

function consumeStock(w: WorldState, items: number, report: OfflineReport): void {
  if (items <= 0) return;
  const weights = new Map<string, number>();
  let total = 0;
  for (const [item, n] of Object.entries(w.stats.shippedByItem)) {
    weights.set(item, n);
    total += n;
  }
  if (!total) return;
  for (const [item, wgt] of weights) {
    let take = Math.round((items * wgt) / total);
    for (const b of Object.values(w.bins)) {
      if (take <= 0) break;
      if (b.item !== item || b.qty <= 0) continue;
      const d = Math.min(b.qty, take);
      b.qty -= d;
      take -= d;
      if (b.qty === 0) {
        b.item = null;
        w.stats.stockouts++;
      }
    }
    const still = Object.values(w.bins).some((b) => b.item === item && b.qty > 0);
    if (!still && wgt > 0) report.stockouts.push(item);
  }
}

function refill(w: WorldState, item: string, qty: number): void {
  let left = qty;
  for (const b of Object.values(w.bins)) {
    if (left <= 0) break;
    if (b.item !== item) continue;
    const d = Math.min(w.binCapacity - b.qty, left);
    b.qty += d;
    left -= d;
  }
  for (const b of Object.values(w.bins)) {
    if (left <= 0) break;
    if (b.item !== null) continue;
    b.item = item;
    const d = Math.min(w.binCapacity, left);
    b.qty = d;
    left -= d;
  }
  if (left > 0) {
    const p = w.pallets.find((p) => p.item === item);
    if (p) p.qty += left;
    else w.pallets.push({ item, qty: left, arrivedTick: w.tick });
  }
}
