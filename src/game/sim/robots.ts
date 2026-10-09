/**
 * ロボの動作実行と仕事の状態機械（§4 / §7）。
 * step の意味は各 job ごとに定義（コメント参照）。
 */
import { PORT, ROBOT } from '../data/balance';
import { itemDef } from '../data/items';
import { approachCells, manhattan } from './grid';
import { visibleOrders } from './orders';
import { atGoal, passableFor, sameGoal } from './goals';
import { footprint, shapeFor, turnSweep } from './footprint';
import { moveTicksFor } from './pathfinding';
import type { Runtime } from './runtime';
import type { AmrJob, Goal, Robot, RobotJob, ShelfJob, Stack, Vec2, WorldState } from './types';
import { isDoubleDecker, isDrone, layerOf, shapeOf, shelfSlots } from './layers';

export function liftTicks(r: Robot): number {
  return ROBOT.liftTicksByLevel[Math.min(r.liftLevel, ROBOT.liftTicksByLevel.length - 1)];
}

export function cargoCapacity(r: Robot): number {
  return ROBOT.cargo[Math.min(r.cargoLevel, ROBOT.cargo.length - 1)].bins;
}

export function setGoal(rt: Runtime, r: Robot, goal: Goal | null): void {
  if (sameGoal(r.goal, goal)) return;
  r.goal = goal;
  rt.needsPlan.add(r.id);
  if (!goal) rt.plans.delete(r.id);
}

function beginAction(r: Robot, phase: Robot['phase'], ticks: number, step: number): void {
  r.phase = phase;
  r.actTotal = Math.max(1, ticks);
  r.actRemaining = r.actTotal;
  r.step = step;
}

export function finishJob(w: WorldState, rt: Runtime, r: Robot): void {
  r.job = r.queue.shift() ?? null;
  r.step = 0;
  r.digging = null;
  setGoal(rt, r, null);
  r.phase = 'idle';
}

/** 条件に合う一番近いポート。既定では使用停止中のポートを除く（片付け目的なら includeClosed = true） */
/** 搬送ロボが横付けできる（床に面している）ポートか。面していないポートにビンを置くと誰も取りに行けない */
export function portReachable(w: WorldState, p: { x: number; z: number }): boolean {
  return approachCells(w, p.x, p.z).length > 0;
}

export function nearestPort(w: WorldState, x: number, z: number, filter?: (p: WorldState['ports'][number]) => boolean, includeClosed = false) {
  let best = null as WorldState['ports'][number] | null;
  let bd = Infinity;
  for (const p of w.ports) {
    if (p.closed && !includeClosed) continue;
    if (!portReachable(w, p)) continue;
    if (filter && !filter(p)) continue;
    const d = manhattan({ x, z }, p);
    if (d < bd) {
      bd = d;
      best = p;
    }
  }
  return best;
}

/** 一番空いている入荷ステーション（向かっている・並んでいる・作業中の台数が少ないもの。同じなら近い方）★ 全員が一番近い 1 つに並ぶのを防ぐ */
export function leastLoadedInboundStation(w: WorldState, from: { x: number; z: number }): WorldState['stations'][number] | null {
  const load = new Map<number, number>();
  for (const o of w.robots) {
    const j = o.job;
    if (o.kind === 'amr' && j?.type === 'deliver') load.set(j.stationId, (load.get(j.stationId) ?? 0) + 1);
  }
  let best = null as WorldState['stations'][number] | null;
  let bs = Infinity;
  for (const s of w.stations) {
    if (s.kind !== 'inbound') continue;
    const score = (load.get(s.id) ?? 0) * 1000 + manhattan(from, s);
    if (score < bs) {
      bs = score;
      best = s;
    }
  }
  return best;
}

