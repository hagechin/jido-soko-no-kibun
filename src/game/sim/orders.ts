/** オーダー生成・表示・キュー（§2.4 / §9.1） */
import { DIFFICULTY, ORDERS, TICKS_PER_SECOND } from '../data/balance';
import { ITEMS } from '../data/items';
import { activeEvents, demandFor, type SeasonEvent } from '../data/seasons';
import { changeReputation } from './economy';
import { rand, randInt } from './rng';
import type { Order, WorldState } from './types';
import { tr } from '../i18n';

export function availableItemIds(w: WorldState): string[] {
  const kinds = ORDERS.itemKindsByRank[Math.min(w.rank, ORDERS.itemKindsByRank.length - 1)];
  return ITEMS.slice(0, kinds).map((i) => i.id);
}

export function currentEvents(w: WorldState): SeasonEvent[] {
  return activeEvents(w.calendar.month, w.calendar.week);
}

/** 現在の到着間隔（tick）。ランクとイベントで変わる */
export function orderInterval(w: WorldState): number {
  const base = ORDERS.intervalByRank[Math.min(w.rank, ORDERS.intervalByRank.length - 1)];
  let f = difficultyOf(w).intervalFactor;
  for (const e of currentEvents(w)) f *= e.intervalFactor;
  return Math.max(TICKS_PER_SECOND, Math.round(base * f * reputationDemandFactor(w) * backpressureFactor(w)));
}

/** 難易度の設定（古いセーブや不正値はノーマル） */
export function difficultyOf(w: WorldState) {
  return DIFFICULTY[w.difficulty] ?? DIFFICULTY.normal;
}

/** 評判による客の増減（★）: 評判 100 で 0.7 倍の間隔（客が多い）、評判 0 で 1.3 倍、50 で 1 倍 */
export function reputationDemandFactor(w: WorldState): number {
  const d = ORDERS.reputationDemand;
  const t = Math.min(100, Math.max(0, w.reputation)) / 100;
  return d.maxFactor - (d.maxFactor - d.minFactor) * t;
}

/** 受注の抑制（★）: キューが長いほど次のオーダーが来るまでの間隔が伸びる（1 = 抑制なし） */
export function backpressureFactor(w: WorldState): number {
  const bp = difficultyOf(w).backpressure;
  const over = Math.max(0, queuedCount(w) - bp.startAt);
  return Math.min(bp.maxFactor, 1 + over * bp.perOrder);
}

/** 遅れの計測開始: 表示枠に入った時刻（キューで待っていた時間は数えない。受注抑制と合わせて評判の底割れを防ぐ ★） */
export function lateClockStart(o: Order): number {
  return o.shownTick ?? o.arrivedTick;
}

/** このオーダーが「遅れ」になるまでの猶予（tick）。行数が多いほど長い */
export function lateLimitTicks(o: Order, w?: WorldState): number {
  const grace = w ? difficultyOf(w).lateGraceFactor : 1;
  return Math.round((ORDERS.latePenaltyTicks + ORDERS.latePenaltyPerLineTicks * o.lines.length) * grace);
}

/** 商品の重み（季節需要 × イベント強調） */
export function itemWeight(w: WorldState, itemId: string): number {
  let weight = demandFor(itemId, w.calendar.month);
  const def = ITEMS.find((i) => i.id === itemId)!;
  for (const e of currentEvents(w)) {
    weight *= e.boostCategories?.[def.category] ?? 1;
    weight *= e.boostItems?.[itemId] ?? 1;
  }
  return weight;
}

export function generateOrder(w: WorldState): Order {
  const rank = Math.min(w.rank, ORDERS.linesByRank.length - 1);
  const ids = availableItemIds(w);
  let linesFactor = 1;
  for (const e of currentEvents(w)) linesFactor *= e.linesFactor;
  const [lmin, lmax] = ORDERS.linesByRank[rank];
  const [qmin, qmax] = ORDERS.qtyByRank[rank];
  let lineCount = Math.round(randInt(w.rng, lmin, lmax) * linesFactor);
  lineCount = Math.max(1, Math.min(ORDERS.maxLinesPerOrder, ids.length, lineCount));

  // 重み付きで重複なく選ぶ
  const pool = ids.map((id) => ({ id, wgt: itemWeight(w, id) }));
  const lines: Order['lines'] = [];
  for (let i = 0; i < lineCount && pool.length; i++) {
    const total = pool.reduce((a, p) => a + p.wgt, 0);
    let r = rand(w.rng) * total;
    let idx = 0;
    for (; idx < pool.length - 1; idx++) {
      r -= pool[idx].wgt;
      if (r <= 0) break;
    }
    const [chosen] = pool.splice(idx, 1);
    lines.push({ item: chosen.id, qty: randInt(w.rng, qmin, qmax), picked: 0 });
  }
  return { id: w.nextIds.order++, lines, arrivedTick: w.tick, shownTick: null, penalized: false };
}

