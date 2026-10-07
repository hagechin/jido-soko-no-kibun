/** ゲーム内カレンダー（§6.1）: 1か月 = 6分、4週/月、12か月/年 */
import { CALENDAR } from '../data/balance';
import type { Calendar, WorldState } from './types';

/** 月ごとの季節アイコン（UI の Lucide アイコン名。sim は名前だけを持つ） */
export const SEASON_ICON: Record<number, 'sparkles' | 'snowflake' | 'flower' | 'flower-2' | 'leaf' | 'umbrella' | 'sun' | 'thermometer-sun' | 'ghost' | 'wind' | 'tree-pine'> = {
  1: 'sparkles',
  2: 'snowflake',
  3: 'flower',
  4: 'flower-2',
  5: 'leaf',
  6: 'umbrella',
  7: 'sun',
  8: 'thermometer-sun',
  9: 'leaf',
  10: 'ghost',
  11: 'wind',
  12: 'tree-pine',
};

export function calendarFromTick(tick: number): Calendar {
  const { ticksPerMonth, ticksPerWeek, weeksPerMonth, monthsPerYear, startMonth, startYear } = CALENDAR;
  const monthsElapsed = Math.floor(tick / ticksPerMonth);
  const totalMonthIndex = startMonth - 1 + monthsElapsed;
  const year = startYear + Math.floor(totalMonthIndex / monthsPerYear);
  const month = (totalMonthIndex % monthsPerYear) + 1;
  const week = Math.min(weeksPerMonth, Math.floor((tick % ticksPerMonth) / ticksPerWeek) + 1);
  return { tick, year, month, week };
}

export function updateCalendar(w: WorldState): { newWeek: boolean; newMonth: boolean } {
  const before = w.calendar;
  const after = calendarFromTick(w.tick);
  const newMonth = before.month !== after.month || before.year !== after.year;
  const newWeek = newMonth || before.week !== after.week;
  w.calendar = after;
  return { newWeek, newMonth };
}

export function formatDate(c: Calendar): string {
  return `${c.year}年目 ${c.month}月 第${c.week}週`;
}
