/**
 * 自動行動（§7.3）。
 *  常時: ビン返却の自動格納、暇な搬送ロボは待機スポットへ、ポート上で暇な棚ロボは退く
 *  自動配車AI Lv1: 搬送ロボがポートのビンを自動で取りに行く
 *  自動配車AI Lv2: 棚ロボがオーダーを見て自動で取り出す（古いオーダー優先）
 *  自動配車AI Lv3: 同じ商品を含むオーダーをまとめる（需要の多い商品を優先）
 *  自動補充AI: 入荷があると該当ビン（または空ビン）を入荷ステーションへ
 *  在庫再配置AI: 暇なときに人気商品を上段へ
 * 手動指示（manual）が入っているロボには割り当てない。
 */
import { isDrone, layerOf } from './layers';
import { passableFor } from './goals';
import { AUTOMATION, PATHING, PORT } from '../data/balance';
import { demandFor } from '../data/seasons';
import { cellAt, isFloorWalkable, isRailWalkable, manhattan, neighbors4 } from './grid';
import { rand } from './rng';
import { visibleOrders } from './orders';
import { describeRobot, finishJob, lockedStacks, nearestPort, portReachable, setGoal } from './robots';
import { goalTargetCells } from './goals';
import type { Runtime } from './runtime';
import type { Robot, Stack, WorldState } from './types';
import { tr } from '../i18n';

function idle(r: Robot): boolean {
  return !r.job && !r.queue.length && r.actRemaining === 0 && r.phase === 'idle';
}

/** 取り出し中・ポート待ち・運搬中のビン（二重に取り出さないため） */
function binsInFlight(w: WorldState): Set<number> {
  const s = new Set<number>();
  for (const r of w.robots) {
    for (const id of r.carrying) s.add(id);
    for (const j of [r.job, ...r.queue]) {
      if (j?.type === 'retrieve') s.add(j.binId);
      if (j?.type === 'merge') {
        s.add(j.binId);
        s.add(j.targetBinId);
      }
    }
  }
  for (const p of w.ports) {
    for (const id of p.outbound) s.add(id);
    for (const id of p.returns) s.add(id);
  }
  return s;
}

/** 棚にあるビンのうち item を持ち在庫のあるもの（掘り出しの浅い順） */
function stackedBinsOf(w: WorldState, pred: (b: { item: string | null; qty: number }) => boolean): { stack: Stack; binId: number; depth: number }[] {
  const out: { stack: Stack; binId: number; depth: number }[] = [];
  for (const s of w.stacks) {
    s.bins.forEach((id, i) => {
      const b = w.bins[id];
      if (b && pred(b)) out.push({ stack: s, binId: id, depth: s.bins.length - 1 - i });
    });
  }
  out.sort((a, b) => a.depth - b.depth);
  return out;
}

/** staleCarryTicks 以上動けていないロボが持っている（または取りに向かっている）ビン */
function staleCarriedBins(w: WorldState): Set<number> {
  const s = new Set<number>();
  for (const r of w.robots) {
    if (r.stuckTicks < AUTOMATION.staleCarryTicks) continue;
    for (const id of r.carrying) s.add(id);
    for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve') s.add(j.binId);
  }
  return s;
}

/** 長く動けていない棚ロボの、まだビンを持っていない自動の取り出し指示は取り消す（他のロボが代わりに取りに行ける） */
function releaseStaleRetrieves(w: WorldState, rt: Runtime): void {
  for (const r of w.robots) {
    const j = r.job;
    if (!j || j.type !== 'retrieve' || j.manual || r.carrying.length || r.step !== 0 || r.stuckTicks < AUTOMATION.staleRetrieveTicks) continue;
    w.bins[j.binId] && (w.bins[j.binId].purpose = null);
    finishJob(w, rt, r);
  }
}

export function outboundLoad(w: WorldState, portId: number): number {
  const p = w.ports.find((p) => p.id === portId)!;
  let n = p.outbound.length;
  for (const r of w.robots) for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve' && j.portId === portId) n++;
  return n;
}

// ------------------------------------------------------------------ 入荷作業の配分
/** 倉庫の容量に対する在庫の割合（0〜1） */
export function stockFill(w: WorldState): number {
  const cap = w.stacks.length * w.levels * w.binCapacity;
  if (!cap) return 0;
  let qty = 0;
  for (const b of Object.values(w.bins)) if (b.item) qty += b.qty;
  return Math.min(1, qty / cap);
}

/** 入荷モード: 入荷口にビン 1 杯ぶん以上の山があり、在庫が薄い（容量比）か、滞留が棚の在庫より多い */
export function restockMode(w: WorldState): boolean {
  if (!w.pallets.length) return false;
  const dock = w.pallets.reduce((a, p) => a + p.qty, 0);
  if (dock < w.binCapacity) return false;
  let stocked = 0;
  for (const b of Object.values(w.bins)) if (b.item) stocked += b.qty;
  return stockFill(w) < AUTOMATION.lowStockFill || dock > stocked;
}

/**
 * 緊急の補充（★）: 入荷口にある商品のうち、欠品しているか欠品しそうなものがある。
 *  - オーダー（表示中だけでなくキューで待っているものも）が待っている欠品商品が入荷口にある
 *  - 入荷口にある商品の棚の在庫が AUTOMATION.urgentStockBins 杯分を下回っている（欠品しそう）
 * このときは棚ロボがピックより先に空ビン（埋まっていれば掘り出してでも）を入荷ステーションへ運び、ポートの出庫枠もピックと同じ条件で使う
 */
