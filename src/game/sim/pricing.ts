/**
 * 経済モード（★）: 値段・報酬・昇格条件の倍率を 1 か所で引く。
 * 難易度（受注まわり）とは別の軸で、設定でいつでも切り替えられる（切り替えた時点から値段と報酬が変わる）。
 */
import { AUTOMATION, ECONOMY_MODES, RANKS, REWARD, type EconomyId } from '../data/balance';
import type { WorldState } from './types';

export function economyOf(w: Pick<WorldState, 'economy'> | undefined): (typeof ECONOMY_MODES)[EconomyId] {
  return ECONOMY_MODES[w?.economy ?? 'standard'] ?? ECONOMY_MODES.standard;
}

/** ロボ・建設・面積拡張・段数・ビン・機体とピッカーの強化の値段 */
export function price(w: Pick<WorldState, 'economy'> | undefined, base: number): number {
  return Math.round(base * economyOf(w).costFactor);
}

/** 自動化 AI の値段 */
export function automationPrice(w: Pick<WorldState, 'economy'> | undefined, base: number): number {
  return Math.round(base * economyOf(w).automationCostFactor);
}

export function dispatchPrice(w: Pick<WorldState, 'economy'> | undefined, level: number): number {
  return automationPrice(w, AUTOMATION.dispatchCosts[Math.min(level, AUTOMATION.dispatchCosts.length - 1)]);
}

/** ランク i に昇格するのに要る累計出荷数 */
export function rankShippedAt(w: Pick<WorldState, 'economy'> | undefined, rank: number): number {
  return Math.round(RANKS[Math.min(rank, RANKS.length - 1)].shipped * economyOf(w).rankShippedFactor);
}

/** ランク i の昇格ボーナス */
export function rankBonusAt(w: Pick<WorldState, 'economy'> | undefined, rank: number): number {
  return Math.round(RANKS[Math.min(rank, RANKS.length - 1)].bonusCoins * economyOf(w).rankBonusFactor);
}

/** 商品 1 個あたりの単価（ランクで上がる。ロングランはほぼ上がらない） */
export function coinPerItemAt(w: Pick<WorldState, 'economy' | 'rank'>): number {
  const table = economyOf(w).coinPerItemByRank ?? REWARD.coinPerItemByRank;
  return table[Math.min(w.rank, table.length - 1)];
}
