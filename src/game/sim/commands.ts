/** 手動指示（§7.1 / §7.2）。1台につき最大3件まで予約 */
import { ROBOT } from '../data/balance';
import { leastLoadedPort, setGoal } from './robots';
import type { Runtime } from './runtime';
import type { Robot, RobotJob, WorldState } from './types';
import { tr } from '../i18n';

export type CommandResult = { ok: true } | { ok: false; reason: string };

/** 今の自動ジョブを割り込める状態か（積荷なし・開始直後） */
function interruptible(r: Robot): boolean {
  if (!r.job) return true;
  if (r.job.manual) return false;
  if (r.job.type === 'park') return true;
  if (r.carrying.length) return false;
  return r.step === 0 && r.actRemaining === 0;
}

function enqueue(w: WorldState, rt: Runtime, r: Robot, job: RobotJob): CommandResult {
  if (interruptible(r)) {
    r.job = job;
    r.step = 0;
    r.digging = null;
    r.phase = 'idle';
    setGoal(rt, r, null);
    return { ok: true };
  }
  if (r.queue.length >= ROBOT.maxQueuedCommands) return { ok: false, reason: tr(tr('予約は{0}件まで'), ROBOT.maxQueuedCommands) };
  // 手動は自動の予約より前に入れる
  const firstAuto = r.queue.findIndex((j) => !j.manual);
  if (firstAuto >= 0) r.queue.splice(firstAuto, 0, job);
  else r.queue.push(job);
  return { ok: true };
}

/** 棚ロボ: スタックのビンを取り出してポートへ */
export function commandRetrieve(w: WorldState, rt: Runtime, robotId: number, stackId: number, binId: number): CommandResult {
  const r = w.robots.find((r) => r.id === robotId);
  const stack = w.stacks.find((s) => s.id === stackId);
  if (!r || r.kind !== 'shelf') return { ok: false, reason: tr(tr('棚ロボを選んでください')) };
  if (!stack || !stack.bins.includes(binId)) return { ok: false, reason: tr(tr('そのビンは棚にありません')) };
  const port = leastLoadedPort(w, stack);
  if (!port) return { ok: false, reason: tr(tr('ポートがありません')) };
  // 同じビンへの重複指示は無視
  const dup = [r.job, ...r.queue].some((j) => j?.type === 'retrieve' && j.binId === binId);
  if (dup) return { ok: false, reason: tr(tr('すでに指示済み')) };
  return enqueue(w, rt, r, { type: 'retrieve', stackId, binId, portId: port.id, manual: true });
}

/** 搬送ロボ: ポートのビンを積めるだけ積んで担当ステーションへ */
export function commandFetch(w: WorldState, rt: Runtime, robotId: number, portId: number): CommandResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r || r.kind !== 'amr') return { ok: false, reason: tr(tr('搬送ロボを選んでください')) };
  if (!w.ports.some((p) => p.id === portId)) return { ok: false, reason: tr(tr('ポートがありません')) };
  return enqueue(w, rt, r, { type: 'fetch', portId, stationId: null, manual: true });
}

/** 搬送ロボ: 行き先のステーションを指定（積荷があれば配送先の変更） */
export function commandGoStation(w: WorldState, rt: Runtime, robotId: number, stationId: number): CommandResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r || r.kind !== 'amr') return { ok: false, reason: tr(tr('搬送ロボを選んでください')) };
  if (!w.stations.some((s) => s.id === stationId)) return { ok: false, reason: tr(tr('ステーションがありません')) };
  if (r.job?.type === 'fetch') {
    r.job.stationId = stationId;
    r.job.manual = true;
    return { ok: true };
  }
  if (r.job?.type === 'deliver' && r.phase !== 'working') {
    r.job.stationId = stationId;
    r.job.manual = true; // 残りの積荷を全部そこで処理する
    r.step = 0;
    setGoal(rt, r, null);
    return { ok: true };
  }
  const queuedFetch = r.queue.find((j) => j.type === 'fetch');
  if (queuedFetch && queuedFetch.type === 'fetch') {
    queuedFetch.stationId = stationId;
    return { ok: true };
  }
  return enqueue(w, rt, r, { type: 'deliver', stationId, manual: true, done: [] });
}

/** 指示の取り消し（現在の仕事は積荷が無ければ中断） */
export function commandCancel(w: WorldState, rt: Runtime, robotId: number): CommandResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r) return { ok: false, reason: tr(tr('ロボがいません')) };
  r.queue = [];
  if (r.job && !r.carrying.length && r.actRemaining === 0 && r.phase !== 'working') {
    r.job = null;
    r.step = 0;
    r.digging = null;
    setGoal(rt, r, null);
  }
  return { ok: true };
}