export function urgentRestock(w: WorldState): boolean {
  return urgentRestockItems(w).size > 0;
}

export function urgentRestockItems(w: WorldState): Set<string> {
  const out = new Set<string>();
  if (!w.pallets.length) return out;
  const stock = new Map<string, number>();
  for (const b of Object.values(w.bins)) if (b.item) stock.set(b.item, (stock.get(b.item) ?? 0) + b.qty);
  // 詰められるビンが棚に無い商品は「緊急」にしない（空ビンも同じ商品の空きのあるビンも無ければ、空ビンを買うしかない。
  //  緊急のままにすると他の商品のビンを入荷ステーションへ運び続けて、ピックが止まる）
  const emptyInStack = w.stacks.some((s) => s.bins.some((id) => w.bins[id]?.item === null));
  const partialInStack = new Set<string>();
  for (const s of w.stacks) for (const id of s.bins) {
    const b = w.bins[id];
    if (b?.item && b.qty < w.binCapacity) partialInStack.add(b.item);
  }
  const canStuff = (item: string) => emptyInStack || partialInStack.has(item);
  const palletItems = new Set(w.pallets.map((p) => p.item));
  for (const item of palletItems) {
    const s = stock.get(item) ?? 0;
    if ((s <= 0 || s < w.binCapacity * AUTOMATION.urgentStockBins) && canStuff(item)) out.add(item);
  }
  for (const o of w.orders) for (const l of o.lines) if (l.picked < l.qty && !(stock.get(l.item) ?? 0) && palletItems.has(l.item) && canStuff(l.item)) out.add(l.item);
  return out;
}

/** 入荷作業に回す割合（優先設定 → 入荷モードで引き上げ）。入荷口に山が無ければ 0 */
export function restockShare(w: WorldState): number {
  if (!w.pallets.length) return 0;
  const base = AUTOMATION.restockShareByPriority[w.automation.amrPriority] ?? AUTOMATION.restockShareByPriority.balanced;
  return restockMode(w) ? Math.max(base, AUTOMATION.lowStockRestockShare) : base;
}

/** 入荷行きのビンを取り出し中（または予約中）の棚ロボの数。ポートや搬送ロボに渡った後のビンは数えない（そこはポートの枠で制御） */
export function shelvesOnRestock(w: WorldState): number {
  let n = 0;
  for (const r of w.robots) {
    if (r.kind !== 'shelf') continue;
    if ([r.job, ...r.queue].some((j) => j?.type === 'retrieve' && w.bins[j.binId]?.purpose === 'inbound')) n++;
  }
  return n;
}

/** 棚ロボのうち入荷作業（入荷STへ向かうビンの取り出し）に充てる台数 */
export function restockShelfCap(w: WorldState): number {
  const shelves = w.robots.filter((o) => o.kind === 'shelf').length;
  if (!w.pallets.length) return 0;
  const stockNow = new Set<string>();
  for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) stockNow.add(b.item);
  const pickPending = visibleOrders(w).some((o) => o.lines.some((l) => l.picked < l.qty && stockNow.has(l.item)));
  if (!pickPending) return shelves; // ピック待ちが無ければ全員で補充
  // 入荷モードや欠品が入荷口にあるときは最低 1 台。それ以外は配分どおり（小さな倉庫では 0 台 = ピックの合間だけ補充）
  const floor = restockMode(w) || urgentRestock(w) ? AUTOMATION.maxInboundInFlight : 0;
  return Math.min(shelves, Math.max(floor, Math.round(shelves * restockShare(w))));
}

/** 搬送ロボのうち入荷ビンだけを運ぶ台数 */
export function restockAmrCap(w: WorldState): number {
  const amrs = w.robots.filter((o) => o.kind === 'amr').length;
  if (!w.pallets.length) return 0;
  // ★ 搬送ロボが 1 台しかない倉庫では専任にしない（唯一の 1 台が入荷ビンだけを運ぶとピックが止まり、遅延で評判が落ちる）。入荷ビンは手が空いたときに運ぶ
  const floor = amrs >= AUTOMATION.dedicatedAmrMinFleet ? 1 : 0;
  return Math.min(amrs, Math.max(floor, Math.round(amrs * restockShare(w))));
}

// ------------------------------------------------------------------ 棚ロボ
function assignShelfJob(w: WorldState, r: Robot): boolean {
  const auto = w.automation;
  const inFlight = binsInFlight(w);
  // ★ デッドロック解消: 欠品商品の山が入荷口にあるのに詰められるビンが無い → 同じ商品のビンをまとめて空ビンを作る（1 台ずつ、ピックより先）
  if (auto.restock && assignMerge(w, r, inFlight)) return true;
  // 配分: 入荷モード（在庫が薄い）か欠品が入荷口にあるときは、枠（入荷行きのビンを取り出し中の棚ロボの数）が埋まるまで補充を先に。
  // それ以外はピックを先に、空いた手で枠まで補充する
  const restockFirst = auto.restock && w.pallets.length > 0 && (restockMode(w) || urgentRestock(w)) && shelvesOnRestock(w) < restockShelfCap(w);
  if (restockFirst && assignRestock(w, r, inFlight)) return true;
  if (assignPick(w, r, inFlight)) return true;
  if (!restockFirst && auto.restock && assignRestock(w, r, inFlight)) return true;
  return assignRelocate(w, r, inFlight);
}

