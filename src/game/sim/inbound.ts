/**
 * 入荷（§5.2 / §6.2）。週 1 回トラックが来て、入荷口にパレット（商品の山）を積む。
 * 内容は「先週の出荷実績 × 係数 + 来月の需要予測」から自動で決まる。
 */
import { CALENDAR, INBOUND_FREQ, INBOUND_LOAD, INBOUND_WORKER, TICKS_PER_SECOND, type InboundFreqId, type InboundLoadId } from '../data/balance';
import { demandFor } from '../data/seasons';
import { availableItemIds } from './orders';
import type { Truck, WorldState } from './types';

/** トラック到着までの遅れ（演出）★ */
const TRUCK_DELAY_TICKS = 3 * TICKS_PER_SECOND;

/** 入荷トラックの設定（古いセーブは週 1・標準） */
export function inboundSettings(w: WorldState): { freq: InboundFreqId; load: InboundLoadId } {
  return { freq: w.inbound?.freq ?? 'weekly', load: w.inbound?.load ?? 'standard' };
}

/** 定期トラックの間隔（tick） */
export function truckPeriodTicks(w: WorldState): number {
  return Math.round(CALENDAR.ticksPerWeek / INBOUND_FREQ[inboundSettings(w).freq].perWeek);
}

/** 次の定期トラックを手配する tick（間隔の区切りで来る: 週 1 なら週の初め、月 1 なら月の初め） */
export function nextTruckTick(w: WorldState): number {
  if (w.nextTruckTick === undefined) {
    const period = truckPeriodTicks(w);
    w.nextTruckTick = (Math.floor(w.tick / period) + 1) * period;
  }
  return w.nextTruckTick;
}

/** 入荷トラックの設定を変える（次のトラックは新しい間隔の区切りから） */
export function setInbound(w: WorldState, next: Partial<{ freq: InboundFreqId; load: InboundLoadId }>): void {
  w.inbound = { ...inboundSettings(w), ...next };
  w.nextTruckTick = undefined;
}

/**
 * 入荷量の倍率。在庫の目標（これ以上あれば入荷しない）に掛かる。「倉庫いっぱい」は全ビンの fillShare ぶんを在庫で埋める目標
 * （倉庫を広げてビンを増やすほど伸びる。最低は標準と同じ）
 */
export function stockTargetFactor(w: WorldState): number {
  const f = INBOUND_LOAD[inboundSettings(w).load].factor;
  if (f !== null) return f;
  const kinds = Math.max(1, availableItemIds(w).length);
  const bins = Object.keys(w.bins).length;
  const perItem = (bins * INBOUND_WORKER.fillShare) / kinds / INBOUND_WORKER.skipRestockStockBins;
  return Math.max(1, perItem);
}

/** 1 回のトラックの量の倍率（在庫の目標の倍率を maxLoadFactor で頭打ち。入荷口の山を際限なく大きくしない） */
export function truckLoadFactor(w: WorldState): number {
  return Math.min(INBOUND_WORKER.maxLoadFactor, stockTargetFactor(w));
}

/** 入荷を止める在庫数（1 商品あたり） */
export function restockStockCap(w: WorldState): number {
  return w.binCapacity * INBOUND_WORKER.skipRestockStockBins * stockTargetFactor(w);
}

export function stockOf(w: WorldState, item: string): number {
  let n = 0;
  for (const b of Object.values(w.bins)) if (b.item === item) n += b.qty;
  return n;
}

/**
 * 定期入荷の内容（§6.2）。在庫が十分ある商品は来ない。ignoreStock = true で事前入荷（サイバーウィーク）用（設定の頻度・積載量は掛けない）。
 * 1 回の量は「週 1 の量 × 頻度の間隔（週数）× 積載量の倍率」
 */
export function forecastRestock(w: WorldState, ignoreStock = false): { item: string; qty: number }[] {
  const nextMonth = (w.calendar.month % 12) + 1;
  const out: { item: string; qty: number }[] = [];
  const scale = ignoreStock ? 1 : truckLoadFactor(w) / INBOUND_FREQ[inboundSettings(w).freq].perWeek;
  const stockCap = restockStockCap(w);
  for (const item of availableItemIds(w)) {
    if (!ignoreStock && stockOf(w, item) >= stockCap) continue;
    // 入荷口にまだ山が残っている商品は送らない（詰め込みが追いつかないのに際限なく積み上がるのを防ぐ）
    if (!ignoreStock && (w.pallets.find((p) => p.item === item)?.qty ?? 0) >= w.binCapacity * INBOUND_WORKER.skipRestockDockBins) continue;
    const shipped = w.stats.shippedLastWeek[item] ?? 0;
    const forecast = demandFor(item, nextMonth) * INBOUND_WORKER.forecastBase;
    const weekly = Math.max(INBOUND_WORKER.minRestockPerItem, Math.min(INBOUND_WORKER.maxRestockPerItem, shipped * INBOUND_WORKER.restockFactor + forecast));
    const qty = Math.max(1, Math.round(weekly * scale));
    out.push({ item, qty });
  }
  return out;
}

