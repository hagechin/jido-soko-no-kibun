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
import { AUTOMATION, PATHING, PORT } from '../data/balance';
import { demandFor } from '../data/seasons';
import { cellAt, isFloorWalkable, isRailWalkable, manhattan, neighbors4 } from './grid';
import { rand } from './rng';
import { visibleOrders } from './orders';
import { describeRobot, finishJob, nearestPort, portReachable, setGoal } from './robots';
import { goalTargetCells } from './goals';
import type { Runtime } from './runtime';
import type { Robot, Stack, WorldState } from './types';

function idle(r: Robot): boolean {
  return !r.job && !r.queue.length && r.actRemaining === 0 && r.phase === 'idle';
}

/** 取り出し中・ポート待ち・運搬中のビン（二重に取り出さないため） */
function binsInFlight(w: WorldState): Set<number> {
  const s = new Set<number>();
  for (const r of w.robots) {
    for (const id of r.carrying) s.add(id);
    for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve') s.add(j.binId);
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

// ------------------------------------------------------------------ 棚ロボ
function assignShelfJob(w: WorldState, r: Robot): boolean {
  const auto = w.automation;
  const inFlight = binsInFlight(w);

  // Lv2/3: オーダーに必要なビンを取り出す
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

  // 自動補充: 入荷口の山に合うビン（同じ商品で空きあり）か空ビンを入荷ステーションへ
  if (auto.restock && w.pallets.length) {
    const inboundInFlight = [...inFlight].filter((id) => w.bins[id]?.purpose === 'inbound').length;
    const stockNow = new Set<string>();
    for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) stockNow.add(b.item);
    const pickPending = visibleOrders(w).some((o) => o.lines.some((l) => l.picked < l.qty && stockNow.has(l.item)));
    // ピッカー向けの仕事があるときは棚ロボの 1/3 だけ補充に回す。無ければ暇な棚ロボ全員で補充する
    const shelfCount = w.robots.filter((o) => o.kind === 'shelf').length;
    const cap = pickPending ? Math.max(AUTOMATION.maxInboundInFlight, Math.ceil(shelfCount / 3)) : shelfCount;
    const headroom = pickPending ? AUTOMATION.restockPortHeadroom : 1;
    if (inboundInFlight < cap) {
      const palletItems = new Set(w.pallets.map((p) => p.item));
      const backlog = w.pallets.reduce((a, p) => a + p.qty, 0);
      // 表示中オーダーが待っている欠品商品が入荷口にあるとき、または滞留が多いときは空ビン（1 往復で満杯にできる）を優先
      const urgent = visibleOrders(w).some((o) => o.lines.some((l) => l.picked < l.qty && !stockNow.has(l.item) && palletItems.has(l.item)));
      const bigBacklog = backlog >= w.binCapacity * AUTOMATION.preferEmptyBacklogBins;
      const empties = () => stackedBinsOf(w, (b) => b.item === null).filter((o) => !inFlight.has(o.binId));
      const partial = () => stackedBinsOf(w, (b) => b.item !== null && palletItems.has(b.item) && b.qty < w.binCapacity).filter((o) => !inFlight.has(o.binId));
      let options = urgent || bigBacklog ? empties() : partial();
      if (!options.length) options = urgent || bigBacklog ? partial() : empties();
      if (options.length) {
        const pick = options[0];
        const inboundSt = w.stations.find((s) => s.kind === 'inbound') ?? null;
        const port = bestPort(w, pick.stack, inboundSt, (p) => outboundLoad(w, p.id) <= PORT.outboundCapacity - headroom);
        if (port) {
          w.bins[pick.binId].purpose = 'inbound';
          r.job = { type: 'retrieve', stackId: pick.stack.id, binId: pick.binId, portId: port.id, manual: false };
          r.step = 0;
          return true;
        }
      }
    }
  }

  // 在庫再配置: 暇なときに人気商品を上へ
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
  for (const r of w.robots) for (const j of [r.job, ...r.queue]) if (j?.type === 'relocate' || j?.type === 'retrieve') busyStacks.add(j.stackId);
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
      if (o === stuck || o.kind !== stuck.kind || o.job || o.queue.length || o.actRemaining > 0) continue;
      const near = manhattan(o.pose, stuck.pose) <= 2 || targets.some((c) => manhattan(o.pose, c) <= 2);
      if (!near) continue;
      // 暇なロボをランダムな通行可能セル（今の場所から 2 マス以上離れた所）へ
      const cells: { x: number; z: number }[] = [];
      for (let z = 0; z < w.height; z++) {
        for (let x = 0; x < w.width; x++) {
          const k = cellAt(w, x, z);
          const ok = o.kind === 'shelf' ? isRailWalkable(k) : isFloorWalkable(k);
          if (!ok || manhattan({ x, z }, o.pose) < 2) continue;
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
  // 優先設定（ピック／補充）があれば、その行き先のビンがあるポートを先に選ぶ
  const targeting = new Map<number, number>();
  for (const o of w.robots) for (const j of [o.job, ...o.queue]) if (j?.type === 'fetch') targeting.set(j.portId, (targeting.get(j.portId) ?? 0) + 1);
  const pri = w.automation.amrPriority;
  const hasPurpose = (p: WorldState['ports'][number], purpose: 'pick' | 'inbound') => p.outbound.some((id) => (w.bins[id]?.purpose === 'inbound' ? 'inbound' : 'pick') === purpose);
  const avail = (p: WorldState['ports'][number]) => p.outbound.length > (targeting.get(p.id) ?? 0);
  let port = null as WorldState['ports'][number] | null;
  if (pri !== 'balanced') port = nearestPort(w, r.pose.x, r.pose.z, (p) => avail(p) && hasPurpose(p, pri === 'pick' ? 'pick' : 'inbound'), true);
  if (!port) port = nearestPort(w, r.pose.x, r.pose.z, avail, true); // 停止中のポートの出庫ビンも運ぶ
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
    for (const s of w.stacks) if (s.bins.includes(id)) return `棚(${s.x},${s.z})${s.bins.length - 1 - s.bins.indexOf(id) > 0 ? ` ${s.bins.length - 1 - s.bins.indexOf(id)} 段下` : ' 頂上'}`;
    for (const p of w.ports) {
      if (p.outbound.includes(id)) return `ポート(${p.x},${p.z}) 出庫待ち`;
      if (p.returns.includes(id)) return `ポート(${p.x},${p.z}) 返却待ち`;
    }
    for (const r of w.robots) if (r.carrying.includes(id)) return `${r.name} が運搬中`;
    for (const r of w.robots) for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve' && j.binId === id) return `${r.name} が取り出しに向かっている`;
    return '不明';
  };
  const idleShelf = w.robots.filter((r) => r.kind === 'shelf' && idle(r)).length;
  const idleAmr = w.robots.filter((r) => r.kind === 'amr' && idle(r)).length;
  out.push(`暇な棚ロボ ${idleShelf} 台 / 暇な搬送ロボ ${idleAmr} 台 / 配車AI Lv${auto.dispatch} / 補充AI ${auto.restock ? 'オン' : 'オフ'}`);
  // 動けていないロボと、同じマスに重なっているロボ（本来起きない。起きていれば自動で解消される）
  for (const r of w.robots) if (r.stuckTicks >= AUTOMATION.staleRetrieveTicks) out.push(`[!] ${r.name} が ${Math.round(r.stuckTicks / 10)} 秒動けていない: ${describeRobot(w, r)} @(${r.pose.x},${r.pose.z})${r.carrying.length ? `、持っているビン: ${r.carrying.map((id) => `${w.bins[id]?.item ?? '空'} ${w.bins[id]?.qty ?? 0} 個`).join('、')}` : ''}`);
  const at = new Map<string, Robot>();
  for (const r of w.robots) {
    const k = `${r.kind}:${r.pose.x},${r.pose.z}`;
    const o = at.get(k);
    if (o) out.push(`[!] ${o.name} と ${r.name} が同じマス (${r.pose.x},${r.pose.z}) に重なっている`);
    at.set(k, r);
  }
  for (const p of w.ports) out.push(`ポート(${p.x},${p.z})${p.closed ? ' 停止中' : ''}: 出庫待ち ${p.outbound.length}（向かっている取り出し込み ${outboundLoad(w, p.id)}/${PORT.outboundCapacity}） 返却待ち ${p.returns.length}/${PORT.returnCapacity}`);

  if (auto.dispatch < 2) out.push('配車AI が Lv1 以下なので、棚ロボはオーダーを見て自動では取り出しません（手動指示が必要）');
  const inStock = new Set<string>();
  for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) inStock.add(b.item);
  const need = new Map<string, number>();
  for (const o of visibleOrders(w)) for (const l of o.lines) if (l.picked < l.qty) need.set(l.item, (need.get(l.item) ?? 0) + l.qty - l.picked);
  if (!need.size) out.push('表示中のオーダーに未ピックの行はありません');
  for (const [item, qty] of need) {
    const all = Object.entries(w.bins).filter(([, b]) => b.item === item && b.qty > 0).map(([id]) => Number(id));
    if (!all.length) {
      const dock = w.pallets.find((p) => p.item === item)?.qty ?? 0;
      out.push(`${item}: 欠品（在庫ゼロ）${dock ? `。入荷口に ${dock} 個あるので補充待ち` : '。入荷口にも無く、次のトラック待ち'}`);
      continue;
    }
    const masked = all.filter((id) => inFlight.has(id) && w.bins[id].purpose !== 'inbound');
    const maskedQty = masked.reduce((a, id) => a + w.bins[id].qty, 0);
    const toInbound = all.filter((id) => inFlight.has(id) && w.bins[id].purpose === 'inbound');
    const options = stackedBinsOf(w, (b) => b.item === item && b.qty > 0).filter((o) => !inFlight.has(o.binId));
    let line = `${item}: 必要 ${qty}`;
    if (maskedQty >= qty) line += ` → ピッカーへ向かっている分（${masked.map((id) => `${locate(id)} ${w.bins[id].qty} 個`).join('、')}）でまかなえるので新たに取りに行かない`;
    else if (!options.length) line += toInbound.length ? ` → 棚に残りが無く、在庫のビンは入荷ステーション行き（${toInbound.map((id) => `${locate(id)} ${w.bins[id].qty} 個`).join('、')}）。戻って格納されるまで待ち` : ` → 棚に取り出せるビンが無い（${all.map((id) => `${locate(id)} ${w.bins[id].qty} 個`).join('、')}）`;
    else {
      const pick = options[0];
      const port = bestPort(w, pick.stack, null, (p) => outboundLoad(w, p.id) < PORT.outboundCapacity);
      line += port ? ` → 取り出せる（${locate(pick.binId)}）。棚ロボが空けば向かう` : ` → 取り出せるビンはある（${locate(pick.binId)}）が、全ポートが出庫待ちで満杯／停止中なので待ち。搬送ロボがポートのビンを運ぶと再開`;
    }
    out.push(line);
  }
  if (auto.restock) {
    if (!w.pallets.length) out.push('補充AI: 入荷口に山が無いので何もしない');
    else {
      const palletItems = new Set(w.pallets.map((p) => p.item));
      const empties = stackedBinsOf(w, (b) => b.item === null).filter((o) => !inFlight.has(o.binId)).length;
      const partial = stackedBinsOf(w, (b) => b.item !== null && palletItems.has(b.item) && b.qty < w.binCapacity).filter((o) => !inFlight.has(o.binId)).length;
      const inboundInFlight = [...inFlight].filter((id) => w.bins[id]?.purpose === 'inbound').length;
      if (!empties && !partial) out.push(`補充AI: 入荷口に ${w.pallets.reduce((a, p) => a + p.qty, 0)} 個あるが、空ビンも同じ商品の空きのあるビンも無いので詰められない → 空ビンを買う／ビン容量アップ`);
      else out.push(`補充AI: 空ビン ${empties} / 詰め足せるビン ${partial} / 入荷ステーション行き ${inboundInFlight} 個`);
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



  // 搬送ロボ: AI の仕事 → 暇なら待機スポットへ
  const claimed = new Set<string>();
  for (const r of w.robots) {
    if (r.kind !== 'amr') continue;
    if (r.job?.type === 'park') claimed.add(`${r.job.x},${r.job.z}`);
    claimed.add(`${r.pose.x},${r.pose.z}`);
  }
  for (const r of w.robots) {
    if (r.kind !== 'amr' || !idle(r)) continue;
    if (assignAmrJob(w, r)) continue;
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
  // 待機スポットで暇にしている搬送ロボも AI の仕事は受ける
  for (const r of w.robots) {
    if (r.kind !== 'amr' || !idle(r)) continue;
    assignAmrJob(w, r);
  }
  // 詰まっているロボがいたら、その近くで暇にしている同じ層のロボをどかす（§4.3 デッドロック解消）
  unblockStuck(w, rt);
}