/** Lv2/3: オーダーに必要なビンを取り出す */
function assignPick(w: WorldState, r: Robot, inFlight: Set<number>): boolean {
  const auto = w.automation;
  if (auto.dispatch >= 2) {
    // 商品ごとの未ピック数と最古オーダーの到着時刻。在庫で完了できるオーダーを優先する（欠品待ちのオーダーのために走らない）
    const inStock = new Set<string>();
    for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) inStock.add(b.item);
    const need = new Map<string, { qty: number; oldest: number; orders: number; completable: boolean }>();
    for (const o of visibleOrders(w)) {
      const completable = o.lines.every((l) => l.picked >= l.qty || inStock.has(l.item));
      for (const l of o.lines) {
        const left = l.qty - l.picked;
        if (left <= 0) continue;
        const e = need.get(l.item) ?? { qty: 0, oldest: o.arrivedTick, orders: 0, completable: false };
        e.qty += left;
        e.orders++;
        if (completable) {
          e.oldest = e.completable ? Math.min(e.oldest, o.arrivedTick) : o.arrivedTick;
          e.completable = true;
        } else if (!e.completable) e.oldest = Math.min(e.oldest, o.arrivedTick);
        need.set(l.item, e);
      }
    }
    // すでに向かっている／ポートにあるビンでまかなえる分を引く（長く動けていないロボが持っているビンは当てにしない）
    const stale = staleCarriedBins(w);
    for (const id of inFlight) {
      const b = w.bins[id];
      if (b?.item && b.purpose !== 'inbound' && !stale.has(id)) {
        const e = need.get(b.item);
        if (e) e.qty -= b.qty;
      }
    }
    const candidates = [...need.entries()].filter(([, e]) => e.qty > 0);
    candidates.sort((a, b) => {
      if (a[1].completable !== b[1].completable) return a[1].completable ? -1 : 1; // 完了できるオーダーの商品を先に
      if (auto.dispatch >= 3 && a[1].orders !== b[1].orders) return b[1].orders - a[1].orders; // バッチ: 複数オーダーに跨る商品を先に
      return a[1].oldest - b[1].oldest; // 古いオーダー優先
    });
    for (const [item] of candidates) {
      const options = stackedBinsOf(w, (b) => b.item === item && b.qty > 0).filter((o) => !inFlight.has(o.binId));
      if (!options.length) continue;
      const pick = options[0];
      const station = w.stations.find((s) => s.kind === 'pick' && s.assignedItems.includes(item)) ?? w.stations.find((s) => s.kind === 'pick') ?? null;
      const port = bestPort(w, pick.stack, station, (p) => outboundLoad(w, p.id) < PORT.outboundCapacity);
      if (!port) return false; // ポートが詰まっている
      w.bins[pick.binId].purpose = 'pick';
      r.job = { type: 'retrieve', stackId: pick.stack.id, binId: pick.binId, portId: port.id, manual: false };
      r.step = 0;
      auto.lastRetrieveTick = w.tick;
      return true;
    }
  }
  return false;
}

/** 自動補充: 入荷口の山に合うビン（同じ商品で空きあり）か空ビンを入荷ステーションへ。配分の枠（restockShelfCap）まで */
function assignRestock(w: WorldState, r: Robot, inFlight: Set<number>): boolean {
  const auto = w.automation;
  if (auto.restock && w.pallets.length) {
    const inboundInFlight = shelvesOnRestock(w);
    const stockNow = new Set<string>();
    for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) stockNow.add(b.item);
    const pickPending = visibleOrders(w).some((o) => o.lines.some((l) => l.picked < l.qty && stockNow.has(l.item)));
    const cap = restockShelfCap(w);
    // ピック待ちがある間はポートの出庫枠をピック用に残す（入荷モードでも。ポートが入荷ビンで埋まるとピックが止まる）
    const headroom = pickPending ? AUTOMATION.restockPortHeadroom : 1;
    if (inboundInFlight < cap) {
      const palletItems = new Set(w.pallets.map((p) => p.item));
      const backlog = w.pallets.reduce((a, p) => a + p.qty, 0);
      // 欠品（または欠品しそう）の商品が入荷口にあるとき、または滞留が多いときは空ビン（1 往復で満杯にできる）を優先。空ビンが埋まっていれば掘り出す
      const urgentItems = urgentRestockItems(w);
      const urgent = urgentItems.size > 0;
      const bigBacklog = backlog >= w.binCapacity * AUTOMATION.preferEmptyBacklogBins;
      const empties = () => stackedBinsOf(w, (b) => b.item === null).filter((o) => !inFlight.has(o.binId));
      const partial = (items: Set<string>) => stackedBinsOf(w, (b) => b.item !== null && items.has(b.item) && b.qty < w.binCapacity).filter((o) => !inFlight.has(o.binId));
      // 緊急: 空ビン（埋まっていれば掘り出す）→ 欠品商品そのものの空きのあるビン。滞留が多い: 空ビン → 何かの空きのあるビン。普段: 空きのあるビン → 空ビン
      let options = urgent || bigBacklog ? empties() : partial(palletItems);
      if (!options.length) options = urgent ? partial(urgentItems) : bigBacklog ? partial(palletItems) : empties();
      if (!options.length && urgent) options = partial(palletItems);
      if (options.length) {
        const pick = options[0];
        const inboundSt = w.stations.find((s) => s.kind === 'inbound') ?? null;
        // ★ 緊急の補充はピックと同じ条件でポートを使う（ピック用に 2 枠空けておく条件だと、忙しい倉庫ではいつまでも補充が始まらない）
        const need = urgent ? Math.min(headroom, AUTOMATION.urgentPortHeadroom) : headroom;
        const port = bestPort(w, pick.stack, inboundSt, (p) => outboundLoad(w, p.id) <= PORT.outboundCapacity - need);
        if (port) {
          w.bins[pick.binId].purpose = 'inbound';
          r.job = { type: 'retrieve', stackId: pick.stack.id, binId: pick.binId, portId: port.id, manual: false };
          r.step = 0;
          return true;
        }
      }
    }
  }
  return false;
}

