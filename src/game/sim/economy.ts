/** 報酬・評判（§9.2 / §9.3） */
import { REPUTATION, REWARD, TICKS_PER_SECOND } from '../data/balance';
import { activeEvents } from '../data/seasons';
import type { Order, WorldState } from './types';

export function orderItemCount(o: Order): number {
  return o.lines.reduce((a, l) => a + l.qty, 0);
}

/** スピードボーナス倍率（オーダー到着から出荷までの秒数） */
export function speedBonus(leadSeconds: number): number {
  for (const [limit, mult] of REWARD.speedBonus) {
    if (leadSeconds <= limit) return mult;
  }
  return REWARD.baseMultiplier;
}

export function reputationMultiplier(rep: number): number {
  const t = Math.min(REPUTATION.max, Math.max(REPUTATION.min, rep)) / REPUTATION.max;
  return REWARD.repMultiplierMin + (REWARD.repMultiplierMax - REWARD.repMultiplierMin) * t;
}

export interface RewardBreakdown {
  items: number;
  base: number;
  repMult: number;
  bonus: number;
  eventMult: number;
  total: number;
  leadSeconds: number;
}

/** 商品 1 個あたりの単価（ランクで上がる） */
export function coinPerItem(w: WorldState): number {
  return REWARD.coinPerItemByRank[Math.min(w.rank, REWARD.coinPerItemByRank.length - 1)];
}

export function rewardFor(w: WorldState, o: Order, eventMult = 1): RewardBreakdown {
  const items = orderItemCount(o);
  const leadSeconds = (w.tick - o.arrivedTick) / TICKS_PER_SECOND;
  const base = items * coinPerItem(w);
  const repMult = reputationMultiplier(w.reputation);
  const bonus = speedBonus(leadSeconds);
  const total = Math.round(base * repMult * bonus * eventMult);
  return { items, base, repMult, bonus, eventMult, total, leadSeconds };
}

export function changeReputation(w: WorldState, delta: number, reason: string): void {
  const before = w.reputation;
  w.reputation = Math.min(REPUTATION.max, Math.max(REPUTATION.min, w.reputation + delta));
  if (Math.round(before) !== Math.round(w.reputation)) {
    w.events.push({ type: 'repChange', delta: w.reputation - before, reason });
  }
}

export function addCoins(w: WorldState, delta: number): void {
  w.coins += delta;
  if (delta > 0) w.stats.totalCoins += delta;
}

/** オーダー出荷（§9.2）。報酬・評判・統計・イベント */
export function shipOrder(w: WorldState, o: Order, stationId: number): void {
  const idx = w.orders.indexOf(o);
  if (idx < 0) return;
  w.orders.splice(idx, 1);
  let eventMult = 1;
  for (const e of activeEvents(w.calendar.month, w.calendar.week)) eventMult *= e.rewardFactor;
  const r = rewardFor(w, o, eventMult);
  addCoins(w, r.total);
  changeReputation(w, REWARD.repGainPerShipment, '出荷');
  w.stats.totalShipped++;
  w.stats.recentShipments.push({ tick: w.tick, coins: r.total, items: r.items });
  if (w.season.cyber) {
    w.season.cyber.leadSum += r.leadSeconds;
    w.season.cyber.leadCount++;
  }
  while (w.stats.recentShipments.length > 200) w.stats.recentShipments.shift();
  for (const l of o.lines) {
    w.stats.shippedByItem[l.item] = (w.stats.shippedByItem[l.item] ?? 0) + l.qty;
    w.stats.shippedThisWeek[l.item] = (w.stats.shippedThisWeek[l.item] ?? 0) + l.qty;
  }
  w.events.push({ type: 'shipped', orderId: o.id, coins: r.total, bonus: r.bonus, stationId });
}
