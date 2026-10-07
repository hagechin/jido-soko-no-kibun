/** 倉庫ランク（§9.3）: 累計出荷数と面積で昇格。昇格でアンロック */
import { ORDERS, RANKS } from '../data/balance';
import { ITEMS } from '../data/items';
import { availableItemIds } from './orders';
import { addCoins } from './economy';
import { grantEmptyBin } from './shop';
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
  let newItems = 0;
  for (const item of afterItems) {
    if (beforeItems.includes(item) || !pickers.length) continue;
    newItems++;
    pickers.sort((a, b) => a.assignedItems.length - b.assignedItems.length);
    pickers[0].assignedItems.push(item);
  }
  // 昇格ボーナス（★）: コインと、新商品の数だけ空ビン（棚に空きがあるぶんだけ）。新商品を入荷口から取り込めずに止まるのを防ぐ
  const bonus = RANKS[Math.min(w.rank, RANKS.length - 1)].bonusCoins;
  if (bonus > 0) addCoins(w, bonus);
  let granted = 0;
  for (let i = 0; i < newItems; i++) if (grantEmptyBin(w)) granted++;
  w.events.push({ type: 'rankUp', rank: w.rank });
  if (bonus > 0 || granted) w.events.push({ type: 'notice', text: `🎉 昇格ボーナス: ${bonus > 0 ? `+${bonus} コイン` : ''}${bonus > 0 && granted ? '、' : ''}${granted ? `空ビン ${granted} 個` : ''}` });
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
