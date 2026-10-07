/**
 * ロボの動作実行と仕事の状態機械（§4 / §7）。
 * step の意味は各 job ごとに定義（コメント参照）。
 */
import { PORT, ROBOT } from '../data/balance';
import { manhattan } from './grid';
import { visibleOrders } from './orders';
import { atGoal, passableFor, sameGoal } from './goals';
import { footprint, shapeFor, turnSweep } from './footprint';
import { moveTicksFor } from './pathfinding';
import type { Runtime } from './runtime';
import type { AmrJob, Goal, Robot, RobotJob, ShelfJob, Stack, WorldState } from './types';

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
export function nearestPort(w: WorldState, x: number, z: number, filter?: (p: WorldState['ports'][number]) => boolean, includeClosed = false) {
  let best = null as WorldState['ports'][number] | null;
  let bd = Infinity;
  for (const p of w.ports) {
    if (p.closed && !includeClosed) continue;
    if (filter && !filter(p)) continue;
    const d = manhattan({ x, z }, p);
    if (d < bd) {
      bd = d;
      best = p;
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
    }
  }
  return locked;
}

/**
 * ビンを置けるスタック（空きがあり、掘り出し中でない）を選ぶ。
 * 低いスタックを優先して高さを平準化し、同じ高さなら近い方（levelWeight で重み付け）
 */
export function pickStackWithRoom(w: WorldState, near: { x: number; z: number }, exclude?: number, levelWeight = ROBOT.storeLevelWeight): Stack | null {
  const locked = lockedStacks(w);
  let best: Stack | null = null;
  let bs = Infinity;
  for (const s of w.stacks) {
    if (s.id === exclude || locked.has(s.id)) continue;
    if (s.bins.length >= w.levels) continue;
    const score = s.bins.length * levelWeight + manhattan(near, s);
    if (score < bs) {
      bs = score;
      best = s;
    }
  }
  return best;
}

/** ビンの行き先ステーション（§7.1）: 入荷行きなら入荷ST、それ以外は担当ピッカー、担当が無ければ一番近いピッキングST */
export function destinationOf(w: WorldState, r: Robot, binId: number): number | null {
  const b = w.bins[binId];
  if (!b) return null;
  if (b.purpose === 'inbound') return nearestStation(w, r.pose.x, r.pose.z, 'inbound')?.id ?? null;
  if (b.item) {
    const s = w.stations.find((s) => s.kind === 'pick' && s.assignedItems.includes(b.item!));
    if (s) return s.id;
  }
  return nearestStation(w, r.pose.x, r.pose.z, 'pick')?.id ?? null;
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
    const sid = destinationOf(w, r, id);
    const st = w.stations.find((s) => s.id === sid);
    if (!st) continue;
    const d = manhattan(r.pose, st);
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
  // レイアウトが変わって通れなくなっていたら計画を捨てて引き直す
  if (next.type !== 'wait') {
    const pass = passableFor(w, r);
    const cells = next.type === 'turn' ? turnSweep(next.from, next.to.dir) : footprint(next.to, shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel), []);
    if (!cells.every((c) => pass(c.x, c.z))) {
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
      } else {
        // 掘り出し: 退避先が必要
        const temp = pickStackWithRoom(w, stack, stack.id, ROBOT.digLevelWeight);
        if (!temp) return; // 空きが無い → 待つ
        r.digging = { targetStackId: stack.id, movedBins: r.digging?.movedBins ?? [], tempStackId: temp.id };
        beginAction(r, 'lifting', lt, 11);
      }
      return;
    }
    case 10: {
      stack.bins.pop();
      r.carrying = [job.binId];
      const bin = w.bins[job.binId];
      if (!bin.purpose) bin.purpose = defaultPurpose(w, bin);
      r.phase = 'idle';
      r.step = 20;
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      return;
    }
    case 11: {
      const top = stack.bins.pop()!;
      r.carrying = [top];
      r.phase = 'idle';
      r.step = 12;
      const temp = w.stacks.find((s) => s.id === r.digging!.tempStackId)!;
      setGoal(rt, r, { type: 'cell', x: temp.x, z: temp.z });
      return;
    }
    case 12: {
      const temp = w.stacks.find((s) => s.id === r.digging?.tempStackId);
      if (!temp || temp.bins.length >= w.levels) {
        // 退避先が埋まった → 別を探す
        const alt = pickStackWithRoom(w, r.pose, stack.id, ROBOT.digLevelWeight);
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
      r.step = 0;
      setGoal(rt, r, { type: 'cell', x: stack.x, z: stack.z });
      return;
    }
    case 20: {
      setGoal(rt, r, { type: 'cell', x: port.x, z: port.z });
      if (!atGoal(w, r)) return;
      if (port.outbound.length >= PORT.outboundCapacity) return; // 満杯 → 待つ
      beginAction(r, 'lifting', lt, 21);
      return;
    }
    case 21: {
      port.outbound.push(r.carrying.pop()!);
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
      const temp = pickStackWithRoom(w, stack, stack.id, ROBOT.digLevelWeight);
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
        temp = pickStackWithRoom(w, r.pose, stack.id, ROBOT.digLevelWeight);
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
      if (!stack || stack.bins.length >= w.levels || lockedStacks(w).has(stack.id)) stack = pickStackWithRoom(w, r.pose);
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
      setGoal(rt, r, { type: 'adjacent', x: port.x, z: port.z });
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
  const pri = w.automation.amrPriority;
  if (pri !== 'balanced') {
    const want = pri === 'pick' ? 'pick' : 'inbound';
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
    setGoal(rt, r, { type: 'adjacent', x: st.x, z: st.z });
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
  if (!port || port.returns.length >= PORT.returnCapacity) {
    port = nearestPort(w, r.pose.x, r.pose.z, (p) => p.returns.length < PORT.returnCapacity) ?? nearestPort(w, r.pose.x, r.pose.z);
    if (!port) return finishJob(w, rt, r);
    job.portId = port.id;
  }
  switch (r.step) {
    case 0: {
      setGoal(rt, r, { type: 'adjacent', x: port.x, z: port.z });
      if (!atGoal(w, r)) return;
      if (port.returns.length >= PORT.returnCapacity) return; // 満杯 → 待つ
      beginAction(r, 'loading', ROBOT.loadTicksPerBin, 1);
      return;
    }
    case 1: {
      const bin = r.carrying.shift()!;
      w.bins[bin].purpose = null;
      port.returns.push(bin);
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
  if (!job) return r.phase === 'moving' ? '移動中' : '待機中';
  switch (job.type) {
    case 'retrieve': {
      const b = w.bins[job.binId];
      const what = b?.item ? b.item : '空ビン';
      if (r.step === 11 || r.step === 12 || r.step === 13) return `掘り出し中（${what}）`;
      if (r.step >= 20) return `ポートへ運搬中（${what}）`;
      return `取り出しへ（${what}）`;
    }
    case 'store':
      return r.carrying.length ? '棚へ格納中' : 'ポートで返却ビンを回収';
    case 'relocate':
      return '在庫を並べ替え中';
    case 'fetch':
      return r.phase === 'loading' ? '積み込み中' : 'ポートへ';
    case 'deliver': {
      const left = unprocessedCargo(w, r).length;
      return r.phase === 'working' ? '作業待ち' : `ステーションへ配送中（残り ${left} ビン）`;
    }
    case 'return':
      return 'ポートへ返却中';
    case 'park':
      return '待機スポットへ';
  }
}

export { moveTicksFor };
