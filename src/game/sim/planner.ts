/**
 * 再計画サイクル（§4.3）。
 * 予約表を作り直し、止まっているロボ → 動くロボ（詰まり時間が長い順）の順に経路を引く。
 * 先に計画したロボは、まだ計画していないロボの現在位置を「ずっと塞がっている」とみなすので安全側。
 */
import { PATHING, ROBOT } from '../data/balance';
import { footprint, shapeFor } from './footprint';
import { atGoal, makeGoalTest, passableFor } from './goals';
import { findPath, moveTicksFor, reservePath, type PlanRequest, type PlanStep } from './pathfinding';
import { cellAt, DIRS, isFloorWalkable, isRailWalkable } from './grid';
import type { ReservationTable } from './reservation';
import { rand } from './rng';
import { stagingGoal } from './robots';
import type { Runtime } from './runtime';
import type { Robot, Vec2, WorldState } from './types';
import { isDrone, layerOf as robotLayer, occupancyOf, shapeOf, speedLevelOf } from './layers';
import { tr } from '../i18n';

function layerOf(rt: Runtime, r: Robot) {
  const l = robotLayer(r);
  return l === 'rail' ? rt.rail : l === 'air' ? rt.air : rt.floor;
}

function reserveCells(rt: Runtime, w: WorldState, r: Robot, cells: Vec2[], from: number, to: number): void {
  const t = layerOf(rt, r);
  for (const c of cells) t.reserve(c.z * w.width + c.x, from, to, r.id);
}

function occupancyNow(r: Robot): Vec2[] {
  return occupancyOf(r);
}

/** 動く必要があるロボか */
function wantsToMove(w: WorldState, r: Robot): boolean {
  return !!r.goal && !atGoal(w, r) && (r.phase === 'idle' || r.phase === 'moving' || r.phase === 'waiting' || r.phase === 'turning');
}

/**
 * 毎 tick 呼ぶ。dirty なら丸ごと作り直し、そうでなければ
 * 目標が変わった／計画が無い／詰まっているロボだけ引き直す（他ロボの予約はそのまま使う）。
 */
export function updatePlanning(w: WorldState, rt: Runtime): void {
  resolveOverlaps(w, rt);
  if (rt.dirty) {
    replanAll(w, rt);
    return;
  }
  const now = w.tick;
  if (now % PATHING.pruneIntervalTicks === 0) {
    rt.floor.prune(now);
    rt.rail.prune(now);
    rt.air.prune(now);
  }
  // 新しく現れたロボ（購入など）は現在位置を無期限予約しておく。そこを通る予定だった他ロボには経路を引き直させる（突っ込んで重ならないように）
  for (const r of w.robots) {
    if (rt.known.has(r.id)) continue;
    rt.known.add(r.id);
    const cells = occupancyNow(r);
    reserveCells(rt, w, r, cells, now, Infinity);
    const others = new Set<number>();
    for (const c of cells) layerOf(rt, r).othersAfter(c.z * w.width + c.x, now, r.id, others);
    for (const id of others) rt.needsPlan.add(id);
  }
  const periodic = now - rt.lastPlanTick >= PATHING.replanIntervalTicks;
  const movers = w.robots.filter((r) => {
    if (!wantsToMove(w, r)) return false;
    if (rt.needsPlan.has(r.id)) return true;
    if ((r.retreatUntil ?? 0) > now) return false; // 退避中: しばらくしてから再挑戦
    const plan = rt.plans.get(r.id);
    if (!plan || !plan.length) return periodic; // 経路が無い（詰まり）→ 周期的に再試行
    // 窓付き計画の続き: 残りが少なくなったら先を引く（止まらずに進める）。
    // ただし引いたばかりの短い部分経路（待ち → 1 マス）は、実行する前に毎 tick 引き直すと永久に動けないので、少し寝かせる
    if (plan.length <= PATHING.replanAheadSteps && !planReachesGoal(w, r, plan)) return now - (rt.planTick.get(r.id) ?? -Infinity) >= PATHING.replanIntervalTicks;
    return false;
  });
  if (!movers.length) return;
  if (periodic) rt.lastPlanTick = now;
  sortMovers(movers);
  // 1 tick に引く台数を絞って負荷をならす（残りは次の tick。詰まっているロボが先）
  let budget = PATHING.plansPerTick;
  for (const r of movers) {
    if (budget-- <= 0) {
      rt.needsPlan.add(r.id);
      continue;
    }
    planOne(w, rt, r);
  }
}

