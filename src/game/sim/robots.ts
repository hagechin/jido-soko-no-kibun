/**
 * ロボの動作実行と仕事の状態機械（§4 / §7）。
 * step の意味は各 job ごとに定義（コメント参照）。
 */
import { PORT, ROBOT } from '../data/balance';
import { manhattan } from './grid';
import { atGoal, sameGoal } from './goals';
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
  rt.dirty = true;
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

export function nearestPort(w: WorldState, x: number, z: number, filter?: (p: WorldState['ports'][number]) => boolean) {
  let best = null as WorldState['ports'][number] | null;
  let bd = Infinity;
  for (const p of w.ports) {
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

/** ビンを格納できるスタック（空きがある）のうち near に最も近いもの */
export function pickStackWithRoom(w: WorldState, near: { x: number; z: number }, exclude?: number): Stack | null {
  let best: Stack | null = null;
  let bd = Infinity;
  for (const s of w.stacks) {
    if (s.id === exclude) continue;
    if (s.bins.length >= w.levels) continue;
    const d = manhattan(near, s);
    if (d < bd) {
      bd = d;
      best = s;
    }
  }
  return best;
}

/** 担当ピッカーのステーション（§7.1）。担当がいなければ一番近いピッキングST */
export function stationForBins(w: WorldState, r: Robot): number | null {
  const first = r.carrying.map((id) => w.bins[id]).find((b) => b);
  if (first?.purpose === 'inbound') return nearestStation(w, r.pose.x, r.pose.z, 'inbound')?.id ?? null;
  if (first?.item) {
    const s = w.stations.find((s) => s.kind === 'pick' && s.assignedItems.includes(first.item!));
    if (s) return s.id;
  }
  return nearestStation(w, r.pose.x, r.pose.z, 'pick')?.id ?? null;
}

// ------------------------------------------------------------------ movement
export function executeMovement(w: WorldState, rt: Runtime, r: Robot): void {
  if (r.actRemaining > 0) {
    r.actRemaining--;
    if (r.actRemaining === 0) {
      if (r.phase === 'moving' || r.phase === 'turning') {
        if (r.moveTo) r.pose = { ...r.moveTo };
        r.moveTo = null;
      }
      if (r.phase === 'moving' || r.phase === 'turning' || r.phase === 'waiting') r.phase = 'idle';
      // lifting / loading / working は job 側で phase を戻す
    }
    return;
  }
  if (r.phase !== 'idle') return;
  const plan = rt.plans.get(r.id);
  if (!plan || !plan.length) return;
  const next = plan[0];
  if (next.start > w.tick) return;
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
        const temp = pickStackWithRoom(w, stack, stack.id);
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
      bin.purpose = bin.purpose ?? 'pick';
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
        const alt = pickStackWithRoom(w, r.pose, stack.id);
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
      if (!stack || stack.bins.length >= w.levels) stack = pickStackWithRoom(w, r.pose);
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
      if (stack && stack.bins.length < w.levels) {
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
      if (port.outbound.length && r.carrying.length < cargoCapacity(r)) {
        beginAction(r, 'loading', ROBOT.loadTicksPerBin, 1);
        return;
      }
      if (r.carrying.length) {
        const stationId = job.stationId ?? stationForBins(w, r);
        if (stationId === null) return finishJob(w, rt, r);
        r.job = { type: 'deliver', stationId, manual: job.manual };
        r.step = 0;
        setGoal(rt, r, null);
        return;
      }
      if (!job.manual) return finishJob(w, rt, r); // 自動指示で空振り → 終了
      return; // 手動: ビンが来るまで待つ
    }
    case 1: {
      r.carrying.push(port.outbound.shift()!);
      r.phase = 'idle';
      r.step = 0;
      return;
    }
    default:
      finishJob(w, rt, r);
  }
}

/**
 * 搬送ロボ: ステーションへ配送し、作業を待つ
 *  0: ステーション隣へ → 積荷が無ければ完了。あれば作業開始(→1: 以降 step-1 が処理済みビン数)
 *  n≥1: ステーション側（pickers.ts）が進める。全ビン処理後に返却へ
 */
function amrDeliver(w: WorldState, rt: Runtime, r: Robot, job: Extract<AmrJob, { type: 'deliver' }>): void {
  const st = w.stations.find((s) => s.id === job.stationId);
  if (!st) return finishJob(w, rt, r);
  if (r.step === 0) {
    setGoal(rt, r, { type: 'adjacent', x: st.x, z: st.z });
    if (!atGoal(w, r)) return;
    if (!r.carrying.length) return finishJob(w, rt, r);
    if (st.work && st.work.robotId !== r.id) return; // 他のロボを処理中 → 待つ
    r.phase = 'working';
    r.step = 1;
    return;
  }
  if (r.phase === 'working') return; // ステーション待ち
  // 全ビン処理済み → 返却
  if (r.step - 1 >= r.carrying.length) {
    r.job = { type: 'return', portId: null, manual: job.manual };
    r.step = 0;
    setGoal(rt, r, null);
  }
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
    case 'fetch':
      return r.phase === 'loading' ? '積み込み中' : 'ポートへ';
    case 'deliver':
      return r.phase === 'working' ? '作業待ち' : 'ステーションへ配送中';
    case 'return':
      return 'ポートへ返却中';
    case 'park':
      return '待機スポットへ';
  }
}

export { moveTicksFor };