/**
 * 空ビンが要るのに作れない商品（入荷口にあり、在庫 0 で、空ビンもその商品の空きのあるビンも棚に無い）があるか
 */
export function needsEmptyBin(w: WorldState): string[] {
  if (!w.pallets.length) return [];
  const stock = new Map<string, number>();
  const partial = new Set<string>();
  let empty = false;
  for (const s of w.stacks) for (const id of s.bins) {
    const b = w.bins[id];
    if (!b) continue;
    if (b.item === null) empty = true;
    else {
      stock.set(b.item, (stock.get(b.item) ?? 0) + b.qty);
      if (b.qty < w.binCapacity) partial.add(b.item);
    }
  }
  if (empty) return [];
  // 持ち運び中・ポート上のビンも在庫に数える（空ビンが運搬中なら作らなくてよい）
  for (const b of Object.values(w.bins)) if (b.item === null) return [];
  const out: string[] = [];
  for (const item of new Set(w.pallets.map((p) => p.item))) if ((stock.get(item) ?? 0) <= 0 && !partial.has(item)) out.push(item);
  return out;
}

/** まとめられる 2 つのビン（同じ商品、どちらも頂上、足して容量以内）。注ぐ側（from）は少ない方 */
export function findMergePair(w: WorldState, inFlight: Set<number>): { from: Stack; fromBin: number; to: Stack; toBin: number } | null {
  const locked = lockedStacks(w);
  const tops: { stack: Stack; binId: number; item: string; qty: number }[] = [];
  for (const s of w.stacks) {
    if (locked.has(s.id) || !s.bins.length) continue;
    const id = s.bins[s.bins.length - 1];
    const b = w.bins[id];
    if (!b || b.item === null || inFlight.has(id)) continue;
    tops.push({ stack: s, binId: id, item: b.item, qty: b.qty });
  }
  let best: { from: Stack; fromBin: number; to: Stack; toBin: number; score: number } | null = null;
  for (const a of tops) for (const b of tops) {
    if (a === b || a.item !== b.item || a.qty > b.qty || a.qty + b.qty > w.binCapacity) continue;
    // 注ぐ量が少なく、近い組を優先
    const score = a.qty * 10 + manhattan(a.stack, b.stack);
    if (!best || score < best.score) best = { from: a.stack, fromBin: a.binId, to: b.stack, toBin: b.binId, score };
  }
  return best;
}

function assignMerge(w: WorldState, r: Robot, inFlight: Set<number>): boolean {
  if (!needsEmptyBin(w).length) return false;
  if (w.robots.some((o) => [o.job, ...o.queue].some((j) => j?.type === 'merge'))) return false;
  const pair = findMergePair(w, inFlight);
  if (!pair) return false;
  r.job = { type: 'merge', stackId: pair.from.id, binId: pair.fromBin, toStackId: pair.to.id, targetBinId: pair.toBin, manual: false };
  r.step = 0;
  return true;
}

/** 在庫再配置: 暇なときに人気商品を上へ */
function assignRelocate(w: WorldState, r: Robot, inFlight: Set<number>): boolean {
  const auto = w.automation;
  const relocating = w.robots.filter((o) => o.job?.type === 'relocate').length;
  if (auto.relocate && w.levels >= 2 && relocating < AUTOMATION.maxRelocating && w.tick - auto.lastRetrieveTick >= AUTOMATION.relocateIdleTicks) {
    const target = findRelocation(w, inFlight);
    if (target) {
      r.job = { type: 'relocate', stackId: target.stack.id, binId: target.binId, manual: false };
      r.step = 0;
      return true;
    }
  }
  return false;
}

/** 人気度: 累計出荷 + 今月の需要係数 */
export function popularity(w: WorldState, item: string | null): number {
  if (!item) return -1;
  return (w.stats.shippedByItem[item] ?? 0) + demandFor(item, w.calendar.month) * 5;
}