/** 計画の終点がゴールか（部分経路なら false） */
function planReachesGoal(w: WorldState, r: Robot, plan: PlanStep[]): boolean {
  const last = plan[plan.length - 1];
  if (!last || !r.goal) return true;
  return makeGoalTest(w, r, r.goal).isGoal(last.to);
}

function sortMovers(movers: Robot[]): void {
  movers.sort((a, b) => {
    if (b.stuckTicks !== a.stuckTicks) return b.stuckTicks - a.stuckTicks;
    const am = a.job?.manual ? 1 : 0;
    const bm = b.job?.manual ? 1 : 0;
    if (am !== bm) return bm - am;
    return a.id - b.id;
  });
}

/** 計測用カウンタ */
export const planStats = { calls: 0, found: 0, escapes: 0, ms: 0 };

/** 1 台ぶんの経路を引き直す（自分の予約だけ消して、他ロボの予約を避ける） */
function planOne(w: WorldState, rt: Runtime, r: Robot): void {
  const t0 = typeof performance !== 'undefined' ? performance.now() : 0;
  planStats.calls++;
  const now = w.tick;
  const table = layerOf(rt, r);
  rt.needsPlan.delete(r.id);
  rt.plans.delete(r.id);
  if (r.phase === 'waiting') {
    r.phase = 'idle';
    r.actRemaining = 0;
    r.actTotal = 0;
  }
  table.release(r.id);
  const startTick = now + r.actRemaining;
  const start = r.moveTo ?? r.pose;
  if (r.actRemaining > 0) reserveCells(rt, w, r, occupancyNow(r), now, startTick);
  const goal = r.goal!;
  const { isGoal, cells } = makeGoalTest(w, r, goal);
  // 同じマスに他ロボが重なっていたら（本来起きない）、開始マスではその予約を無視して抜け出せるようにする
  const overlapping = overlappingRobots(w, r);
  const req: PlanRequest = {
    robotId: r.id,
    start,
    pose: r.pose,
    ignoreAtStart: overlapping.size ? overlapping : undefined,
    startKeys: overlapping.size ? new Set(occupancyNow(r).map((c) => c.z * w.width + c.x)) : undefined,
    startTick,
    shape: shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel),
    moveTicks: moveTicksFor(speedLevelOf(r)),
    turnTicks: ROBOT.turnTicks,
    passable: passableFor(w, r),
    isGoal,
    goalCells: cells,
    width: w.width,
    table,
    holdTicks: PATHING.dwellReserveTicks,
  };
  let path = findPath(req);
  if (path) planStats.found++;
  if (!path && r.kind === 'amr' && !isDrone(r) && r.stuckTicks >= PATHING.retreatTicks) {
    // 長く行けない: その場に居座らず待機スポットへ退避して通路を空ける（本来の目標には後で再挑戦）
    const g = stagingGoal(w, r);
    if (g && g.type === 'cell' && !(g.x === start.x && g.z === start.z)) {
      const { isGoal, cells } = makeGoalTest(w, r, g);
      path = findPath({ ...req, isGoal, goalCells: cells });
      if (path) {
        r.retreatUntil = now + PATHING.retryAfterRetreatTicks;
        planStats.escapes++;
      }
    }
  }
  if (!path && r.stuckTicks >= PATHING.stuckTicks) {
    path = findEscape(w, r, req);
    if (path) planStats.escapes++;
  }
  // 無期限に居座るセル（到着後 or 動けない現在地）。そこを後で通る予定だった他ロボには経路を引き直させる
  let foreverCells: Vec2[];
  let foreverFrom: number;
  if (path) {
    reservePath(req, path, true);
    rt.plans.set(r.id, path);
    rt.planTick.set(r.id, now);
    const last = path.length ? path[path.length - 1] : null;
    foreverCells = footprint(last ? last.to : start, req.shape, []);
    foreverFrom = last ? last.end : startTick;
  } else {
    foreverCells = footprint(start, req.shape, []);
    foreverFrom = startTick;
    reserveCells(rt, w, r, foreverCells, startTick, Infinity);
  }
  const others = new Set<number>();
  for (const c of foreverCells) table.othersAfter(c.z * w.width + c.x, foreverFrom, r.id, others);
  for (const id of others) rt.needsPlan.add(id);
  if ((globalThis as { __planDebug?: (r: Robot, path: PlanStep[] | null, table: ReservationTable, now: number) => void }).__planDebug) (globalThis as { __planDebug?: (r: Robot, path: PlanStep[] | null, table: ReservationTable, now: number) => void }).__planDebug!(r, path, table, now);
  if (t0) planStats.ms += performance.now() - t0;
}

