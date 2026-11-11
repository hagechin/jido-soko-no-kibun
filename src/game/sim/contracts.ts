/**
 * 取引先の依頼（1.2、SPEC-1.2 §2）。実際の日付で毎日・毎週入れ替わる小さな目標。
 *  - sim は時計を見ない。日付（dayKey / weekKey）は UI が syncContracts で渡す
 *  - 量は倉庫の実力（直近の出荷ペース）に合わせる。逃しても何も失わない
 *  - 特注（bulk）だけ「受ける」が要る: 入荷トラックが来て、特注の注文が順に入る
 *  - 信用（取引先のレベル）はプレイヤー全体の記録なので sim の外。受け取るときにレベルをもらう
 */
import { CONTRACTS, OFFLINE, ORDERS, TICKS_PER_SECOND } from '../data/balance';
import { CLIENTS, CLIENT_BY_ID, levelRewardFactor, type ClientDef } from '../data/clients';
import { ITEM_BY_ID } from '../data/items';
import { addCoins } from './economy';
import { dailySlots, relationsFactor } from './hq';
import { scheduleTruck } from './inbound';
import { availableItemIds, itemWeight, lateClockStart } from './orders';
import { coinPerItemAt } from './pricing';
import { createRng, rand, randInt, shuffle, type RngState } from './rng';
import type { Contract, ContractKind, ContractsState, Order, WorldState } from './types';
import { tr } from '../i18n';

const pad = (n: number): string => String(n).padStart(2, '0');