/** 下にあるのに上のビンより人気な商品 → 一番差が大きいもの */
export function findRelocation(w: WorldState, inFlight: Set<number>): { stack: Stack; binId: number } | null {
  let best: { stack: Stack; binId: number; gain: number } | null = null;
  const busyStacks = new Set<number>();
  for (const r of w.robots) for (const j of [r.job, ...r.queue]) {
    if (j?.type === 'relocate' || j?.type === 'retrieve') busyStacks.add(j.stackId);
    if (j?.type === 'merge') busyStacks.add(j.stackId).add(j.toStackId);
  }
  for (const s of w.stacks) {
    if (busyStacks.has(s.id) || s.bins.length < 2) continue;
    for (let i = 0; i < s.bins.length - 1; i++) {
      const id = s.bins[i];
      if (inFlight.has(id)) continue;
      const b = w.bins[id];
      if (!b?.item || b.qty <= 0) continue;
      const mine = popularity(w, b.item);
      let maxAbove = -Infinity;
      for (let j = i + 1; j < s.bins.length; j++) maxAbove = Math.max(maxAbove, popularity(w, w.bins[s.bins[j]]?.item ?? null));
      const gain = mine - maxAbove;
      if (gain > AUTOMATION.relocateMinGain && (!best || gain > best.gain)) best = { stack: s, binId: id, gain };
    }
  }
  return best;
}

/**
 * 取り出し先のポート: 「待っているビンの少なさ」を最優先に全ポートへ分散し、次に近さ。
 * ピッカーまでの距離は軽くしか見ない（最短にこだわると 1 つのポートに集中して詰まる）
 */
export function bestPort(w: WorldState, stack: { x: number; z: number }, station: { x: number; z: number } | null, ok: (p: WorldState['ports'][number]) => boolean) {
  let best = null as WorldState['ports'][number] | null;
  let bs = Infinity;
  for (const p of w.ports) {
    if (p.closed || !portReachable(w, p) || !ok(p)) continue;
    const score = outboundLoad(w, p.id) * PORT.loadWeight + manhattan(stack, p) + (station ? manhattan(p, station) * PORT.stationDistanceWeight : 0);
    if (score < bs) {
      bs = score;
      best = p;
    }
  }
  return best;
}

