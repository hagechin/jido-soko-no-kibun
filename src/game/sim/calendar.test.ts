import { describe, expect, it } from 'vitest';
import { calendarFromTick } from './calendar';
import { CALENDAR } from '../data/balance';

describe('calendar', () => {
  it('starts at year 1 month startMonth week 1', () => {
    const c = calendarFromTick(0);
    expect(c).toMatchObject({ year: 1, month: CALENDAR.startMonth, week: 1 });
  });
  it('one month = 6 minutes = 3600 ticks, one year = 72 minutes', () => {
    expect(CALENDAR.ticksPerMonth).toBe(3600);
    expect(CALENDAR.ticksPerYear).toBe(43200);
    const c = calendarFromTick(CALENDAR.ticksPerMonth);
    expect(c.month).toBe(CALENDAR.startMonth + 1);
    const y = calendarFromTick(CALENDAR.ticksPerYear);
    expect(y).toMatchObject({ year: 2, month: CALENDAR.startMonth, week: 1 });
  });
  it('weeks advance every 900 ticks and wrap at 4', () => {
    expect(calendarFromTick(899).week).toBe(1);
    expect(calendarFromTick(900).week).toBe(2);
    expect(calendarFromTick(3599).week).toBe(4);
    expect(calendarFromTick(3600).week).toBe(1);
  });
  it('wraps december to january of next year', () => {
    const monthsToDec = 12 - CALENDAR.startMonth; // 4月→12月
    const c = calendarFromTick(CALENDAR.ticksPerMonth * (monthsToDec + 1));
    expect(c).toMatchObject({ year: 2, month: 1 });
  });
});