export function nearestStation(w: WorldState, x: number, z: number, kind: 'pick' | 'inbound') {
  let best = null as WorldState['stations'][number] | null;
  let bd = Infinity;
  for (const s of w.stations) {
    if (s.kind !== kind) continue;
    const d = manhattan({ x, z }, s);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 掘り出し中（取り出し・再配置の対象になっている）スタック。他のロボはここにビンを置かない */
export function lockedStacks(w: WorldState): Set<number> {
  const locked = new Set<number>();
  for (const r of w.robots) {
    for (const j of [r.job, ...r.queue]) {
      if (j?.type === 'retrieve' || j?.type === 'relocate') locked.add(j.stackId);
      if (j?.type === 'merge') {
        locked.add(j.stackId);
        locked.add(j.toStackId);
      }
    }
  }
  return locked;
}

/**
 * ビンを置けるスタック（空きがあり、掘り出し中でない）を選ぶ。
 * 低いスタックを優先して高さを平準化し、同じ高さなら近い方（levelWeight で重み付け）。
 * 置くビンが分かっていれば（binId）:
 *  - 空ビンは入荷ステーションの近くに集め、在庫ビンの上には置かない（在庫が見えなくなる・掘り出しが増える）
 *  - 在庫ビンは空ビンの上に置かない（空ビンが埋まって補充で掘ることになる）
 */
export function pickStackWithRoom(w: WorldState, near: { x: number; z: number }, exclude?: number, levelWeight = ROBOT.storeLevelWeight, binId?: number): Stack | null {
  const locked = lockedStacks(w);
  const bin = binId !== undefined ? w.bins[binId] : undefined;
  const isEmpty = bin ? bin.item === null || bin.qty <= 0 : null;
  const inbound = isEmpty ? nearestStation(w, near.x, near.z, 'inbound') : null;
  let best: Stack | null = null;
  let bs = Infinity;
  for (const s of w.stacks) {
    if (s.id === exclude || locked.has(s.id)) continue;
    if (s.bins.length >= w.levels) continue;
    let score = s.bins.length * levelWeight + manhattan(near, s);
    if (isEmpty !== null && s.bins.length) {
      const top = w.bins[s.bins[s.bins.length - 1]];
      const topEmpty = !top || top.item === null || top.qty <= 0;
      if (isEmpty && !topEmpty) score += ROBOT.burialPenalty; // 在庫の上に空ビンを置かない
      if (!isEmpty && topEmpty) score += ROBOT.burialPenalty; // 空ビンを在庫で埋めない
    }
    if (isEmpty && inbound) score += manhattan(inbound, s) * ROBOT.emptyNearInboundWeight; // 空ビンは入荷の近くへ
    if (score < bs) {
      bs = score;
      best = s;
    }
  }
  return best;
}

/** 待っているビンが少ないポート（同じなら近い方）。使用停止中は除く */
export function leastLoadedPort(w: WorldState, near: { x: number; z: number }, filter?: (p: WorldState['ports'][number]) => boolean, load: (p: WorldState['ports'][number]) => number = (p) => p.outbound.length) {
  let best = null as WorldState['ports'][number] | null;
  let bs = Infinity;
  for (const p of w.ports) {
    if (p.closed || !portReachable(w, p)) continue;
    if (filter && !filter(p)) continue;
    const score = load(p) * PORT.loadWeight + manhattan(near, p);
    if (score < bs) {
      bs = score;
      best = p;
    }
  }
  return best;
}

/** ビンの行き先ステーション（§7.1）: 入荷行きなら入荷ST、それ以外は担当ピッカー、担当が無ければ一番近いピッキングST */
export function destinationOf(w: WorldState, r: Robot, binId: number): number | null {
  const b = w.bins[binId];
  if (!b) return null;
  if (b.purpose === 'inbound') {
    // 入荷ビンはどの入荷ステーションでもよい。向かっている先が入荷ステーションならそこ、まだなら一番空いているところ
    const j = r.job;
    if (j?.type === 'deliver') {
      const cur = w.stations.find((s) => s.id === j.stationId);
      if (cur?.kind === 'inbound') return cur.id;
    }
    return leastLoadedInboundStation(w, r.pose)?.id ?? null;
  }
  if (b.item) {
    const s = w.stations.find((s) => s.kind === 'pick' && s.assignedItems.includes(b.item!));
    if (s) return s.id;
  }
  return nearestStation(w, r.pose.x, r.pose.z, 'pick')?.id ?? null;
}

/**
 * 混雑制御: ステーション／ポートへ同時に向かえる搬送ロボの数は、隣接する床（横付けできる場所）の数まで。
 * あふれた分は待機スポットで順番待ちする（通路でその場待ちして塞がないため）
 */
/** ポート／ステーションに着ける位置: 地上の搬送ロボは隣の床、ドローンはそのマスの真上 */
function dockGoal(r: Robot, at: Vec2): Goal {
  return isDrone(r) ? { type: 'cell', x: at.x, z: at.z } : { type: 'adjacent', x: at.x, z: at.z };
}

export function approachCapacity(w: WorldState, x: number, z: number): number {
  return Math.max(1, approachCells(w, x, z).length);
}

function headingTo(w: WorldState, kind: 'station' | 'port', id: number, except: Robot): number {
  let n = 0;
  for (const o of w.robots) {
    if (o === except || o.kind !== 'amr' || isDrone(o) || !o.job) continue; // ドローンは上から着けるので横付けの枠を使わない
    const j = o.job;
    if (kind === 'station' && j.type === 'deliver' && j.stationId === id && !j.staged) n++;
    if (kind === 'port' && (j.type === 'fetch' || j.type === 'return') && j.portId === id && !(j.type === 'fetch' && j.staged)) n++;
  }
  return n;
}

/** 待機スポット（他が向かっていないもの）へ退避する目標。無ければ null */
export function stagingGoal(w: WorldState, r: Robot): Goal | null {
  const claimed = new Set<string>();
  for (const o of w.robots) {
    if (o === r) continue;
    claimed.add(`${o.pose.x},${o.pose.z}`);
    if (o.goal?.type === 'cell') claimed.add(`${o.goal.x},${o.goal.z}`);
  }
  let best: { x: number; z: number } | null = null;
  let bd = Infinity;
  for (const s of w.waitSpots) {
    if (claimed.has(`${s.x},${s.z}`)) continue;
    const d = manhattan(r.pose, s);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best ? { type: 'cell', x: best.x, z: best.z } : null;
}

/** 積荷のうち、この便でまだ処理していないビン */
export function unprocessedCargo(w: WorldState, r: Robot): number[] {
  const done = r.job?.type === 'deliver' ? (r.job.done ?? []) : [];
  return r.carrying.filter((id) => !done.includes(id));
}

/** 次に向かうステーション: 未処理のビンの行き先のうち一番近いもの（手動指定中は指定先） */
export function nextStationFor(w: WorldState, r: Robot): number | null {
  const left = unprocessedCargo(w, r);
  if (!left.length) return null;
  let best: number | null = null;
  let bd = Infinity;
  for (const id of left) {
    const b = w.bins[id];
    const st = b?.purpose === 'inbound' ? leastLoadedInboundStation(w, r.pose) : w.stations.find((s) => s.id === destinationOf(w, r, id));
    if (!st) continue;
    // ★ ピックのビンを先に届ける（入荷ステーションは列ができやすく、ピックのビンを抱えたまま並ぶと出荷が止まる）
    const d = manhattan(r.pose, st) + (st.kind === 'inbound' ? 100000 : 0);
    if (d < bd) {
      bd = d;
      best = st.id;
    }
  }
  return best;
}

/** このステーションで処理すべき未処理ビン（手動指定なら全部） */
export function cargoForStation(w: WorldState, r: Robot, stationId: number): number[] {
  const left = unprocessedCargo(w, r);
  if (r.job?.type === 'deliver' && r.job.manual) return left;
  const st = w.stations.find((s) => s.id === stationId);
  if (st?.kind === 'inbound') return left.filter((id) => w.bins[id]?.purpose === 'inbound'); // 入荷ビンはどの入荷ステーションでも処理できる
  return left.filter((id) => destinationOf(w, r, id) === stationId);
}

/** 取り出したビンの行き先: 空ビン、または需要が無く入荷待ちがある商品なら入荷ステーション */
export function defaultPurpose(w: WorldState, bin: { item: string | null; qty: number }): 'pick' | 'inbound' {
  if (!bin.item || bin.qty <= 0) return 'inbound';
  const waiting = w.pallets.some((p) => p.item === bin.item);
  if (!waiting) return 'pick';
  const needed = visibleOrders(w).some((o) => o.lines.some((l) => l.item === bin.item && l.picked < l.qty));
  return needed ? 'pick' : 'inbound';
}

// ------------------------------------------------------------------ movement
export function executeMovement(w: WorldState, rt: Runtime, r: Robot): void {
  if (r.actRemaining > 0) {
    r.actRemaining--;
    if (r.actRemaining > 0) return;
    if (r.phase === 'moving' || r.phase === 'turning') {
      if (r.moveTo) r.pose = { ...r.moveTo };
      r.moveTo = null;
      r.phase = 'idle';
    } else if (r.phase === 'waiting') {
      r.phase = 'idle';
    } else {
      return; // lifting / loading / working は job 側で phase を戻す
    }
    // 動作が終わった tick 内で次のステップを始める（予約した時刻どおりに動くため）
  }
  if (r.phase !== 'idle') return;
  const plan = rt.plans.get(r.id);
  if (!plan || !plan.length) return;
  const next = plan[0];
  if (next.start > w.tick) return;
  // レイアウトが変わって通れなくなっていたら計画を捨てて引き直す。
  // 進む先に同じ層のロボが実際に居る（購入で置かれた直後など、予約表に載る前のロボ）ときも進まずに引き直す（重なりを物理的に防ぐ）
  if (next.type !== 'wait') {
    const pass = passableFor(w, r);
    const shape = shapeOf(r);
    const cells = next.type === 'turn' ? turnSweep(next.from, next.to.dir) : footprint(next.to, shape, []);
    if (!cells.every((c) => pass(c.x, c.z)) || cellsOccupiedByOthers(w, r, cells)) {
      rt.plans.delete(r.id);
      rt.needsPlan.add(r.id);
      return;
    }
  }
  plan.shift();
  const remaining = Math.max(1, next.end - w.tick);
  if (next.type === 'wait') {
    r.phase = 'waiting';
    r.actTotal = remaining;
    r.actRemaining = remaining;
  } else {
    r.moveTo = { ...next.to };
    if (next.type === 'move' && r.kind !== 'amr') r.pose.dir = next.to.dir;
    if (next.type === 'move' && r.cargoLevel !== 1) r.pose.dir = next.to.dir;
    r.phase = next.type === 'move' ? 'moving' : 'turning';
    r.actTotal = next.end - next.start;
    r.actRemaining = remaining;
  }
}

/** cells のどれかを、同じ層の他ロボが今占有している（居る、または移動中の行き先にしている）か */
function cellsOccupiedByOthers(w: WorldState, r: Robot, cells: Vec2[]): boolean {
  const mine = new Set(footprint(r.pose, shapeOf(r), []).map((c) => `${c.x},${c.z}`));
  const keys = new Set(cells.map((c) => `${c.x},${c.z}`).filter((k) => !mine.has(k)));
  if (!keys.size) return false;
  const layer = layerOf(r);
  for (const o of w.robots) {
    if (o === r || layerOf(o) !== layer) continue;
    const shape = shapeOf(o);
    for (const c of footprint(o.pose, shape, [])) if (keys.has(`${c.x},${c.z}`)) return true;
    if (o.moveTo) for (const c of footprint(o.moveTo, shape, [])) if (keys.has(`${c.x},${c.z}`)) return true;
  }
  return false;
}

export function updateStuck(w: WorldState, r: Robot): void {
  const wants = !!r.goal && !atGoal(w, r);
  if (wants && (r.phase === 'idle' || r.phase === 'waiting')) r.stuckTicks++;
  else r.stuckTicks = 0;
}

// ------------------------------------------------------------------ jobs
export function updateJob(w: WorldState, rt: Runtime, r: Robot): void {
  if (r.actRemaining > 0) return;
  if (!r.job) {
    if (r.queue.length) {
      r.job = r.queue.shift()!;
      r.step = 0;
    } else return;
  }
  const job = r.job;
  switch (job.type) {
    case 'retrieve':
      return shelfRetrieve(w, rt, r, job);
    case 'store':
      return shelfStore(w, rt, r, job);
    case 'relocate':
      return shelfRelocate(w, rt, r, job);
    case 'merge':
      return shelfMerge(w, rt, r, job);
    case 'fetch':
      return amrFetch(w, rt, r, job);
    case 'deliver':
      return amrDeliver(w, rt, r, job);
    case 'return':
      return amrReturn(w, rt, r, job);
    case 'park': {
      setGoal(rt, r, { type: 'cell', x: job.x, z: job.z });
      if (atGoal(w, r)) finishJob(w, rt, r);
      return;
    }
  }
}

/**
 * 棚ロボ: 取り出し（掘り出し付き）
 *  0: 対象スタックへ → 頂上が目的ビンなら持ち上げ(→10)、違えば頂上を持ち上げ(→11)
 *  10: 目的ビンを積んだ → ポートへ(→20)
 *  11: 退避ビンを積んだ → 退避先スタックへ(→12)
 *  12: 退避先に着いた → 降ろす(→13)
 *  13: 退避先に置いた → 対象へ戻る(→0)
 *  20: ポートに着いた → 空きがあれば降ろす(→21)
 *  21: ポートに置いた → 完了
 */
function shelfRetrieve(w: WorldState, rt: Runtime, r: Robot, job: Extract<ShelfJob, { type: 'retrieve' }>): void {
  const stack = w.stacks.find((s) => s.id === job.stackId);
  const port = w.ports.find((p) => p.id === job.portId);
  if (!stack || !port || !w.bins[job.binId]) return finishJob(w, rt, r);
  const lt = liftTicks(r);
  switch (r.step) {
    case 0: {
      if (!stack.bins.includes(job.binId)) return finishJob(w, rt, r); // ビンがもう無い
      setGoal(rt, r, { type: 'cell', x: stack.x, z: stack.z });
      if (!atGoal(w, r)) return;
      const top = stack.bins[stack.bins.length - 1];
      if (top === job.binId) {
        beginAction(r, 'lifting', lt, 10);
      } else if (isDoubleDecker(r) && stack.bins[stack.bins.length - 2] === job.binId) {
        // ★ ダブルデッカー: 目的ビンの上が 1 個だけなら、それを持ち上げたまま目的ビンも取り、上のビンはその場で戻す（退避先への往復なし）
        beginAction(r, 'lifting', lt, 14);
      } else {
        // 掘り出し: 退避先が必要
        const temp = pickStackWithRoom(w, stack, stack.id, ROBOT.digLevelWeight, stack.bins[stack.bins.length - 1]);
        if (!temp) return; // 空きが無い → 待つ
        r.digging = { targetStackId: stack.id, movedBins: r.digging?.movedBins ?? [], tempStackId: temp.id };
        beginAction(r, 'lifting', lt, 11);
      }
      return;
    }
    case 10: {
      stack.bins.pop();
      r.carrying.push(job.binId);
      const bin = w.bins[job.binId];
      if (!bin.purpose) bin.purpose = defaultPurpose(w, bin);
      r.phase = 'idle';
      r.step = 20;
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      return;
    }
    case 11: {
      const top = stack.bins.pop()!;
      r.carrying.push(top);
      r.phase = 'idle';
      // ダブルデッカー: 2 個目も持てて、まだ目的ビンが頂上でなければ続けて持ち上げる（退避の往復を半分に）
      if (r.carrying.length < shelfSlots(r) && stack.bins.length && stack.bins[stack.bins.length - 1] !== job.binId) {
        beginAction(r, 'lifting', lt, 11);
        return;
      }
      r.step = 12;
      const temp = w.stacks.find((s) => s.id === r.digging!.tempStackId)!;
      setGoal(rt, r, { type: 'cell', x: temp.x, z: temp.z });
      return;
    }
    case 14: {
      // ダブルデッカー: 上のビンを持ち上げた → 続けて目的ビンを持ち上げる
      r.carrying.push(stack.bins.pop()!);
      beginAction(r, 'lifting', lt, 15);
      return;
    }
    case 15: {
      // 目的ビンも持ち上げた（2 段持ち）→ 上のビンを元のスタックへ戻す
      const target = stack.bins.pop()!;
      r.carrying.push(target);
      const bin = w.bins[target];
      if (!bin.purpose) bin.purpose = defaultPurpose(w, bin);
      beginAction(r, 'lifting', lt, 16);
      return;
    }
    case 16: {
      const idx = r.carrying.findIndex((id) => id !== job.binId);
      if (idx >= 0) stack.bins.push(r.carrying.splice(idx, 1)[0]);
      r.phase = 'idle';
      r.step = 20;
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      return;
    }
    case 12: {
      const temp = w.stacks.find((s) => s.id === r.digging?.tempStackId);
      if (!temp || temp.bins.length >= w.levels) {
        // 退避先が埋まった → 別を探す
        const alt = pickStackWithRoom(w, r.pose, stack.id, ROBOT.digLevelWeight, r.carrying[0]);
        if (!alt) return;
        r.digging!.tempStackId = alt.id;
        setGoal(rt, r, { type: 'cell', x: alt.x, z: alt.z });
        return;
      }
      setGoal(rt, r, { type: 'cell', x: temp.x, z: temp.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 13);
      return;
    }
    case 13: {
      const temp = w.stacks.find((s) => s.id === r.digging!.tempStackId)!;
      temp.bins.push(r.carrying.pop()!);
      r.digging!.movedBins.push(temp.bins[temp.bins.length - 1]);
      r.phase = 'idle';
      if (r.carrying.length) {
        // ダブルデッカー: もう 1 個も降ろす（退避先に空きが無ければ 12 で別を探す）
        r.step = 12;
        return;
      }
      r.step = 0;
      setGoal(rt, r, { type: 'cell', x: stack.x, z: stack.z });
      return;
    }
    case 20: {
      if (port.outbound.length >= PORT.outboundCapacity || port.closed) {
        // 満杯（または停止）なら、空いている別のポートへ回る。無ければその場で待つ
        const alt = leastLoadedPort(w, r.pose, (p) => p.id !== port.id && p.outbound.length < PORT.outboundCapacity);
        if (alt) {
          job.portId = alt.id;
          setGoal(rt, r, { type: 'cell', x: alt.x, z: alt.z });
          return;
        }
        setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
        return;
      }
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 21);
      return;
    }
    case 21: {
      const i = r.carrying.indexOf(job.binId);
      port.outbound.push(i >= 0 ? r.carrying.splice(i, 1)[0] : r.carrying.pop()!);
      r.carried = (r.carried ?? 0) + 1;
      r.phase = 'idle';
      finishJob(w, rt, r);
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/**
 * 棚ロボ: 再配置。目的のビンが頂上になるまで上のビンを隣へ退避する（取り出しの掘り出し部分と同じ）
 *  0: 対象へ → 頂上なら完了。違えば頂上を持ち上げ(→11) / 11: 退避先へ(→12) / 12: 降ろす(→13) / 13: 戻る(→0)
 */
function shelfRelocate(w: WorldState, rt: Runtime, r: Robot, job: Extract<ShelfJob, { type: 'relocate' }>): void {
  const stack = w.stacks.find((s) => s.id === job.stackId);
  if (!stack || !stack.bins.includes(job.binId)) return finishJob(w, rt, r);
  const lt = liftTicks(r);
  switch (r.step) {
    case 0: {
      if (stack.bins[stack.bins.length - 1] === job.binId) return finishJob(w, rt, r);
      setGoal(rt, r, { type: 'cell', x: stack.x, z: stack.z });
      if (!atGoal(w, r)) return;
      const temp = pickStackWithRoom(w, stack, stack.id, ROBOT.digLevelWeight, stack.bins[stack.bins.length - 1]);
      if (!temp) return finishJob(w, rt, r);
      r.digging = { targetStackId: stack.id, movedBins: r.digging?.movedBins ?? [], tempStackId: temp.id };
      beginAction(r, 'lifting', lt, 11);
      return;
    }
    case 11: {
      r.carrying = [stack.bins.pop()!];
      r.phase = 'idle';
      r.step = 12;
      const temp = w.stacks.find((s) => s.id === r.digging!.tempStackId)!;
      setGoal(rt, r, { type: 'cell', x: temp.x, z: temp.z });
      return;
    }
    case 12: {
      let temp = w.stacks.find((s) => s.id === r.digging?.tempStackId) ?? null;
      if (!temp || temp.bins.length >= w.levels) {
        temp = pickStackWithRoom(w, r.pose, stack.id, ROBOT.digLevelWeight, r.carrying[0]);
        if (!temp) return;
        r.digging!.tempStackId = temp.id;
      }
      setGoal(rt, r, { type: 'cell', x: temp.x, z: temp.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 13);
      return;
    }
    case 13: {
      const temp = w.stacks.find((s) => s.id === r.digging!.tempStackId)!;
      temp.bins.push(r.carrying.pop()!);
      r.phase = 'idle';
      r.step = 0;
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/**
 * 棚ロボ: ビンの統合（★ 空ビンが無く欠品商品を詰められないときのデッドロック解消）
 *  0: 元のスタックへ → 頂上の binId を持ち上げ(→1)
 *  1: 持った → 相手のスタックへ(→2)
 *  2: 着いた → 相手が頂上にあり、足して容量以内なら注ぐ(→3)。だめなら戻す(→4)
 *  3: 注いだ（相手に合算、持っているビンは空に）→ 元のスタックへ(→4)
 *  4: 元のスタック（空きが無ければ近くの空きスタック）に着いた → 降ろす(→5)
 *  5: 置いた → 完了。空ビンが頂上にできたので補充 AI が使う
 */
function shelfMerge(w: WorldState, rt: Runtime, r: Robot, job: Extract<ShelfJob, { type: 'merge' }>): void {
  const from = w.stacks.find((s) => s.id === job.stackId);
  const to = w.stacks.find((s) => s.id === job.toStackId);
  const lt = liftTicks(r);
  switch (r.step) {
    case 0: {
      if (!from || from.bins[from.bins.length - 1] !== job.binId) return finishJob(w, rt, r);
      setGoal(rt, r, { type: 'cell', x: from.x, z: from.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 1);
      return;
    }
    case 1: {
      if (!from || from.bins[from.bins.length - 1] !== job.binId) return finishJob(w, rt, r);
      r.carrying = [from.bins.pop()!];
      r.phase = 'idle';
      r.step = 2;
      setGoal(rt, r, null);
      return;
    }
    case 2: {
      const target = to ? w.bins[job.targetBinId] : undefined;
      const mine = w.bins[job.binId];
      const ok = to && target && mine && to.bins[to.bins.length - 1] === job.targetBinId && target.item === mine.item && target.item !== null && target.qty + mine.qty <= w.binCapacity;
      if (!ok) {
        r.step = 4; // 相手が変わってしまった → 戻すだけ
        setGoal(rt, r, null);
        return;
      }
      setGoal(rt, r, { type: 'cell', x: to.x, z: to.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 3);
      return;
    }
    case 3: {
      const target = w.bins[job.targetBinId];
      const mine = w.bins[job.binId];
      if (target && mine && target.item === mine.item && target.qty + mine.qty <= w.binCapacity) {
        target.qty += mine.qty;
        mine.qty = 0;
        mine.item = null;
        mine.purpose = null;
        w.events.push({ type: 'notice', icon: 'info', text: `${r.name} がビンをまとめて空ビンを作りました` });
      }
      r.phase = 'idle';
      r.step = 4;
      setGoal(rt, r, null);
      return;
    }
    case 4: {
      let dest = from && from.bins.length < w.levels ? from : null;
      if (!dest) dest = pickStackWithRoom(w, r.pose, undefined, ROBOT.storeLevelWeight, r.carrying[0]);
      if (!dest) return; // どこにも置けない → 空くまで待つ
      setGoal(rt, r, { type: 'cell', x: dest.x, z: dest.z });
      if (!atGoal(w, r)) return;
      if (dest.bins.length >= w.levels) {
        setGoal(rt, r, null);
        return;
      }
      r.digging = null;
      beginAction(r, 'lifting', lt, 5);
      (r as Robot & { mergeDest?: number }).mergeDest = dest.id;
      return;
    }
    case 5: {
      const destId = (r as Robot & { mergeDest?: number }).mergeDest;
      const dest = w.stacks.find((s) => s.id === destId) ?? pickStackWithRoom(w, r.pose, undefined, ROBOT.storeLevelWeight, r.carrying[0]);
      if (!dest || dest.bins.length >= w.levels) {
        r.step = 4;
        r.phase = 'idle';
        return;
      }
      dest.bins.push(r.carrying.pop()!);
      r.phase = 'idle';
      finishJob(w, rt, r);
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/**
 * 棚ロボ: 格納（ポートの返却ビンをスタックの頂上へ）
 *  0: ポートへ → 返却ビンがあれば持ち上げ(→1)
 *  1: 積んだ → 空きスタックへ(→2)
 *  2: スタックに着いた → 降ろす(→3)
 *  3: 置いた → 完了
 */
function shelfStore(w: WorldState, rt: Runtime, r: Robot, job: Extract<ShelfJob, { type: 'store' }>): void {
  const port = w.ports.find((p) => p.id === job.portId);
  if (!port) return finishJob(w, rt, r);
  const lt = liftTicks(r);
  switch (r.step) {
    case 0: {
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      if (!atGoal(w, r)) return;
      if (!port.returns.length) return finishJob(w, rt, r);
      beginAction(r, 'lifting', lt, 1);
      return;
    }
    case 1: {
      const idx = job.binId !== null ? port.returns.indexOf(job.binId) : -1;
      const bin = idx >= 0 ? port.returns.splice(idx, 1)[0] : port.returns.shift()!;
      r.carrying = [bin];
      w.bins[bin].purpose = null;
      r.phase = 'idle';
      r.step = 2;
      return;
    }
    case 2: {
      let stack = job.stackId !== null ? w.stacks.find((s) => s.id === job.stackId) ?? null : null;
      if (!stack || stack.bins.length >= w.levels || lockedStacks(w).has(stack.id)) stack = pickStackWithRoom(w, r.pose, undefined, ROBOT.storeLevelWeight, r.carrying[0]);
      if (!stack) {
        setGoal(rt, r, null);
        return; // 置き場が無い → 持ったまま待つ
      }
      job.stackId = stack.id;
      setGoal(rt, r, { type: 'cell', x: stack.x, z: stack.z });
      if (!atGoal(w, r)) return;
      beginAction(r, 'lifting', lt, 3);
      return;
    }
    case 3: {
      const stack = w.stacks.find((s) => s.id === job.stackId);
      if (stack && stack.bins.length < w.levels && !lockedStacks(w).has(stack.id)) {
        stack.bins.push(r.carrying.pop()!);
        r.carried = (r.carried ?? 0) + 1;
        r.phase = 'idle';
        finishJob(w, rt, r);
      } else {
        r.phase = 'idle';
        r.step = 2;
      }
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/**
 * 搬送ロボ: ポートで積む
 *  0: ポート隣へ → 出庫ビンがあり容量に余裕 → 積む(→1)。無ければ積荷があれば配送へ、空なら待つ
 *  1: 1個積んだ(→0)
 */
function amrFetch(w: WorldState, rt: Runtime, r: Robot, job: Extract<AmrJob, { type: 'fetch' }>): void {
  const port = w.ports.find((p) => p.id === job.portId);
  if (!port) return finishJob(w, rt, r);
  switch (r.step) {
    case 0: {
      // 混雑制御: 横付けできる台数を超えていたら待機スポットで順番待ち（ドローンは上から着けるので対象外）
      if (!isDrone(r) && (!atGoal(w, r) || job.staged)) {
        const busy = headingTo(w, 'port', port.id, r);
        if (busy >= approachCapacity(w, port.x, port.z)) {
          job.staged = true;
          const g = stagingGoal(w, r);
          if (g && !(r.goal?.type === 'cell' && w.waitSpots.some((s) => s.x === r.pose.x && s.z === r.pose.z))) setGoal(rt, r, g);
          return;
        }
        job.staged = false;
      }
      setGoal(rt, r, dockGoal(r, port));
      if (!atGoal(w, r)) return;
      const loadable = nextLoadableBin(w, r, port);
      if (loadable !== null && r.carrying.length < cargoCapacity(r)) {
        beginAction(r, 'loading', ROBOT.loadTicksPerBin, 1);
        return;
      }
      if (r.carrying.length) {
        r.job = { type: 'deliver', stationId: job.stationId ?? -1, manual: job.manual && job.stationId !== null, done: [] };
        if (job.stationId === null) {
          const next = nextStationFor(w, r);
          if (next === null) return finishJob(w, rt, r);
          r.job.stationId = next;
        }
        r.step = 0;
        setGoal(rt, r, null);
        return;
      }
      if (!job.manual) return finishJob(w, rt, r); // 自動指示で空振り → 終了
      return; // 手動: ビンが来るまで待つ
    }
    case 1: {
      const idx = nextLoadableBin(w, r, port);
      if (idx !== null) r.carrying.push(port.outbound.splice(idx, 1)[0]);
      r.phase = 'idle';
      r.step = 0;
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

function purposeOf(w: WorldState, binId: number): 'pick' | 'inbound' {
  return w.bins[binId]?.purpose === 'inbound' ? 'inbound' : 'pick';
}

/** 次にポートから積むビンの添字（行き先が違っても積み重ねて運び、巡回で届ける）。優先設定に合うものから */
function nextLoadableBin(w: WorldState, r: Robot, port: WorldState['ports'][number]): number | null {
  if (!port.outbound.length) return null;
  // 専任（fetch.only）は最初の 1 個を必ずその行き先のビンにする（無ければ積まない）。残りの積載は同じ行き先を優先しつつ他のビンでも埋める（巡回で届ける）
  const only = r.job?.type === 'fetch' ? r.job.only : undefined;
  if (only && !r.carrying.length) {
    const idx = port.outbound.findIndex((id) => purposeOf(w, id) === only);
    return idx >= 0 ? idx : null;
  }
  const pri = w.automation.amrPriority;
  // 積む順: 積んでいるビンと同じ行き先。空なら優先設定（均等でもピックを先に: オーダーが待っている）
  const want = r.carrying.length ? purposeOf(w, r.carrying[0]) : pri === 'restock' ? 'inbound' : 'pick';
  if (want) {
    const idx = port.outbound.findIndex((id) => purposeOf(w, id) === want);
    if (idx >= 0) return idx;
  }
  return 0;
}

/**
 * 搬送ロボ: ステーションを巡回して配送する
 *  0: ステーション隣へ → ここで処理するビンが無ければ次のステーションへ。あれば作業開始(→1)
 *  1: ステーション側（pickers.ts）が処理し、done に積む。このステーションのぶんが終わったら次へ、全部終われば返却へ
 */
function amrDeliver(w: WorldState, rt: Runtime, r: Robot, job: Extract<AmrJob, { type: 'deliver' }>): void {
  if (!job.done) job.done = [];
  if (!r.carrying.length) return finishJob(w, rt, r);
  let st = w.stations.find((s) => s.id === job.stationId);
  if (!st && r.phase === 'working') r.phase = 'idle'; // 作業中にステーションが撤去された → 作業待ちのまま固まらない
  if (!st || !cargoForStation(w, r, st.id).length) {
    // このステーションでやることが無い → 次のステーション、無ければ返却
    const next = nextStationFor(w, r);
    if (next === null) {
      r.job = { type: 'return', portId: null, manual: job.manual };
      r.step = 0;
      setGoal(rt, r, null);
      return;
    }
    job.stationId = next;
    job.manual = false;
    r.step = 0;
    st = w.stations.find((s) => s.id === next)!;
  }
  if (r.step === 0) {
    // 混雑制御: 横付けできる台数を超えていたら待機スポットで順番待ち（ドローンは対象外）
    if (!isDrone(r) && (!atGoal(w, r) || job.staged)) {
      const busy = headingTo(w, 'station', st.id, r);
      if (busy >= approachCapacity(w, st.x, st.z)) {
        // ★ 入荷ステーションの順番待ちなら、空いている別の入荷ステーションがあればそちらへ
        if (st.kind === 'inbound') {
          const alt = w.stations.find((s) => s.kind === 'inbound' && s.id !== st!.id && headingTo(w, 'station', s.id, r) < approachCapacity(w, s.x, s.z));
          if (alt) {
            job.stationId = alt.id;
            job.staged = false;
            setGoal(rt, r, null);
            return;
          }
        }
        job.staged = true;
        const g = stagingGoal(w, r);
        if (g && !w.waitSpots.some((s) => s.x === r.pose.x && s.z === r.pose.z)) setGoal(rt, r, g);
        else if (!g) setGoal(rt, r, null);
        return;
      }
      job.staged = false;
    }
    setGoal(rt, r, dockGoal(r, st));
    if (!atGoal(w, r)) return;
    if (st.work && st.work.robotId !== r.id) return; // 他のロボを処理中 → 待つ
    r.phase = 'working';
    r.step = 1;
    return;
  }
  if (r.phase === 'working') return; // ステーション待ち
  // ステーション側がこのステーションのぶんを処理し終えた → ループ先頭で次を決める
  r.step = 0;
}

/**
 * 搬送ロボ: ビンをポートへ返す
 *  0: 返却スペースのあるポート隣へ → 1個降ろす(→1)
 *  1: 降ろした(→0)。全部降ろしたら完了
 */
function amrReturn(w: WorldState, rt: Runtime, r: Robot, job: Extract<AmrJob, { type: 'return' }>): void {
  if (!r.carrying.length) return finishJob(w, rt, r);
  let port = job.portId !== null ? w.ports.find((p) => p.id === job.portId) ?? null : null;
  if (!port || port.returns.length >= PORT.returnCapacity || port.closed) {
    port = leastLoadedPort(w, r.pose, (p) => p.returns.length < PORT.returnCapacity, (p) => p.returns.length) ?? nearestPort(w, r.pose.x, r.pose.z);
    if (!port) return finishJob(w, rt, r);
    job.portId = port.id;
  }
  switch (r.step) {
    case 0: {
      setGoal(rt, r, dockGoal(r, port));
      if (!atGoal(w, r)) return;
      if (port.returns.length >= PORT.returnCapacity) return; // 満杯 → 待つ
      beginAction(r, 'loading', ROBOT.loadTicksPerBin, 1);
      return;
    }
    case 1: {
      const bin = r.carrying.shift()!;
      w.bins[bin].purpose = null;
      port.returns.push(bin);
      r.carried = (r.carried ?? 0) + 1; // ポート → ステーション → ポートの 1 往復で 1
      r.phase = 'idle';
      r.step = 0;
      if (!r.carrying.length) finishJob(w, rt, r);
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/** 表示用: ロボの状態を短い日本語に */
export function describeRobot(w: WorldState, r: Robot): string {
  const job = r.job as RobotJob | null;
  const overPort = isDrone(r) && w.ports.some((p) => p.x === r.pose.x && p.z === r.pose.z);
  if (!job) return r.phase === 'moving' ? '移動中' : overPort ? 'ポートの上で待機中' : '待機中';
  switch (job.type) {
    case 'retrieve': {
      const b = w.bins[job.binId];
      const what = b?.item ? itemDef(b.item).name : '空ビン';
      if (r.step === 11 || r.step === 12 || r.step === 13) return `掘り出し中（${what}）`;
      if (r.step >= 14 && r.step <= 16) return `2 段持ちで取り出し中（${what}）`;
      if (r.step >= 20) return `ポートへ運搬中（${what}）`;
      return `取り出しへ（${what}）`;
    }
    case 'store':
      return r.carrying.length ? '棚へ格納中' : 'ポートで返却ビンを回収';
    case 'relocate':
      return '在庫を並べ替え中';
    case 'merge': {
      const b = w.bins[job.targetBinId];
      return `ビンをまとめて空ビンを作る（${b?.item ? itemDef(b.item).name : ''}）`;
    }
    case 'fetch':
      return r.phase === 'loading' ? '積み込み中' : job.staged ? 'ポートの順番待ち' : job.only === 'inbound' ? 'ポートへ（入荷専任）' : 'ポートへ';
    case 'deliver': {
      const left = unprocessedCargo(w, r).length;
      if (job.staged) return `ステーションの順番待ち（${left} ビン）`;
      return r.phase === 'working' ? '作業待ち' : `ステーションへ配送中（残り ${left} ビン）`;
    }
    case 'return':
      return 'ポートへ返却中';
    case 'park':
      if (isDrone(r)) return overPort && job.x === r.pose.x && job.z === r.pose.z ? 'ポートの上で待機中' : 'ポートの上へ';
      return '待機スポットへ';
  }
}

export { moveTicksFor };
