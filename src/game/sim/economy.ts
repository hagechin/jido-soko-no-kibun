/** 報酬・評判（§9.2 / §9.3） */
import { REPUTATION, REWARD, TICKS_PER_SECOND } from '../data/balance';
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

export function rewardFor(w: WorldState, o: Order, eventMult = 1): RewardBreakdown {
  const items = orderItemCount(o);
  const leadSeconds = (w.tick - o.arrivedTick) / TICKS_PER_SECOND;
  const base = items * REWARD.coinPerItem;
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
