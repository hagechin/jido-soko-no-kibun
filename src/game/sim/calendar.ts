/** ゲーム内カレンダー（§6.1）: 1か月 = 6分、4週/月、12か月/年 */
import { CALENDAR } from '../data/balance';
import type { Calendar, WorldState } from './types';

export const SEASON_ICON: Record<number, string> = {
  1: '🎍',
  2: '⛄',
  3: '🌸',
  4: '🌸',
  5: '🌿',
  6: '☔',
  7: '🌻',
  8: '🌞',
  9: '🍁',
  10: '🎃',
  11: '🍂',
  12: '🎄',
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