export function visibleOrders(w: WorldState): Order[] {
  return w.orders.slice(0, ORDERS.visibleMax);
}

export function queuedCount(w: WorldState): number {
  return Math.max(0, w.orders.length - ORDERS.visibleMax);
}

export function isOrderComplete(o: Order): boolean {
  return o.lines.every((l) => l.picked >= l.qty);
}

/** 毎 tick: 到着・表示枠の更新・遅延／キュー超過のペナルティ */
export function updateOrders(w: WorldState): void {
  if (w.tick >= w.nextOrderTick) {
    const o = generateOrder(w);
    w.orders.push(o);
    w.events.push({ type: 'orderArrived', orderId: o.id });
    w.nextOrderTick = w.tick + orderInterval(w);
  }
  for (const o of visibleOrders(w)) {
    if (o.shownTick === null) o.shownTick = w.tick;
    // 欠品で止まった（在庫ゼロの行がある）オーダーを 1 回だけ数える（サイバーウィークの成績表・実績「欠品王」）
    if (!o.stockout && w.tick % ORDERS.unblockCheckTicks === 0 && o.lines.some((l) => l.picked < l.qty && !itemInStock(w, l.item))) {
      o.stockout = true;
      w.stats.stockouts++;
    }
    if (!o.penalized && w.tick - lateClockStart(o) > lateLimitTicks(o, w)) {
      o.penalized = true;
      w.stats.latePenalties++;
      changeReputation(w, -difficultyOf(w).latePenaltyRep, tr('出荷が遅れた'));
    }
  }
  if (queuedCount(w) > difficultyOf(w).queuePenaltyThreshold && w.tick % ORDERS.queuePenaltyIntervalTicks === 0) {
    changeReputation(w, -1, tr('オーダーが溜まりすぎ'));
  }
  if (w.tick % ORDERS.unblockCheckTicks === 0) unblockVisible(w);
}

/**
 * 表示中の 5 件がすべて欠品待ちで、キューに在庫だけで完了できるオーダーがあれば先頭に出す（★）。
 * 欠品待ちのオーダーは消えず（キャンセルされない）、キューの先頭で待つ。
 */
export function unblockVisible(w: WorldState): boolean {
  const visible = visibleOrders(w);
  if (visible.length < ORDERS.visibleMax || w.orders.length <= ORDERS.visibleMax) return false;
  const inStock = new Set<string>();
  for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) inStock.add(b.item);
  const blocked = (o: Order) => o.lines.some((l) => l.picked < l.qty && !inStock.has(l.item));
  if (!visible.every(blocked)) return false;
  const idx = w.orders.findIndex((o, i) => i >= ORDERS.visibleMax && !blocked(o));
  if (idx < 0) return false;
  const [o] = w.orders.splice(idx, 1);
  w.orders.unshift(o);
  w.events.push({ type: 'notice', icon: 'info', text: tr('#{0} を先に処理します（表示中のオーダーが全部欠品待ちのため）', o.id) });
  return true;
}

/** 商品が倉庫内のどこかに在庫として存在するか（欠品判定 §2.4） */
export function itemInStock(w: WorldState, itemId: string): boolean {
  for (const b of Object.values(w.bins)) if (b.item === itemId && b.qty > 0) return true;
  return false;
}

/** 表示中オーダー全体で、この商品の未ピック数（バッチピッキング用 §5.1） */
export function neededAcrossVisible(w: WorldState, itemId: string): number {
  let n = 0;
  for (const o of visibleOrders(w)) for (const l of o.lines) if (l.item === itemId) n += Math.max(0, l.qty - l.picked);
  return n;
}
