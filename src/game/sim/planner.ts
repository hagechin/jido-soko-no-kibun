/**
 * 再計画サイクル（§4.3）。
 * 予約表を作り直し、止まっているロボ → 動くロボ（詰まり時間が長い順）の順に経路を引く。
 * 先に計画したロボは、まだ計画していないロボの現在位置を「ずっと塞がっている」とみなすので安全側。
 */
import { PATHING, ROBOT } from '../data/balance';
import { footprint, shapeFor } from './footprint';
import { atGoal, makeGoalTest, passableFor } from './goals';
import { findPath, moveTicksFor, reservePath, type PlanRequest } from './pathfinding';
import { rand } from './rng';
import type { Runtime } from './runtime';
import type { Robot, Vec2, WorldState } from './types';

function layerOf(rt: Runtime, r: Robot) {
  return r.kind === 'shelf' ? rt.rail : rt.floor;
}

function reserveCells(rt: Runtime, w: WorldState, r: Robot, cells: Vec2[], from: number, to: number): void {
  const t = layerOf(rt, r);
  for (const c of cells) t.reserve(c.z * w.width + c.x, from, to, r.id);
}

function occupancyNow(r: Robot): Vec2[] {
  const shape = shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
  const cells = footprint(r.pose, shape, []);
  if (r.moveTo) cells.push(...footprint(r.moveTo, shape, []));
  return cells;
}

/** 動く必要があるロボか */
function wantsToMove(w: WorldState, r: Robot): boolean {
  return !!r.goal && !atGoal(w, r) && (r.phase === 'idle' || r.phase === 'moving' || r.phase === 'waiting' || r.phase === 'turning');
}

export function replanAll(w: WorldState, rt: Runtime): void {
  const now = w.tick;
  rt.floor.clear();
  rt.rail.clear();
  rt.plans.clear();
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
  for (const r of movers) r.stuckTicks += 0; // no-op（型の都合）
  movers.sort((a, b) => {
    if (b.stuckTicks !== a.stuckTicks) return b.stuckTicks - a.stuckTicks;
    const am = a.job?.manual ? 1 : 0;
    const bm = b.job?.manual ? 1 : 0;
    if (am !== bm) return bm - am;
    return a.id - b.id;
  });

  for (const r of movers) {
    const table = layerOf(rt, r);
    table.release(r.id);
    // 進行中の動作（移動・旋回）はそのまま完了させる
    const startTick = now + r.actRemaining;
    const start = r.moveTo ?? r.pose;
    if (r.actRemaining > 0) reserveCells(rt, w, r, occupancyNow(r), now, startTick);

    const goal = r.goal!;
    const { isGoal, cells } = makeGoalTest(w, r, goal);
    const req: PlanRequest = {
      robotId: r.id,
      start,
      startTick,
      shape: shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel),
      moveTicks: moveTicksFor(r.speedLevel),
      turnTicks: ROBOT.turnTicks,
      passable: passableFor(w, r),
      isGoal,
      goalCells: cells,
      width: w.width,
      table,
      holdTicks: PATHING.dwellReserveTicks,
    };
    let path = findPath(req);
    if (!path && r.stuckTicks >= PATHING.stuckTicks) {
      // 退避: 近くの空きセルへ逃げて膠着を崩す（§4.3 デッドロック検出）
      path = findEscape(w, r, req);
    }
    if (path) {
      reservePath(req, path, true);
      rt.plans.set(r.id, path);
    } else {
      // 動けない: その場に留まる
      const cells2 = footprint(start, req.shape, []);
      reserveCells(rt, w, r, cells2, startTick, Infinity);
    }
  }
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
      holdTicks: 1,
      maxExpansions: 1500,
      horizon: 80,
    });
    if (path && path.length) return path;
  }
  return null;
}