export function scheduleTruck(w: WorldState, pallets: { item: string; qty: number }[], kind: Truck['kind'] = 'weekly', delay = TRUCK_DELAY_TICKS): void {
  w.trucks.push({ arriveTick: w.tick + delay, pallets, kind });
}

/** 週替わり処理: 先週の実績を確定する（トラックの手配は updateInbound が間隔ごとに行う） */
export function onNewWeek(w: WorldState): void {
  w.stats.shippedLastWeek = { ...w.stats.shippedThisWeek };
  w.stats.shippedThisWeek = {};
}

/** 毎 tick: 間隔ごとに定期トラックを手配し、到着したトラックの荷を入荷口に積む */
export function updateInbound(w: WorldState): void {
  if (w.tick >= nextTruckTick(w)) {
    const period = truckPeriodTicks(w);
    w.nextTruckTick = (Math.floor(w.tick / period) + 1) * period;
    for (let i = 0; i < INBOUND_WORKER.trucksPerWeek; i++) {
      const pallets = forecastRestock(w);
      if (pallets.length) scheduleTruck(w, pallets);
    }
  }
  if (!w.trucks.length) return;
  const arrived = w.trucks.filter((t) => t.arriveTick <= w.tick);
  if (!arrived.length) return;
  w.trucks = w.trucks.filter((t) => t.arriveTick > w.tick);
  for (const t of arrived) {
    for (const p of t.pallets) addPallet(w, p.item, p.qty);
    w.stats.trucks++;
    w.events.push({ type: 'truckArrived', kind: 'inbound' });
    const total = t.pallets.reduce((a, p) => a + p.qty, 0);
    w.events.push({ type: 'notice', icon: 'truck', text: `入荷トラック到着: ${t.pallets.length} 品目 / ${total} 個` });
  }
}

export function addPallet(w: WorldState, item: string, qty: number): void {
  if (qty <= 0) return;
  const p = w.pallets.find((p) => p.item === item);
  if (p) p.qty += qty;
  else w.pallets.push({ item, qty, arrivedTick: w.tick });
}

/** 入荷口に滞留している個数 */
export function dockBacklog(w: WorldState): number {
  return w.pallets.reduce((a, p) => a + p.qty, 0);
}

/** 商品ごとの在庫サマリー（在庫パネル用） */
export interface StockSummary {
  item: string;
  qty: number;
  bins: number;
  locations: string[];
  dock: number;
}

export function stockSummary(w: WorldState): StockSummary[] {
  const map = new Map<string, StockSummary>();
  for (const item of availableItemIds(w)) map.set(item, { item, qty: 0, bins: 0, locations: [], dock: 0 });
  const note = (binId: number, where: string) => {
    const b = w.bins[binId];
    if (!b || !b.item) return;
    let s = map.get(b.item);
    if (!s) {
      s = { item: b.item, qty: 0, bins: 0, locations: [], dock: 0 };
      map.set(b.item, s);
    }
    s.qty += b.qty;
    s.bins++;
    s.locations.push(where);
  };
  for (const st of w.stacks) st.bins.forEach((id, level) => note(id, `棚(${st.x},${st.z}) ${level + 1}段目`));
  for (const p of w.ports) {
    p.outbound.forEach((id) => note(id, `ポート(${p.x},${p.z})`));
    p.returns.forEach((id) => note(id, `ポート(${p.x},${p.z}) 返却`));
  }
  for (const r of w.robots) r.carrying.forEach((id) => note(id, r.name));
  for (const p of w.pallets) {
    const s = map.get(p.item);
    if (s) s.dock += p.qty;
    else map.set(p.item, { item: p.item, qty: 0, bins: 0, locations: [], dock: p.qty });
  }
  return [...map.values()];
}

export function emptyBinCount(w: WorldState): number {
  return Object.values(w.bins).filter((b) => b.item === null).length;
}