/** 同じ層で占有マスが重なっている他ロボ */
function overlappingRobots(w: WorldState, r: Robot): Set<number> {
  const mine = new Set(occupancyNow(r).map((c) => `${c.x},${c.z}`));
  const out = new Set<number>();
  for (const o of w.robots) {
    if (o === r || robotLayer(o) !== robotLayer(r)) continue;
    if (occupancyNow(o).some((c) => mine.has(`${c.x},${c.z}`))) out.add(o.id);
  }
  return out;
}

/**
 * 重なりの解消（★保険）: 同じマスに 2 台が overlapHealTicks 以上重なったままなら、片方（荷物を持っていない方、同じなら後の ID）を
 * 一番近い空いているマスへ移して、予約表を作り直す。経路計画は重なりを作らないはずだが、万一起きたときに何時間も固まらないため
 */
export function resolveOverlaps(w: WorldState, rt: Runtime): void {
  const seen = new Map<string, Robot>();
  const pairs: [Robot, Robot][] = [];
  for (const r of w.robots) {
    for (const c of occupancyNow(r)) {
      const k = `${robotLayer(r)}:${c.x},${c.z}`;
      const o = seen.get(k);
      if (o && o !== r && !pairs.some(([a, b]) => (a === o && b === r) || (a === r && b === o))) pairs.push([o, r]);
      seen.set(k, r);
    }
  }
  const overlapped = new Set<number>();
  for (const [a, b] of pairs) {
    overlapped.add(a.id);
    overlapped.add(b.id);
  }
  for (const id of [...rt.overlapTicks.keys()]) if (!overlapped.has(id)) rt.overlapTicks.delete(id);
  for (const id of overlapped) rt.overlapTicks.set(id, (rt.overlapTicks.get(id) ?? 0) + 1);
  for (const [a, b] of pairs) {
    const ticks = Math.min(rt.overlapTicks.get(a.id) ?? 0, rt.overlapTicks.get(b.id) ?? 0);
    if (ticks < PATHING.overlapHealTicks) continue;
    // 動いている最中（moveTo あり）は終わるまで待つ
    if (a.moveTo || b.moveTo) continue;
    const pick = (x: Robot, y: Robot) => (x.carrying.length !== y.carrying.length ? (x.carrying.length < y.carrying.length ? x : y) : x.id > y.id ? x : y);
    const mover = pick(a, b);
    const spot = nearestFreeCell(w, mover);
    if (!spot) continue;
    mover.pose = { x: spot.x, z: spot.z, dir: mover.pose.dir };
    mover.moveTo = null;
    mover.phase = 'idle';
    mover.actRemaining = 0;
    mover.actTotal = 0;
    mover.stuckTicks = 0;
    rt.plans.delete(mover.id);
    rt.overlapTicks.delete(mover.id);
    rt.dirty = true;
    w.events.push({ type: 'notice', icon: 'alert', text: tr(tr(tr('{0} が他のロボと同じマスに重なっていたので ({1},{2}) へ移しました')), mover.name, spot.x, spot.z) });
  }
}