/** 端末の現地時刻の日付（YYYY-MM-DD） */
export function dayKeyOf(d: Date): string {
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

/** その週の月曜の日付（W + YYYY-MM-DD）。週は月曜始まり */
export function weekKeyOf(d: Date): string {
  const m = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  m.setDate(m.getDate() - ((m.getDay() + 6) % 7));
  return `W${dayKeyOf(m)}`;
}

export function contractKeys(d: Date): { dayKey: string; weekKey: string } {
  return { dayKey: dayKeyOf(d), weekKey: weekKeyOf(d) };
}

function hash(s: string): number {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return h >>> 0;
}

/** きりのよい数に丸める（表示用） */
export function niceNumber(n: number): number {
  if (n < 20) return Math.max(1, Math.round(n));
  if (n < 100) return Math.round(n / 5) * 5;
  if (n < 1000) return Math.round(n / 10) * 10;
  const mag = Math.pow(10, Math.floor(Math.log10(n)) - 1);
  return Math.round(n / mag) * mag;
}

/** 依頼の量と報酬を決める基準: 直近 10 分のペース（1 分あたり）。下限はランクの基本の需要 */
export function contractPace(w: WorldState): { ship: number; items: number; coins: number } {
  const rank = Math.min(w.rank, ORDERS.intervalByRank.length - 1);
  const from = w.tick - OFFLINE.windowTicks;
  const recent = w.stats.recentShipments.filter((s) => s.tick >= from);
  const windowMin = Math.max(1, Math.min(OFFLINE.windowTicks, w.tick) / TICKS_PER_SECOND / 60);
  const [lmin, lmax] = ORDERS.linesByRank[rank];
  const [qmin, qmax] = ORDERS.qtyByRank[rank];
  const itemsPerOrder = ((lmin + lmax) / 2) * ((qmin + qmax) / 2);
  const floorShip = ((60 * TICKS_PER_SECOND) / ORDERS.intervalByRank[rank]) * CONTRACTS.paceFloorFactor;
  const floorItems = floorShip * itemsPerOrder;
  return {
    ship: Math.max(floorShip, recent.length / windowMin),
    items: Math.max(floorItems, recent.reduce((a, s) => a + s.items, 0) / windowMin),
    coins: Math.max(floorItems * coinPerItemAt(w), recent.reduce((a, s) => a + s.coins, 0) / windowMin),
  };
}

/** この取引先が扱う商品のうち、いまのランクで出るもの */
export function clientItems(w: WorldState, client: ClientDef): string[] {
  return availableItemIds(w).filter((id) => client.categories.includes(ITEM_BY_ID[id]?.category));
}

/** いまのランクで依頼を出せる取引先 */
export function availableClients(w: WorldState): ClientDef[] {
  return CLIENTS.filter((c) => clientItems(w, c).length > 0);
}

function categoryShare(w: WorldState, client: ClientDef): number {
  let mine = 0;
  let all = 0;
  for (const id of availableItemIds(w)) {
    const wgt = itemWeight(w, id);
    all += wgt;
    if (client.categories.includes(ITEM_BY_ID[id]?.category)) mine += wgt;
  }
  return all > 0 ? mine / all : 0;
}

function pickKind(rng: RngState, kinds: ContractKind[], avoid: Set<ContractKind>): ContractKind {
  let pool = kinds.filter((k) => !avoid.has(k));
  if (!pool.length) pool = kinds;
  const total = pool.reduce((a, k) => a + CONTRACTS.kindWeights[k], 0);
  let r = rand(rng) * total;
  for (const k of pool) {
    r -= CONTRACTS.kindWeights[k];
    if (r <= 0) return k;
  }
  return pool[pool.length - 1];
}

function buildContract(w: WorldState, st: ContractsState, rng: RngState, period: Contract['period'], key: string, client: ClientDef, kind: ContractKind): Contract {
  const pace = contractPace(w);
  const rank = Math.min(w.rank, ORDERS.intervalByRank.length - 1);
  const scale = period === 'weekly' ? CONTRACTS.weeklyScale : 1;
  const min = CONTRACTS.minTarget[kind] * scale;
  const c: Contract = { id: st.nextId++, period, key, client: client.id, kind, target: 0, progress: 0, state: 'active', reward: { coins: 0, trust: 0 } };
  switch (kind) {
    case 'volume':
      c.target = niceNumber(Math.max(min, pace.ship * CONTRACTS.paceMinutes.volume * scale));
      break;
    case 'category':
      c.target = niceNumber(Math.max(min, pace.items * categoryShare(w, client) * CONTRACTS.paceMinutes.category * scale));
      break;
    case 'fast':
      c.limitSec = CONTRACTS.fastLimitSecByRank[rank];
      c.target = niceNumber(Math.max(min, pace.ship * CONTRACTS.paceMinutes.fast * scale));
      break;
    case 'clean':
      c.target = niceNumber(Math.max(min, pace.ship * CONTRACTS.paceMinutes.clean * scale));
      break;
    case 'bulk': {
      const n = Math.min(CONTRACTS.bulk.maxOrders, Math.max(min, Math.round(pace.ship * CONTRACTS.paceMinutes.bulk * scale)));
      const items = clientItems(w, client);
      const [qmin, qmax] = ORDERS.qtyByRank[rank];
      c.pending = [];
      for (let i = 0; i < n; i++) {
        const pool = shuffle(rng, [...items]);
        const lineCount = Math.max(1, Math.min(pool.length, CONTRACTS.bulk.maxLines, randInt(rng, 1, CONTRACTS.bulk.maxLines)));
        c.pending.push(pool.slice(0, lineCount).map((item) => ({ item, qty: randInt(rng, qmin, qmax) })));
      }
      c.target = n;
      c.state = 'offered';
      break;
    }
  }
  const minutes = period === 'weekly' ? CONTRACTS.weeklyRewardMinutes : CONTRACTS.rewardMinutes[kind];
  const floor = CONTRACTS.rewardFloorByRank[Math.min(rank, CONTRACTS.rewardFloorByRank.length - 1)] * (period === 'weekly' ? 5 : 1);
  c.reward = {
    coins: niceNumber(Math.max(floor, pace.coins * minutes)),
    trust: period === 'weekly' ? CONTRACTS.trust.weekly : kind === 'bulk' ? CONTRACTS.trust.bulk : CONTRACTS.trust.daily,
  };
  return c;
}

const DAILY_KINDS: ContractKind[] = ['volume', 'category', 'fast', 'clean', 'bulk'];
const WEEKLY_KINDS: ContractKind[] = ['volume', 'category', 'fast'];

/** その日（週）の依頼を count 件になるまで足す。足した件数を返す */
function fill(w: WorldState, st: ContractsState, period: Contract['period'], key: string, count: number): number {
  const clients = availableClients(w);
  if (!clients.length) return 0;
  const rng = createRng(hash(`${key}|${period}|${st.nextId}|${w.rng.seed}`));
  const order = shuffle(rng, [...clients]);
  let added = 0;
  for (;;) {
    const mine = st.list.filter((c) => c.period === period && c.key === key);
    if (mine.length >= count) break;
    const usedClients = new Set(mine.map((c) => c.client));
    const usedKinds = new Set(mine.map((c) => c.kind));
    const client = order.find((c) => !usedClients.has(c.id)) ?? order[mine.length % order.length];
    const kind = pickKind(rng, period === 'weekly' ? WEEKLY_KINDS : DAILY_KINDS, usedKinds);
    st.list.push(buildContract(w, st, rng, period, key, client, kind));
    added++;
  }
  return added;
}

/** 特注を取り下げる: 残っている特注の注文はふつうの注文として残す */
function release(w: WorldState, c: Contract): void {
  if (c.kind !== 'bulk') return;
  for (const o of w.orders) if (o.contract === c.id) delete o.contract;
}

/**
 * 日付に合わせて依頼を入れ替える（UI が起動時・復帰時・1 分ごとに呼ぶ）。
 * 達成して受け取っていない依頼は残す。端末の時計が戻ったときは入れ替えない。
 */
export function syncContracts(w: WorldState, now: { dayKey: string; weekKey: string }): { added: number } {
  if (w.sandbox) {
    w.contracts = undefined;
    return { added: 0 };
  }
  const st = (w.contracts ??= { dayKey: '', weekKey: '', list: [], nextId: 1, completed: 0 });
  let added = 0;
  const roll = (period: Contract['period'], key: string): void => {
    const keep: Contract[] = [];
    for (const c of st.list) {
      if (c.period !== period || c.key === key || c.state === 'done') keep.push(c);
      else release(w, c);
    }
    st.list = keep;
  };
  if (now.dayKey > st.dayKey) {
    roll('daily', now.dayKey);
    st.dayKey = now.dayKey;
  }
  if (now.weekKey > st.weekKey) {
    roll('weekly', now.weekKey);
    st.weekKey = now.weekKey;
  }
  added += fill(w, st, 'daily', st.dayKey, dailySlots(w));
  added += fill(w, st, 'weekly', st.weekKey, CONTRACTS.weeklySlots);
  return { added };
}

function finish(w: WorldState, st: ContractsState, c: Contract): void {
  c.progress = c.target;
  c.state = 'done';
  st.completed++;
  w.events.push({ type: 'contractDone', id: c.id });
}

/** 毎 tick: 受けた特注の注文を間隔をあけて入れる */
export function updateContracts(w: WorldState): void {
  const st = w.contracts;
  if (!st) return;
  for (const c of st.list) {
    if (c.kind !== 'bulk' || c.state !== 'active' || !c.pending?.length) continue;
    if (w.tick < (c.nextOrderTick ?? 0)) continue;
    const lines = c.pending.shift()!;
    const o: Order = { id: w.nextIds.order++, lines: lines.map((l) => ({ item: l.item, qty: l.qty, picked: 0 })), arrivedTick: w.tick, shownTick: null, penalized: false, contract: c.id };
    w.orders.push(o);
    w.events.push({ type: 'orderArrived', orderId: o.id });
    c.nextOrderTick = w.tick + CONTRACTS.bulk.intervalTicks;
  }
}

/** 出荷のたび（economy.shipOrder から） */
export function onContractShipment(w: WorldState, o: Order): void {
  const st = w.contracts;
  if (!st) return;
  const leadSec = (w.tick - lateClockStart(o)) / TICKS_PER_SECOND;
  for (const c of st.list) {
    if (c.state !== 'active') continue;
    switch (c.kind) {
      case 'volume':
        c.progress++;
        break;
      case 'category': {
        const cats = CLIENT_BY_ID[c.client]?.categories ?? [];
        for (const l of o.lines) if (cats.includes(ITEM_BY_ID[l.item]?.category)) c.progress += l.qty;
        break;
      }
      case 'fast':
        if (leadSec <= (c.limitSec ?? 0)) c.progress++;
        break;
      case 'clean':
        c.progress = o.penalized ? 0 : c.progress + 1;
        break;
      case 'bulk':
        if (o.contract === c.id) c.progress++;
        break;
    }
    if (c.progress >= c.target) finish(w, st, c);
  }
}

/** お留守番の出荷: 件数と、取引先のカテゴリの個数（出荷実績の比率）だけ進める */
export function contractsOffline(w: WorldState, shipped: number, items: number): void {
  const st = w.contracts;
  if (!st || shipped <= 0) return;
  const total = Object.values(w.stats.shippedByItem).reduce((a, b) => a + b, 0);
  for (const c of st.list) {
    if (c.state !== 'active') continue;
    if (c.kind === 'volume') c.progress += shipped;
    else if (c.kind === 'category' && total > 0) {
      const cats = CLIENT_BY_ID[c.client]?.categories ?? [];
      let mine = 0;
      for (const [id, n] of Object.entries(w.stats.shippedByItem)) if (cats.includes(ITEM_BY_ID[id]?.category)) mine += n;
      c.progress += Math.floor((items * mine) / total);
    } else continue;
    if (c.progress >= c.target) finish(w, st, c);
  }
}

export function findContract(w: WorldState, id: number): Contract | undefined {
  return w.contracts?.list.find((c) => c.id === id);
}

/** 受け取れるコイン（取引先のレベルと本社の渉外部の倍率込み） */
export function contractCoins(w: WorldState, c: Contract, clientLevel: number): number {
  return Math.round(c.reward.coins * levelRewardFactor(clientLevel) * relationsFactor(w));
}

type Result<T = unknown> = ({ ok: true; message?: string } & T) | { ok: false; reason: string };

/** 特注を受ける: 必要な商品の入荷トラックを手配し、注文が順に入り始める */
export function acceptContract(w: WorldState, id: number): Result {
  const c = findContract(w, id);
  if (!c || c.kind !== 'bulk' || c.state !== 'offered') return { ok: false, reason: tr('この依頼は受けられません') };
  const need = new Map<string, number>();
  for (const lines of c.pending ?? []) for (const l of lines) need.set(l.item, (need.get(l.item) ?? 0) + l.qty);
  const pallets = [...need].map(([item, qty]) => ({ item, qty: Math.ceil(qty * CONTRACTS.bulk.stockFactor) }));
  if (pallets.length) scheduleTruck(w, pallets, 'prestock');
  c.state = 'active';
  c.nextOrderTick = w.tick + CONTRACTS.bulk.firstDelayTicks;
  return { ok: true, message: tr('特注を受けました。入荷トラックが商品を運んできます（空ビンが要ります）') };
}

/** 達成した依頼の報酬を受け取る。信用は呼び出し側（プレイヤーの記録）に足してもらう */
export function claimContract(w: WorldState, id: number, clientLevel: number): Result<{ coins: number; trust: number; client: string }> {
  const c = findContract(w, id);
  if (!c || c.state !== 'done') return { ok: false, reason: tr('まだ達成していません') };
  const coins = contractCoins(w, c, clientLevel);
  addCoins(w, coins);
  c.state = 'claimed';
  c.claimedCoins = coins;
  return { ok: true, coins, trust: c.reward.trust, client: c.client };
}

/** 入れ替えの値段（入れ替えられないなら null）: 達成前の毎日の依頼だけ。進行中の特注は不可 */
export function rerollCost(c: Contract): number | null {
  if (c.period !== 'daily') return null;
  if (c.state === 'done' || c.state === 'claimed') return null;
  if (c.kind === 'bulk' && c.state === 'active') return null;
  return Math.max(CONTRACTS.rerollMinCost, niceNumber(c.reward.coins * CONTRACTS.rerollCostFactor));
}

/** コインを払って別の依頼に替える（種類は必ず変わる） */
export function rerollContract(w: WorldState, id: number): Result {
  const st = w.contracts;
  const c = findContract(w, id);
  const cost = c ? rerollCost(c) : null;
  if (!st || !c || cost === null) return { ok: false, reason: tr('この依頼は入れ替えられません') };
  if (w.coins < cost) return { ok: false, reason: tr('コインが足りません（{0} 必要）', cost) };
  const clients = availableClients(w);
  if (!clients.length) return { ok: false, reason: tr('この依頼は入れ替えられません') };
  w.coins -= cost;
  const rng = createRng(hash(`${c.key}|reroll|${st.nextId}|${w.rng.seed}`));
  const others = st.list.filter((x) => x !== c && x.period === c.period && x.key === c.key);
  const avoid = new Set<ContractKind>([c.kind, ...others.map((x) => x.kind)]);
  const usedClients = new Set(others.map((x) => x.client));
  const order = shuffle(rng, [...clients]);
  const client = order.find((x) => !usedClients.has(x.id) && x.id !== c.client) ?? order.find((x) => x.id !== c.client) ?? order[0];
  let kind = pickKind(rng, DAILY_KINDS, avoid);
  if (kind === c.kind) kind = DAILY_KINDS.find((k) => k !== c.kind) ?? kind;
  st.list[st.list.indexOf(c)] = buildContract(w, st, rng, c.period, c.key, client, kind);
  return { ok: true, message: tr('別の依頼に入れ替えました') };
}

/** バーのバッジ: 受け取れる依頼と、まだ受けていない特注の数 */
export function contractBadge(w: WorldState): number {
  return w.contracts?.list.filter((c) => c.state === 'done' || c.state === 'offered').length ?? 0;
}
