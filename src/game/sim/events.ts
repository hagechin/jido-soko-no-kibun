/**
 * 年間イベントの開始／終了、サイバーウィークの予告・事前入荷・成績表（§6.3 / §6.4）。
 */
import { CYBER_WEEK_NOTICE_WEEKS, CYBER_WEEK_PRESTOCK, activeEvents, eventById, weekIndex, SEASON_EVENTS } from '../data/seasons';
import { CALENDAR } from '../data/balance';
import { forecastRestock, scheduleTruck } from './inbound';
import type { CyberWeekRecord, WorldState } from './types';

/** サイバーウィーク開始までの週数（0 = 開催中、負 = 終わった／まだ遠い） */
export function weeksUntilCyberWeek(w: WorldState): number {
  const cw = eventById('cyberWeek');
  const now = weekIndex(w.calendar.month, w.calendar.week);
  const start = weekIndex(cw.from[0], cw.from[1]);
  const end = weekIndex(cw.to[0], cw.to[1]);
  if (now >= start && now <= end) return 0;
  const diff = start - now;
  return diff > 0 ? diff : -1;
}

export function isCyberWeek(w: WorldState): boolean {
  return w.season.active.includes('cyberWeek');
}

/** 週替わりごとに呼ぶ */
export function updateEvents(w: WorldState): void {
  const nowActive = activeEvents(w.calendar.month, w.calendar.week).map((e) => e.id as string);
  const prev = w.season.active;
  for (const id of nowActive) {
    if (!prev.includes(id)) {
      const ev = SEASON_EVENTS.find((e) => e.id === id)!;
      w.events.push({ type: 'eventStart', id, banner: ev.banner });
      if (id === 'cyberWeek') startCyberWeek(w);
    }
  }
  for (const id of prev) {
    if (!nowActive.includes(id)) {
      w.events.push({ type: 'eventEnd', id });
      if (id === 'cyberWeek') endCyberWeek(w);
    }
  }
  w.season.active = nowActive;

  // 予告と事前入荷（3 週間前。年に 1 回）
  const weeks = weeksUntilCyberWeek(w);
  if (weeks > 0 && weeks <= CYBER_WEEK_NOTICE_WEEKS && w.season.cyberNoticeYear !== w.calendar.year) {
    w.season.cyberNoticeYear = w.calendar.year;
    w.events.push({ type: 'notice', icon: 'megaphone', text: `サイバーウィークまで あと${weeks}週。大型トラックが順次到着します` });
    for (let i = 0; i < CYBER_WEEK_PRESTOCK.trucks; i++) {
      const pallets = forecastRestock(w, true).map((p) => ({ item: p.item, qty: Math.round(p.qty * CYBER_WEEK_PRESTOCK.factor) }));
      scheduleTruck(w, pallets, 'prestock', Math.round(((i + 0.3) * CALENDAR.ticksPerWeek) / CYBER_WEEK_PRESTOCK.trucks) + 1);
    }
  }
}

function startCyberWeek(w: WorldState): void {
  w.season.cyber = {
    year: w.calendar.year,
    startShipped: w.stats.totalShipped,
    startCoins: w.stats.totalCoins,
    startStockouts: w.stats.stockouts,
    leadSum: 0,
    leadCount: 0,
  };
}

function endCyberWeek(w: WorldState): void {
  const c = w.season.cyber;
  if (!c) return;
  const record: CyberWeekRecord = {
    year: c.year,
    shipped: w.stats.totalShipped - c.startShipped,
    avgLeadSec: c.leadCount ? Math.round((c.leadSum / c.leadCount) * 10) / 10 : 0,
    stockouts: w.stats.stockouts - c.startStockouts,
    coins: w.stats.totalCoins - c.startCoins,
  };
  w.stats.cyberWeekRecords = w.stats.cyberWeekRecords.filter((r) => r.year !== record.year);
  w.stats.cyberWeekRecords.push(record);
  w.season.cyber = null;
  w.season.pendingReport = record;
  w.events.push({ type: 'cyberWeekReport', record });
}

/** HUD バナー用の文言。null なら非表示 */
export function bannerText(w: WorldState): string | null {
  if (isCyberWeek(w)) return eventById('cyberWeek').banner;
  const weeks = weeksUntilCyberWeek(w);
  if (weeks > 0 && weeks <= CYBER_WEEK_NOTICE_WEEKS) return `サイバーウィークまで あと${weeks}週`;
  for (const id of w.season.active) {
    const ev = SEASON_EVENTS.find((e) => e.id === id);
    if (ev) return ev.banner;
  }
  return null;
}
