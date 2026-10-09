/** 倉庫ランク（§9.3）: 累計出荷数と面積で昇格。昇格でアンロック */
import { ORDERS, RANKS } from '../data/balance';
import { ITEMS } from '../data/items';
import { availableItemIds } from './orders';
import { addCoins } from './economy';
import { grantEmptyBin } from './shop';
import { rankBonusAt, rankShippedAt } from './pricing';
import type { WorldState } from './types';
import { tr } from '../i18n';

export function rankName(w: WorldState): string {
  return RANKS[Math.min(w.rank, RANKS.length - 1)].name;
}

export function nextRankRequirement(w: WorldState): { shipped: number; area: number } | null {
  const next = RANKS[w.rank + 1];
  return next ? { shipped: rankShippedAt(w, w.rank + 1), area: next.area } : null;
}

export function checkRankUp(w: WorldState): boolean {
  const next = RANKS[w.rank + 1];
  if (!next) return false;
  const area = w.width * w.height;
  if (w.stats.totalShipped < rankShippedAt(w, w.rank + 1) || area < next.area) return false;
  const beforeItems = availableItemIds(w);
  w.rank++;
  const afterItems = availableItemIds(w);
  // 新商品はピッカーに均等に割り当てる（★）
  const pickers = w.stations.filter((s) => s.kind === 'pick');
  let newItems = 0;
  for (const item of afterItems) {
    if (beforeItems.includes(item) || !pickers.length) continue;
    newItems++;
    pickers.sort((a, b) => a.assignedItems.length - b.assignedItems.length);
    pickers[0].assignedItems.push(item);
  }
  // 昇格ボーナス（★）: コインと、新商品の数だけ空ビン（棚に空きがあるぶんだけ）。新商品を入荷口から取り込めずに止まるのを防ぐ
  const bonus = rankBonusAt(w, w.rank);
  if (bonus > 0) addCoins(w, bonus);
  let granted = 0;
  for (let i = 0; i < newItems; i++) if (grantEmptyBin(w)) granted++;
  w.events.push({ type: 'rankUp', rank: w.rank });
  if (bonus > 0 || granted) w.events.push({ type: 'notice', icon: 'party', text: tr(tr(tr(tr(tr(tr('昇格ボーナス: {0}{1}{2}'))))), bonus > 0 ? tr(tr(tr(tr(tr(tr('+{0} コイン'))))), bonus) : '', bonus > 0 && granted ? '、' : '', granted ? tr(tr(tr(tr(tr(tr('空ビン {0} 個'))))), granted) : '') });
  return true;
}

/** 昇格で解放されたもの（表示用） */
export function unlockSummary(w: WorldState): string[] {
  const r = RANKS[Math.min(w.rank, RANKS.length - 1)];
  const prev = RANKS[Math.max(0, w.rank - 1)];
  const out: string[] = [];
  if (r.maxLevels > prev.maxLevels) out.push(tr(tr(tr(tr(tr(tr('棚の段数 最大 {0} 段'))))), r.maxLevels));
  if (r.maxExpansions > prev.maxExpansions) out.push(tr(tr(tr(tr(tr(tr('面積拡張 {0}'))))), r.maxExpansions >= 99 ? tr(tr(tr(tr(tr(tr('無制限')))))) : tr(tr(tr(tr(tr(tr('{0} 回まで'))))), r.maxExpansions)));
  const kinds = availableItemIds(w).length;
  out.push(tr(tr(tr(tr(tr(tr('商品 {0} 種類（新商品: {1}）'))))), kinds, availableItemIds(w)
    .slice(-Math.max(0, kinds - (w.rank ? availableItemIdsAt(w.rank - 1) : 0)))
    .map((id) => ITEMS.find((i) => i.id === id)?.name)
    .join(tr(tr(tr(tr(tr(tr('・')))))))));
  return out;
}

function availableItemIdsAt(rank: number): number {
  return ORDERS.itemKindsByRank[Math.min(rank, ORDERS.itemKindsByRank.length - 1)];
}
