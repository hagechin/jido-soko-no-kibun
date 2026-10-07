/** 倉庫ランク（§9.3）: 累計出荷数と面積で昇格。昇格でアンロック */
import { ORDERS, RANKS } from '../data/balance';
import { ITEMS } from '../data/items';
import { availableItemIds } from './orders';
import type { WorldState } from './types';

export function rankName(w: WorldState): string {
  return RANKS[Math.min(w.rank, RANKS.length - 1)].name;
}

export function nextRankRequirement(w: WorldState): { shipped: number; area: number } | null {
  const next = RANKS[w.rank + 1];
  return next ? { shipped: next.shipped, area: next.area } : null;
}

export function checkRankUp(w: WorldState): boolean {
  const next = RANKS[w.rank + 1];
  if (!next) return false;
  const area = w.width * w.height;
  if (w.stats.totalShipped < next.shipped || area < next.area) return false;
  const beforeItems = availableItemIds(w);
  w.rank++;
  const afterItems = availableItemIds(w);
  // 新商品はピッカーに均等に割り当てる（★）
  const pickers = w.stations.filter((s) => s.kind === 'pick');
  for (const item of afterItems) {
    if (beforeItems.includes(item) || !pickers.length) continue;
    pickers.sort((a, b) => a.assignedItems.length - b.assignedItems.length);
    pickers[0].assignedItems.push(item);
  }
  w.events.push({ type: 'rankUp', rank: w.rank });
  return true;
}

/** 昇格で解放されたもの（表示用） */
export function unlockSummary(w: WorldState): string[] {
  const r = RANKS[Math.min(w.rank, RANKS.length - 1)];
  const prev = RANKS[Math.max(0, w.rank - 1)];
  const out: string[] = [];
  if (r.maxLevels > prev.maxLevels) out.push(`棚の段数 最大 ${r.maxLevels} 段`);
  if (r.maxExpansions > prev.maxExpansions) out.push(`面積拡張 ${r.maxExpansions >= 99 ? '無制限' : `${r.maxExpansions} 回まで`}`);
  const kinds = availableItemIds(w).length;
  out.push(`商品 ${kinds} 種類（新商品: ${availableItemIds(w)
    .slice(-Math.max(0, kinds - (w.rank ? availableItemIdsAt(w.rank - 1) : 0)))
    .map((id) => ITEMS.find((i) => i.id === id)?.name)
    .join('・')}）`);
  return out;
}

function availableItemIdsAt(rank: number): number {
  return ORDERS.itemKindsByRank[Math.min(rank, ORDERS.itemKindsByRank.length - 1)];
}
