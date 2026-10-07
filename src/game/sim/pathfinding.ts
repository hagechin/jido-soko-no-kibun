/**
 * 時空間 A*（Cooperative A* / WHCA* 流）。
 * 状態 = (姿勢, tick)。移動は moveTicks、旋回は turnTicks、待機は 1 tick。
 * 複数マスを占有するロボは移動前後の占有マスすべてを予約表で確認する。
 */
import { PATHING, ROBOT } from '../data/balance';
import { DIR_VEC, footprint, opposite, turnLeft, turnRight, turnSweep, type Shape } from './footprint';
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
  /** 窓付き計画のマス数（省略時は PATHING.windowCells。Infinity で全経路） */
  window?: number;
}

interface Node {
  pose: Pose;
  t: number;
  g: number;
  f: number;
  h: number;
  parent: Node | null;
  step: PlanStep['type'];
}

function less(a: Node, b: Node): boolean {
  return a.f < b.f || (a.f === b.f && a.h < b.h);
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
      if (!less(a[i], a[p])) break;
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
        if (l < a.length && less(a[l], a[m])) m = l;
        if (r < a.length && less(a[r], a[m])) m = r;
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

/**
 * ヒューリスティック: ゴールから逆向きに BFS した「静的な最短歩数」× moveTicks。
 * マンハッタン距離だと袋小路で迷うので、通れないセルを考慮した正確な距離を使う。
 */
function heuristic(req: PlanRequest, p: Pose): number {
  const dm = distanceMap(req);
  const d = dm[(p.z + 2) * (req.width + 4) + (p.x + 2)];
  if (d === undefined || d < 0) return manhattanH(req, p);
  return d * req.moveTicks;
}

function manhattanH(req: PlanRequest, p: Pose): number {
  let best = Infinity;
  for (const g of req.goalCells) {
    const d = Math.abs(g.x - p.x) + Math.abs(g.z - p.z);
    if (d < best) best = d;
  }
  return best === Infinity ? 0 : best * req.moveTicks;
}

const distCache = new WeakMap<PlanRequest, Int32Array>();

/** ゴール（アンカーがゴール条件を満たすセル）からの逆 BFS。-1 = 到達不能 */
function distanceMap(req: PlanRequest): Int32Array {
  const hit = distCache.get(req);
  if (hit) return hit;
  const W = req.width + 4;
  // 高さは不明なので、ゴールと開始から十分大きく取る（座標 + 2 の余白付き）
  let maxZ = req.start.z;
  for (const g of req.goalCells) maxZ = Math.max(maxZ, g.z);
  const H = maxZ + 64;
  const dm = new Int32Array(W * H).fill(-1);
  const is22 = req.shape.w === 2;
  const okAt = (x: number, z: number) => {
    if (!req.passable(x, z)) return false;
    if (is22) return req.passable(x + 1, z) && req.passable(x, z + 1) && req.passable(x + 1, z + 1);
    return true;
  };
  const queue: number[] = [];
  const key = (x: number, z: number) => (z + 2) * W + (x + 2);
  // ゴールセル候補: goalCells の周辺でアンカーがゴール条件を満たすもの
  const seeds = new Set<number>();
  for (const g of req.goalCells) {
    for (let dz = -2; dz <= 2; dz++) {
      for (let dx = -2; dx <= 2; dx++) {
        const x = g.x + dx;
        const z = g.z + dz;
        if (!okAt(x, z)) continue;
        const ok = req.isGoal({ x, z, dir: 0 }) || req.isGoal({ x, z, dir: 1 }) || req.isGoal({ x, z, dir: 2 }) || req.isGoal({ x, z, dir: 3 });
        if (ok) seeds.add(key(x, z));
      }
    }
  }
  for (const k of seeds) {
    dm[k] = 0;
    queue.push(k);
  }
  let head = 0;
  while (head < queue.length) {
    const k = queue[head++];
    const z = Math.floor(k / W) - 2;
    const x = (k % W) - 2;
    const d = dm[k];
    for (const v of DIR_VEC) {
      const nx = x + v.x;
      const nz = z + v.z;
      if (nz + 2 < 0 || nz + 2 >= H || nx + 2 < 0 || nx + 2 >= W) continue;
      const nk = key(nx, nz);
      if (dm[nk] !== -1 || !okAt(nx, nz)) continue;
      dm[nk] = d + 1;
      queue.push(nk);
    }
  }
  distCache.set(req, dm);
  return dm;
}

function stateKey(req: PlanRequest, p: Pose, t: number): number {
  // 1×1 と 2×2 は向きが経路に影響しないので無視する（状態数を減らす）
  const dirMatters = req.shape.w === 1 && req.shape.l === 2;
  const cell = (p.z + 2) * (req.width + 4) + (p.x + 2); // 範囲外の座標も一意になるよう余白を持たせる
  return ((cell * 4 + (dirMatters ? p.dir : 0)) * 4096 + (t - req.startTick)) >>> 0;
}

/**
 * 経路を探索する。見つからなければ null。
 * 開始姿勢の占有は呼び出し側が予約済みであること。
 */
/** 計測用: 失敗理由のカウンタ */
export const pathStats = { unreachable: 0, exhausted: 0, open: 0, ok: 0, partial: 0, windowed: 0 };

export function findPath(req: PlanRequest): PlanStep[] | null {
  const r = findPathInner(req);
  return r;
}

function findPathInner(req: PlanRequest): PlanStep[] | null {
  const maxExp = req.maxExpansions ?? Math.max(PATHING.maxExpansions, req.width * req.width * PATHING.expansionsPerCellSq);
  const h0 = heuristic(req, req.start);
  const horizon = req.startTick + (req.horizon ?? Math.max(PATHING.horizonTicks, h0 * 2 + PATHING.horizonTicks / 2));
  // 静的に到達不能（通れないセルや無期限予約で囲まれている）なら探索しない
  if (!staticallyReachable(req)) {
    pathStats.unreachable++;
    return null;
  }
  // 高速パス: 予約を無視した最短経路がそのまま予約と衝突しなければ採用（開けた床ではほぼこれで決まる）
  const quick = quickPath(req);
  if (quick) {
    pathStats.ok++;
    return quick;
  }
  const open = new Heap();
  const closed = new Set<number>();
  const h0s = heuristic(req, req.start);
  const startNode: Node = { pose: req.start, t: req.startTick, g: 0, f: h0s, h: h0s, parent: null, step: 'wait' };
  open.push(startNode);
  let expansions = 0;
  const is12 = req.shape.w === 1 && req.shape.l === 2;
  /** 展開上限に達したときのための「一番ゴールに近づいた節点」 */
  let best: Node = startNode;
  // 窓付き計画: 開始から windowCells マス以上離れたら、そこまでの部分経路で返す（先は近づいてから引く）
  const windowTicks = (req.window ?? PATHING.windowCells) * req.moveTicks;

  while (open.size) {
    const n = open.pop()!;
    const key = stateKey(req, n.pose, n.t);
    if (closed.has(key)) continue;
    closed.add(key);
    if (n.h < best.h || (n.h === best.h && n.t < best.t)) best = n;
    if (++expansions > maxExp) {
      pathStats.exhausted++;
      return partialPath(req, best, startNode);
    }
    if (n.t - req.startTick >= windowTicks && n.h < startNode.h && n !== startNode) {
      // 窓の端まで来た: ここまでで返す（ゴールに近づいていること）
      const p = partialPath(req, n, startNode);
      if (p) {
        pathStats.windowed++;
        return p;
      }
    }

    if (req.isGoal(n.pose)) {
      // ゴールに留まれるか（他ロボが通る予定なら留まれない）
      footprint(n.pose, req.shape, fpA);
      if (cellsFree(req, fpA, n.t, n.t + req.holdTicks)) {
        pathStats.ok++;
        return reconstruct(n);
      }
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

/** 時間を無視した BFS。無期限に予約されたセルは壁とみなす */
function staticallyReachable(req: PlanRequest): boolean {
  const W = req.width;
  const is22 = req.shape.w === 2;
  const blocked = (x: number, z: number) => !req.passable(x, z) || req.table.isReservedForever(z * W + x, req.startTick, req.robotId);
  const okAt = (x: number, z: number) => {
    if (!is22) return !blocked(x, z);
    return !blocked(x, z) && !blocked(x + 1, z) && !blocked(x, z + 1) && !blocked(x + 1, z + 1);
  };
  const seen = new Set<number>();
  const queue: number[] = [];
  const key = (x: number, z: number) => (z + 2) * (W + 4) + (x + 2);
  queue.push(req.start.x, req.start.z);
  seen.add(key(req.start.x, req.start.z));
  let head = 0;
  let guard = 0;
  while (head < queue.length && guard++ < 20000) {
    const x = queue[head++];
    const z = queue[head++];
    const p: Pose = { x, z, dir: req.start.dir };
    if (req.isGoal(p) || (req.shape.l === 2 && req.shape.w === 1 && isGoalAnyDir(req, x, z))) return true;
    for (const v of DIR_VEC) {
      const nx = x + v.x;
      const nz = z + v.z;
      const k = key(nx, nz);
      if (seen.has(k) || !okAt(nx, nz)) continue;
      seen.add(k);
      queue.push(nx, nz);
    }
  }
  return false;
}

/**
 * 探索を打ち切ったとき、ゴールに最も近づける途中の節点までを経路にする（部分計画）。
 * 次の再計画でそこから続きを探す。終点に留まれない（他ロボが通る）なら諦める。
 */
function partialPath(req: PlanRequest, best: Node, start: Node): PlanStep[] | null {
  if (best === start || best.h >= start.h) return null;
  // 待機で終わる部分は切り落とす（動いた所で止まる）
  let n: Node = best;
  while (n.parent && n.step === 'wait') n = n.parent;
  if (!n.parent) return null;
  footprint(n.pose, req.shape, fpA);
  if (!cellsFree(req, fpA, n.t, n.t + req.holdTicks)) return null;
  pathStats.partial++;
  return reconstruct(n);
}

/**
 * 時間を無視した A*（1×1 / 2×2 のみ）。見つかった経路を時刻付きにして予約と照合し、衝突が無ければ返す。
 */
function quickPath(req: PlanRequest): PlanStep[] | null {
  if (req.shape.w === 1 && req.shape.l === 2) return null;
  const W = req.width;
  const key = (x: number, z: number) => (z + 2) * (W + 4) + (x + 2);
  const open = new Heap();
  const closed = new Set<number>();
  const h0 = heuristic(req, req.start);
  open.push({ pose: req.start, t: req.startTick, g: 0, f: h0, h: h0, parent: null, step: 'wait' });
  let goal: Node | null = null;
  let guard = 0;
  const fp: Vec2[] = [];
  while (open.size && guard++ < 4000) {
    const n = open.pop()!;
    const k = key(n.pose.x, n.pose.z);
    if (closed.has(k)) continue;
    closed.add(k);
    if (req.isGoal(n.pose)) {
      goal = n;
      break;
    }
    for (let d = 0; d < 4; d++) {
      const v = DIR_VEC[d];
      const np: Pose = { x: n.pose.x + v.x, z: n.pose.z + v.z, dir: d as Dir };
      if (closed.has(key(np.x, np.z))) continue;
      footprint(np, req.shape, fp);
      if (!fp.every((c) => req.passable(c.x, c.z))) continue;
      const t = n.t + req.moveTicks;
      const g = n.g + req.moveTicks;
      const h = heuristic(req, np);
      open.push({ pose: np, t, g, f: g + h, h, parent: n, step: 'move' });
    }
  }
  if (!goal) return null;
  // 予約と照合
  const steps = reconstruct(goal);
  const fpA: Vec2[] = [];
  const fpB: Vec2[] = [];
  for (const st of steps) {
    footprint(st.from, req.shape, fpA);
    footprint(st.to, req.shape, fpB);
    if (!cellsFree(req, fpA, st.start, st.end) || !cellsFree(req, fpB, st.start, st.end)) return null;
  }
  footprint(goal.pose, req.shape, fpA);
  if (!cellsFree(req, fpA, goal.t, goal.t + req.holdTicks)) return null;
  return steps;
}

function isGoalAnyDir(req: PlanRequest, x: number, z: number): boolean {
  for (let d = 0; d < 4; d++) if (req.isGoal({ x, z, dir: d as Dir })) return true;
  return false;
}

function push(open: Heap, parent: Node, pose: Pose, t: number, step: PlanStep['type'], req: PlanRequest): void {
  // g は tick ではなく「順位付け用コスト」。待機にはわずかなペナルティを付けて、動ける経路を先に試す
  const g = parent.g + (t - parent.t) + (step === 'wait' ? PATHING.waitPenalty : 0);
  const h = heuristic(req, pose);
  open.push({ pose, t, g, f: g + h, h, parent, step });
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
