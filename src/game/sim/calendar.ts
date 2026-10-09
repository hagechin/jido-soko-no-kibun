/** ゲーム内カレンダー（§6.1）: 1か月 = 6分、4週/月、12か月/年 */
import { CALENDAR } from '../data/balance';
import type { Calendar, WorldState } from './types';
import { locale, tr } from '../i18n';

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

const MONTH_EN = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** 月の表示: 日本語は数字（「4月」）、英語は略称（Apr） */
export function monthLabel(month: number): string {
  return locale() === 'en' ? (MONTH_EN[month - 1] ?? String(month)) : String(month);
}

export function formatDate(c: Calendar): string {
  return tr(tr(tr(tr(tr('{0}年目 {1}月 第{2}週')))), c.year, monthLabel(c.month), c.week);
}

/** スマホの HUD 用の短い表記（幅が足りないとき）: 3年12月1週 */
export function formatDateShort(c: Calendar): string {
  return tr(tr(tr(tr(tr('{0}年{1}月{2}週')))), c.year, monthLabel(c.month), c.week);
}
