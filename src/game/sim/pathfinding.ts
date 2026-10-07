/**
 * 時空間 A*（Cooperative A* / WHCA* 流）。
 * 状態 = (姿勢, tick)。移動は moveTicks、旋回は turnTicks、待機は 1 tick。
 * 複数マスを占有するロボは移動前後の占有マスすべてを予約表で確認する。
 */
import { PATHING, ROBOT } from '../data/balance';
import { DIR_VEC, footprint, opposite, poseKey, turnLeft, turnRight, turnSweep, type Shape } from './footprint';
import type { ReservationTable } from './reservation';
import type { Dir, Pose, Vec2 } from './types';

export interface PlanStep {
  type: 'move' | 'turn' | 'wait';
  from: Pose;
  to: Pose;
  start: number;
  end: number;
}

export interface PlanRequest {
  robotId: number;
  start: Pose;
  startTick: number;
  shape: Shape;
  moveTicks: number;
  turnTicks: number;
  /** セルが通行可能か */
  passable: (x: number, z: number) => boolean;
  /** アンカー姿勢がゴールか */
  isGoal: (p: Pose) => boolean;
  /** ヒューリスティック用のゴールセル群（アンカー座標） */
  goalCells: Vec2[];
  width: number;
  table: ReservationTable;
  /** ゴール到着後にその場に留まるために必要な空き時間 */
  holdTicks: number;
  maxExpansions?: number;
  horizon?: number;
}

interface Node {
  pose: Pose;
  t: number;
  g: number;
  f: number;
  parent: Node | null;
  step: PlanStep['type'];
}

/** 簡易二分ヒープ */
class Heap {
  private a: Node[] = [];
  get size() {
    return this.a.length;
  }
  push(n: Node) {
    const a = this.a;
    a.push(n);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }
  pop(): Node | undefined {
    const a = this.a;
    if (!a.length) return undefined;
    const top = a[0];
    const last = a.pop()!;
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }
}

const fpA: Vec2[] = [];
const fpB: Vec2[] = [];

function cellsFree(req: PlanRequest, cells: Vec2[], from: number, to: number): boolean {
  for (const c of cells) {
    if (!req.passable(c.x, c.z)) return false;
    if (req.table.isReserved(c.z * req.width + c.x, from, to, req.robotId)) return false;
  }
  return true;
}

function heuristic(req: PlanRequest, p: Pose): number {
  let best = Infinity;
  for (const g of req.goalCells) {
    const d = Math.abs(g.x - p.x) + Math.abs(g.z - p.z);
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best * req.moveTicks;
}

function stateKey(req: PlanRequest, p: Pose, t: number): string {
  // 1×1 と 2×2 は向きが経路に影響しないので無視する（状態数を減らす）
  const dirMatters = req.shape.w === 1 && req.shape.l === 2;
  return dirMatters ? `${poseKey(p)}@${t}` : `${p.x},${p.z}@${t}`;
}

/**
 * 経路を探索する。見つからなければ null。
 * 開始姿勢の占有は呼び出し側が予約済みであること。
 */
export function findPath(req: PlanRequest): PlanStep[] | null {
  const maxExp = req.maxExpansions ?? PATHING.maxExpansions;
  const horizon = req.startTick + (req.horizon ?? PATHING.horizonTicks);
  const open = new Heap();
  const closed = new Set<string>();
  const startNode: Node = { pose: req.start, t: req.startTick, g: 0, f: heuristic(req, req.start), parent: null, step: 'wait' };
  open.push(startNode);
  let expansions = 0;
  const is12 = req.shape.w === 1 && req.shape.l === 2;

  while (open.size) {
    const n = open.pop()!;
    const key = stateKey(req, n.pose, n.t);
    if (closed.has(key)) continue;
    closed.add(key);
    if (++expansions > maxExp) return null;

    if (req.isGoal(n.pose)) {
      // ゴールに留まれるか（他ロボが通る予定なら留まれない）
      footprint(n.pose, req.shape, fpA);
      if (cellsFree(req, fpA, n.t, n.t + req.holdTicks)) return reconstruct(n);
    }
    if (n.t >= horizon) continue;

    footprint(n.pose, req.shape, fpA);

    // 待機
    if (cellsFree(req, fpA, n.t, n.t + 1)) {
      push(open, n, n.pose, n.t + 1, 'wait', req);
    }

    // 移動
    const dirs: Dir[] = is12 ? [n.pose.dir, opposite(n.pose.dir)] : [0, 1, 2, 3];
    for (const d of dirs) {
      const v = DIR_VEC[d];
      const np: Pose = { x: n.pose.x + v.x, z: n.pose.z + v.z, dir: is12 ? n.pose.dir : d };
      footprint(np, req.shape, fpB);
      const end = n.t + req.moveTicks;
      if (!cellsFree(req, fpB, n.t, end)) continue;
      if (!cellsFree(req, fpA, n.t, end)) continue;
      push(open, n, np, end, 'move', req);
    }

    // 旋回（1×2 のみ。2×2 の空きが必要）
    if (is12) {
      for (const nd of [turnLeft(n.pose.dir), turnRight(n.pose.dir)]) {
        const sweep = turnSweep(n.pose, nd);
        const end = n.t + req.turnTicks;
        if (!cellsFree(req, sweep, n.t, end)) continue;
        push(open, n, { x: n.pose.x, z: n.pose.z, dir: nd }, end, 'turn', req);
      }
    }
  }
  return null;
}

function push(open: Heap, parent: Node, pose: Pose, t: number, step: PlanStep['type'], req: PlanRequest): void {
  const g = t - req.startTick;
  open.push({ pose, t, g, f: g + heuristic(req, pose), parent, step });
}

function reconstruct(n: Node): PlanStep[] {
  const steps: PlanStep[] = [];
  let cur: Node | null = n;
  while (cur && cur.parent) {
    steps.push({ type: cur.step, from: cur.parent.pose, to: cur.pose, start: cur.parent.t, end: cur.t });
    cur = cur.parent;
  }
  steps.reverse();
  // 連続する待機はまとめる
  const merged: PlanStep[] = [];
  for (const s of steps) {
    const last = merged[merged.length - 1];
    if (s.type === 'wait' && last && last.type === 'wait') last.end = s.end;
    else merged.push({ ...s });
  }
  return merged;
}

/** 経路の占有を予約表に書き込む（最後の姿勢は無期限） */
export function reservePath(req: PlanRequest, steps: PlanStep[], finalForever = true): void {
  const w = req.width;
  for (const s of steps) {
    if (s.type === 'turn') {
      for (const c of turnSweep(s.from, s.to.dir)) req.table.reserve(c.z * w + c.x, s.start, s.end, req.robotId);
    } else {
      for (const c of footprint(s.from, req.shape, [])) req.table.reserve(c.z * w + c.x, s.start, s.end, req.robotId);
      if (s.type === 'move') for (const c of footprint(s.to, req.shape, [])) req.table.reserve(c.z * w + c.x, s.start, s.end, req.robotId);
    }
  }
  const last = steps.length ? steps[steps.length - 1] : null;
  const finalPose = last ? last.to : req.start;
  const finalTick = last ? last.end : req.startTick;
  if (finalForever) {
    for (const c of footprint(finalPose, req.shape, [])) req.table.reserve(c.z * w + c.x, finalTick, Infinity, req.robotId);
  }
}

export function moveTicksFor(speedLevel: number): number {
  return ROBOT.moveTicksByLevel[Math.min(speedLevel, ROBOT.moveTicksByLevel.length - 1)];
}