/** 同じ層のロボが居ない（向かってもいない）一番近い通行可能マス（BFS） */
function nearestFreeCell(w: WorldState, r: Robot): Vec2 | null {
  const occ = new Set<string>();
  for (const o of w.robots) {
    if (o === r || robotLayer(o) !== robotLayer(r)) continue;
    for (const c of occupancyNow(o)) occ.add(`${c.x},${c.z}`);
  }
  const ok = passableFor(w, r);
  const seen = new Set<string>([`${r.pose.x},${r.pose.z}`]);
  const queue: Vec2[] = [{ x: r.pose.x, z: r.pose.z }];
  let head = 0;
  while (head < queue.length && head < 4000) {
    const c = queue[head++];
    if (!(c.x === r.pose.x && c.z === r.pose.z) && !occ.has(`${c.x},${c.z}`) && !w.ports.some((p) => p.x === c.x && p.z === c.z)) return c;
    for (const d of DIRS) {
      const n = { x: c.x + d.x, z: c.z + d.z };
      const k = `${n.x},${n.z}`;
      if (seen.has(k) || n.x < 0 || n.z < 0 || n.x >= w.width || n.z >= w.height || !ok(n.x, n.z)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return null;
}

export function replanAll(w: WorldState, rt: Runtime): void {
  const now = w.tick;
  rt.floor.clear();
  rt.rail.clear();
  rt.air.clear();
  rt.plans.clear();
  rt.needsPlan.clear();
  rt.known = new Set(w.robots.map((r) => r.id));
  rt.lastPlanTick = now;
  rt.dirty = false;

  // 計画の待機は打ち切る（新しい計画で上書きする）
  for (const r of w.robots) {
    if (r.phase === 'waiting') {
      r.phase = 'idle';
      r.actRemaining = 0;
      r.actTotal = 0;
    }
  }

  // 1. 全ロボの現在占有を無期限で予約（計画したロボから順に自分の分を引き直す）
  for (const r of w.robots) reserveCells(rt, w, r, occupancyNow(r), now, Infinity);

  // 2. 動くロボを優先度順に計画
  const movers = w.robots.filter((r) => wantsToMove(w, r));
  sortMovers(movers);
  for (const r of movers) planOne(w, rt, r);
}

/** 半径内のランダムな通行可能セルへ逃げる経路 */
function findEscape(w: WorldState, r: Robot, req: PlanRequest): ReturnType<typeof findPath> {
  const candidates: Vec2[] = [];
  const R = PATHING.escapeRadius;
  for (let dz = -R; dz <= R; dz++) {
    for (let dx = -R; dx <= R; dx++) {
      if (dx === 0 && dz === 0) continue;
      const x = req.start.x + dx;
      const z = req.start.z + dz;
      if (!req.passable(x, z)) continue;
      candidates.push({ x, z });
    }
  }
  // ランダムに数か所試す
  for (let i = 0; i < 6 && candidates.length; i++) {
    const idx = Math.floor(rand(w.rng) * candidates.length);
    const [c] = candidates.splice(idx, 1);
    const path = findPath({
      ...req,
      isGoal: (p) => p.x === c.x && p.z === c.z,
      goalCells: [c],
      holdTicks: PATHING.dwellReserveTicks,
      maxExpansions: 1500,
      horizon: 80,
    });
    if (path && path.length) return path;
  }
  return null;
}