/** ポートに隣接しない、空いているスタックのうち一番近いもの */
function freeParkingStack(w: WorldState, r: Robot): Stack | null {
  let best: Stack | null = null;
  let bd = Infinity;
  for (const s of w.stacks) {
    if (w.ports.some((p) => manhattan(p, s) === 1)) continue;
    const occupied = w.robots.some((o) => o !== r && o.kind === 'shelf' && ((o.pose.x === s.x && o.pose.z === s.z) || (o.moveTo?.x === s.x && o.moveTo?.z === s.z) || (o.job?.type === 'park' && o.job.x === s.x && o.job.z === s.z)));
    if (occupied) continue;
    const d = manhattan(r.pose, s);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 詰まっているロボの近く（本人か目的地から 2 マス以内）で暇にしているロボを、離れたランダムなセルへ移動させる */
function unblockStuck(w: WorldState, rt: Runtime): void {
  for (const stuck of w.robots) {
    if (!stuck.goal || stuck.stuckTicks < PATHING.stuckTicks || stuck.stuckTicks % PATHING.replanIntervalTicks !== 0) continue;
    const targets = goalTargetCells(w, stuck.goal);
    for (const o of w.robots) {
      if (o === stuck || layerOf(o) !== layerOf(stuck) || o.job || o.queue.length || o.actRemaining > 0) continue;
      const near = manhattan(o.pose, stuck.pose) <= 2 || targets.some((c) => manhattan(o.pose, c) <= 2);
      if (!near) continue;
      // 暇なロボをランダムな通行可能セル（今の場所から 2 マス以上離れた所）へ
      const cells: { x: number; z: number }[] = [];
      const pass = passableFor(w, o);
      for (let z = 0; z < w.height; z++) {
        for (let x = 0; x < w.width; x++) {
          if (!pass(x, z) || manhattan({ x, z }, o.pose) < 2) continue;
          if (w.ports.some((p) => manhattan(p, { x, z }) <= 1)) continue;
          cells.push({ x, z });
        }
      }
      if (!cells.length) continue;
      const c = cells[Math.floor(rand(w.rng) * cells.length)];
      o.job = { type: 'park', x: c.x, z: c.z, manual: false };
      o.step = 0;
      setGoal(rt, o, null);
    }
  }
  void neighbors4;
}

// ------------------------------------------------------------------ 搬送ロボ
function assignAmrJob(w: WorldState, r: Robot): boolean {
  if (w.automation.dispatch < 1) return false;
  // ポートごとに「向かっている搬送ロボの数」を数え、出庫ビンがそれより多いポートへ。
  // 配分（restockAmrCap）のぶんは入荷ビンだけを運ぶ専任にし、残りはピックのビンを運ぶ。専任の枠が余っていればピック側も入荷ビンを運んでよい
  const targeting = new Map<number, number>();
  let inboundAmrs = 0;
  const drone = isDrone(r);
  for (const o of w.robots) {
    if (o.kind !== 'amr') continue;
    for (const j of [o.job, ...o.queue]) {
      if (j?.type !== 'fetch') continue;
      // ★ ドローンから見ると、横付けの順番待ち（staged）で足止めされている地上ロボは「向かっている」うちに数えない。
      //   溜まっているポートへ真っ先に飛ぶのがドローンの役目
      if (drone && j.staged && !isDrone(o)) continue;
      targeting.set(j.portId, (targeting.get(j.portId) ?? 0) + 1);
    }
    const j = o.job;
    const carriesInbound = o.carrying.some((id) => w.bins[id]?.purpose === 'inbound');
    if ((j?.type === 'fetch' && j.only === 'inbound') || (j && j.type !== 'park' && carriesInbound)) inboundAmrs++;
  }
  const purposeOfBin = (id: number) => (w.bins[id]?.purpose === 'inbound' ? 'inbound' : 'pick');
  const hasPurpose = (p: WorldState['ports'][number], purpose: 'pick' | 'inbound') => p.outbound.some((id) => purposeOfBin(id) === purpose);
  const avail = (p: WorldState['ports'][number]) => p.outbound.length > (targeting.get(p.id) ?? 0);
  // ドローンはどこへでも同じように飛べるので、近さより「誰にも拾われていないビンが一番多いポート」を選ぶ（同点なら近い方）
  const pickPort = (filter: (p: WorldState['ports'][number]) => boolean): WorldState['ports'][number] | null => {
    if (!drone) return nearestPort(w, r.pose.x, r.pose.z, filter, true);
    let best: WorldState['ports'][number] | null = null;
    let bestScore = -Infinity;
    for (const p of w.ports) {
      if (!filter(p)) continue;
      const score = (p.outbound.length - (targeting.get(p.id) ?? 0)) * 1000 - manhattan(r.pose, p);
      if (score > bestScore) {
        bestScore = score;
        best = p;
      }
    }
    return best;
  };
  // 専任は入荷モード／欠品が入荷口にあるときだけ。普段は優先設定でポートを選ぶだけ（積む順も優先設定）
  const dedicated = restockMode(w) || urgentRestock(w);
  const cap = dedicated ? restockAmrCap(w) : 0;
  if (dedicated && inboundAmrs < cap) {
    const port = pickPort((p) => avail(p) && hasPurpose(p, 'inbound'));
    if (port) {
      r.job = { type: 'fetch', portId: port.id, stationId: null, manual: false, only: 'inbound' };
      r.step = 0;
      return true;
    }
  }
  const pri = w.automation.amrPriority;
  let port = null as WorldState['ports'][number] | null;
  if (dedicated) {
    // ピック側: ピックのビンがあるポートを先に。入荷ビンは専任に任せる（専任が 0 台なら誰でも運ぶ）
    port = pickPort((p) => avail(p) && hasPurpose(p, 'pick'));
    if (port) {
      r.job = { type: 'fetch', portId: port.id, stationId: null, manual: false, only: cap > 0 ? 'pick' : undefined };
      r.step = 0;
      return true;
    }
    if (cap > 0) return false;
  } else if (pri !== 'balanced') {
    port = pickPort((p) => avail(p) && hasPurpose(p, pri === 'pick' ? 'pick' : 'inbound'));
    if (port) {
      r.job = { type: 'fetch', portId: port.id, stationId: null, manual: false };
      r.step = 0;
      return true;
    }
  }
  port = pickPort(avail); // 停止中のポートの出庫ビンも運ぶ
  if (!port) return false;
  r.job = { type: 'fetch', portId: port.id, stationId: null, manual: false };
  r.step = 0;
  return true;
}

// ------------------------------------------------------------------ 停滞診断（デバッグ画面）
/**
 * 「在庫があるのに誰も取りに行かない」ときに、配車AI／補充AI／搬送ロボがそれぞれ何を見て何もしていないかを列挙する（★）。
 * 判断のロジックはシミュレーション本体と同じ材料（need・在庫の所在・ポートの混み具合）で説明する
 */
export function diagnoseIdle(w: WorldState): string[] {
  const out: string[] = [];
  const auto = w.automation;
  const inFlight = binsInFlight(w);
  const locate = (id: number): string => {
    for (const s of w.stacks) if (s.bins.includes(id)) return tr(tr(tr(tr(tr(tr('棚({0},{1}){2}'))))), s.x, s.z, s.bins.length - 1 - s.bins.indexOf(id) > 0 ? tr(tr(tr(tr(tr(tr(' {0} 段下'))))), s.bins.length - 1 - s.bins.indexOf(id)) : tr(tr(tr(tr(tr(tr(' 頂上')))))));
    for (const p of w.ports) {
      if (p.outbound.includes(id)) return tr(tr(tr(tr(tr(tr('ポート({0},{1}) 出庫待ち'))))), p.x, p.z);
      if (p.returns.includes(id)) return tr(tr(tr(tr(tr(tr('ポート({0},{1}) 返却待ち'))))), p.x, p.z);
    }
    for (const r of w.robots) if (r.carrying.includes(id)) return tr(tr(tr(tr(tr(tr('{0} が運搬中'))))), r.name);
    for (const r of w.robots) for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve' && j.binId === id) return tr(tr(tr(tr(tr(tr('{0} が取り出しに向かっている'))))), r.name);
    return tr(tr(tr(tr(tr(tr('不明'))))));
  };
  const idleShelf = w.robots.filter((r) => r.kind === 'shelf' && idle(r)).length;
  const idleAmr = w.robots.filter((r) => r.kind === 'amr' && idle(r)).length;
  out.push(tr(tr(tr(tr(tr(tr('暇な棚ロボ {0} 台 / 暇な搬送ロボ {1} 台 / 配車AI Lv{2} / 補充AI {3}'))))), idleShelf, idleAmr, auto.dispatch, auto.restock ? tr(tr(tr(tr(tr(tr('オン')))))) : tr(tr(tr(tr(tr(tr('オフ'))))))));
  out.push(tr(tr(tr(tr(tr(tr('入荷作業の配分: 在庫率 {0}%{1} 棚ロボ {2} 台 / 搬送ロボ {3} 台（優先: {4}）'))))), (stockFill(w) * 100).toFixed(0), restockMode(w) ? tr(tr(tr(tr(tr(tr('（入荷モード）')))))) : '', restockShelfCap(w), restockAmrCap(w), auto.amrPriority));
  // 動けていないロボと、同じマスに重なっているロボ（本来起きない。起きていれば自動で解消される）
  for (const r of w.robots) if (r.stuckTicks >= AUTOMATION.staleRetrieveTicks) out.push(tr(tr(tr(tr(tr(tr('[!] {0} が {1} 秒動けていない: {2} @({3},{4}){5}'))))), r.name, Math.round(r.stuckTicks / 10), describeRobot(w, r), r.pose.x, r.pose.z, r.carrying.length ? tr(tr(tr(tr(tr(tr('、持っているビン: {0}'))))), r.carrying.map((id) => tr(tr(tr(tr(tr(tr('{0} {1} 個'))))), w.bins[id]?.item ?? tr(tr(tr(tr(tr(tr('空')))))), w.bins[id]?.qty ?? 0)).join('、')) : ''));
  const at = new Map<string, Robot>();
  for (const r of w.robots) {
    const k = `${layerOf(r)}:${r.pose.x},${r.pose.z}`;
    const o = at.get(k);
    if (o) out.push(tr(tr(tr(tr(tr(tr('[!] {0} と {1} が同じマス ({2},{3}) に重なっている'))))), o.name, r.name, r.pose.x, r.pose.z));
    at.set(k, r);
  }
  for (const p of w.ports) out.push(tr(tr(tr(tr(tr(tr('ポート({0},{1}){2}: 出庫待ち {3}（向かっている取り出し込み {4}/{5}） 返却待ち {6}/{7}'))))), p.x, p.z, p.closed ? tr(tr(tr(tr(tr(tr(' 停止中')))))) : '', p.outbound.length, outboundLoad(w, p.id), PORT.outboundCapacity, p.returns.length, PORT.returnCapacity));

  if (auto.dispatch < 2) out.push(tr(tr(tr(tr(tr(tr('配車AI が Lv1 以下なので、棚ロボはオーダーを見て自動では取り出しません（手動指示が必要）')))))));
  const inStock = new Set<string>();
  for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) inStock.add(b.item);
  const need = new Map<string, number>();
  for (const o of visibleOrders(w)) for (const l of o.lines) if (l.picked < l.qty) need.set(l.item, (need.get(l.item) ?? 0) + l.qty - l.picked);
  if (!need.size) out.push(tr(tr(tr(tr(tr(tr('表示中のオーダーに未ピックの行はありません')))))));
  for (const [item, qty] of need) {
    const all = Object.entries(w.bins).filter(([, b]) => b.item === item && b.qty > 0).map(([id]) => Number(id));
    if (!all.length) {
      const dock = w.pallets.find((p) => p.item === item)?.qty ?? 0;
      out.push(tr(tr(tr(tr(tr(tr('{0}: 欠品（在庫ゼロ）{1}'))))), item, dock ? tr(tr(tr(tr(tr(tr('。入荷口に {0} 個あるので補充待ち'))))), dock) : tr(tr(tr(tr(tr(tr('。入荷口にも無く、次のトラック待ち'))))))));
      continue;
    }
    const masked = all.filter((id) => inFlight.has(id) && w.bins[id].purpose !== 'inbound');
    const maskedQty = masked.reduce((a, id) => a + w.bins[id].qty, 0);
    const toInbound = all.filter((id) => inFlight.has(id) && w.bins[id].purpose === 'inbound');
    const options = stackedBinsOf(w, (b) => b.item === item && b.qty > 0).filter((o) => !inFlight.has(o.binId));
    let line = tr(tr(tr(tr(tr(tr('{0}: 必要 {1}'))))), item, qty);
    if (maskedQty >= qty) line += tr(tr(tr(tr(tr(tr(' → ピッカーへ向かっている分（{0}）でまかなえるので新たに取りに行かない'))))), masked.map((id) => tr(tr(tr(tr(tr(tr('{0} {1} 個'))))), locate(id), w.bins[id].qty)).join('、'));
    else if (!options.length) line += toInbound.length ? tr(tr(tr(tr(tr(tr(' → 棚に残りが無く、在庫のビンは入荷ステーション行き（{0}）。戻って格納されるまで待ち'))))), toInbound.map((id) => tr(tr(tr(tr(tr(tr('{0} {1} 個'))))), locate(id), w.bins[id].qty)).join('、')) : tr(tr(tr(tr(tr(tr(' → 棚に取り出せるビンが無い（{0}）'))))), all.map((id) => tr(tr(tr(tr(tr(tr('{0} {1} 個'))))), locate(id), w.bins[id].qty)).join('、'));
    else {
      const pick = options[0];
      const port = bestPort(w, pick.stack, null, (p) => outboundLoad(w, p.id) < PORT.outboundCapacity);
      line += port ? tr(tr(tr(tr(tr(tr(' → 取り出せる（{0}）。棚ロボが空けば向かう'))))), locate(pick.binId)) : tr(tr(tr(tr(tr(tr(' → 取り出せるビンはある（{0}）が、全ポートが出庫待ちで満杯／停止中なので待ち。搬送ロボがポートのビンを運ぶと再開'))))), locate(pick.binId));
    }
    out.push(line);
  }
  if (auto.restock) {
    if (!w.pallets.length) out.push(tr(tr(tr(tr(tr(tr('補充AI: 入荷口に山が無いので何もしない')))))));
    else {
      const palletItems = new Set(w.pallets.map((p) => p.item));
      const empties = stackedBinsOf(w, (b) => b.item === null).filter((o) => !inFlight.has(o.binId)).length;
      const partial = stackedBinsOf(w, (b) => b.item !== null && palletItems.has(b.item) && b.qty < w.binCapacity).filter((o) => !inFlight.has(o.binId)).length;
      const inboundInFlight = [...inFlight].filter((id) => w.bins[id]?.purpose === 'inbound').length;
      if (!empties && !partial) out.push(tr(tr(tr(tr(tr(tr('補充AI: 入荷口に {0} 個あるが、空ビンも同じ商品の空きのあるビンも無いので詰められない → 空ビンを買う／ビン容量アップ'))))), w.pallets.reduce((a, p) => a + p.qty, 0)));
      else out.push(tr(tr(tr(tr(tr(tr('補充AI: 空ビン {0} / 詰め足せるビン {1} / 入荷ステーション行き {2} 個'))))), empties, partial, inboundInFlight));
    }
  }
  return out;
}

// ------------------------------------------------------------------ 毎 tick
export function updateAutomation(w: WorldState, rt: Runtime): void {
  releaseStaleRetrieves(w, rt);
  // 棚ロボ: 返却ビンの格納（常時）→ AI の仕事 → ポートから退く
  const storeTargets = new Set<number>();
  for (const r of w.robots) if (r.job?.type === 'store') storeTargets.add(r.job.portId);
  for (const r of w.robots) {
    if (r.kind !== 'shelf' || !idle(r)) continue;
    const port = nearestPort(w, r.pose.x, r.pose.z, (p) => p.returns.length > 0 && !storeTargets.has(p.id), true); // 停止中のポートも片付ける
    if (port) {
      r.job = { type: 'store', portId: port.id, binId: null, stackId: null, manual: false };
      r.step = 0;
      storeTargets.add(port.id);
      continue;
    }
    if (assignShelfJob(w, r)) continue;
    // ポートの上や、ポートへの通り道（ポートに隣接するセル）で暇にしていると他のロボを塞ぐので退く
    const onPort = w.ports.some((p) => p.x === r.pose.x && p.z === r.pose.z);
    const nearPort = w.ports.some((p) => manhattan(p, r.pose) === 1);
    if (onPort || nearPort) {
      const best = freeParkingStack(w, r);
      if (best) r.job = { type: 'park', x: best.x, z: best.z, manual: false };
    }
  }



  // 搬送ロボ: AI の仕事 → 暇なら待機スポットへ。★ ドローンを先に割り当てる（地上ロボに仕事を先取りされて暇にならないように）
  const claimed = new Set<string>();
  const amrs = w.robots.filter((r) => r.kind === 'amr').sort((a, b) => Number(isDrone(b)) - Number(isDrone(a)));
  for (const r of amrs) {
    if (r.job?.type === 'park') claimed.add(`${r.job.x},${r.job.z}`);
    claimed.add(`${r.pose.x},${r.pose.z}`);
  }
  for (const r of amrs) {
    if (!idle(r)) continue;
    if (assignAmrJob(w, r)) continue;
    if (isDrone(r)) {
      // ドローンは待機スポットではなく、ポートの真上でホバリングして待つ（ビンが出た瞬間に積める）。1 ポートに 1 台
      if (w.ports.some((p) => p.x === r.pose.x && p.z === r.pose.z)) continue;
      const port = nearestPort(w, r.pose.x, r.pose.z, (p) => !claimed.has(`${p.x},${p.z}`), true);
      if (port) {
        r.job = { type: 'park', x: port.x, z: port.z, manual: false };
        r.step = 0;
        claimed.add(`${port.x},${port.z}`);
        setGoal(rt, r, null);
      }
      continue;
    }
    const onSpot = w.waitSpots.some((s) => s.x === r.pose.x && s.z === r.pose.z);
    if (onSpot) continue;
    let best = null as { x: number; z: number } | null;
    let bd = Infinity;
    for (const s of w.waitSpots) {
      if (claimed.has(`${s.x},${s.z}`)) continue;
      const d = manhattan(r.pose, s);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      r.job = { type: 'park', x: best.x, z: best.z, manual: false };
      r.step = 0;
      claimed.add(`${best.x},${best.z}`);
      setGoal(rt, r, null);
    }
  }
  // 待機スポットで暇にしている搬送ロボも AI の仕事は受ける（ドローンが先）
  for (const r of amrs) {
    if (!idle(r)) continue;
    assignAmrJob(w, r);
  }
  // 詰まっているロボがいたら、その近くで暇にしている同じ層のロボをどかす（§4.3 デッドロック解消）
  unblockStuck(w, rt);
}
