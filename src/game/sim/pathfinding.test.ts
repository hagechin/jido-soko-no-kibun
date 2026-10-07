import { describe, expect, it } from 'vitest';
import { findPath, reservePath, type PlanRequest } from './pathfinding';
import { ReservationTable } from './reservation';
import type { Pose } from './types';

function req(partial: Partial<PlanRequest> & { start: Pose; goal: { x: number; z: number } }, table = new ReservationTable()): PlanRequest {
  const W = 8;
  const blocked = new Set<string>(partial.passable ? [] : []);
  return {
    robotId: 1,
    startTick: 0,
    shape: { w: 1, l: 1 },
    moveTicks: 5,
    turnTicks: 3,
    passable: (x, z) => x >= 0 && z >= 0 && x < W && z < 8 && !blocked.has(`${x},${z}`),
    isGoal: (p) => p.x === partial.goal.x && p.z === partial.goal.z,
    goalCells: [partial.goal],
    width: W,
    table,
    holdTicks: 10,
    ...partial,
  };
}

describe('findPath (space-time A*)', () => {
  it('finds a straight path and reserves it', () => {
    const r = req({ start: { x: 0, z: 0, dir: 0 }, goal: { x: 3, z: 0 } });
    const path = findPath(r)!;
    expect(path).not.toBeNull();
    const moves = path.filter((s) => s.type === 'move');
    expect(moves).toHaveLength(3);
    expect(path[path.length - 1].end).toBe(15);
    reservePath(r, path);
    expect(r.table.ownersAt(3, 100)).toEqual([1]);
    expect(r.table.ownersAt(0, 2)).toEqual([1]);
  });

  it('waits for another robot that crosses the corridor', () => {
    const table = new ReservationTable();
    // ロボ2 が (2,0) を tick 0..10 に占有
    table.reserve(2, 0, 10, 2);
    const r = req({ start: { x: 0, z: 0, dir: 0 }, goal: { x: 3, z: 0 } }, table);
    // 1行しかない通路にするため z!=0 は通れない
    r.passable = (x, z) => z === 0 && x >= 0 && x < 8;
    const path = findPath(r)!;
    expect(path).not.toBeNull();
    const arrive = path[path.length - 1].end;
    expect(arrive).toBeGreaterThan(15);
    // 予約と重なっていないこと
    for (const s of path) {
      if (s.type !== 'move') continue;
      expect(table.isReserved(s.to.z * 8 + s.to.x, s.start, s.end, 1)).toBe(false);
    }
  });

  it('returns null when the goal is permanently blocked', () => {
    const table = new ReservationTable();
    table.reserve(3, 0, Infinity, 2);
    const r = req({ start: { x: 0, z: 0, dir: 0 }, goal: { x: 3, z: 0 } }, table);
    expect(findPath({ ...r, horizon: 60, maxExpansions: 2000 })).toBeNull();
  });

  it('1x2 robot needs a 2x2 area to turn and cannot enter a 1-wide dead end sideways', () => {
    // 幅1の縦通路 x=0 (z 0..5)。横向き(dir 0)のロボは旋回に 2×2 が要る
    const r = req({ start: { x: 1, z: 0, dir: 0 }, goal: { x: 1, z: 3 }, shape: { w: 1, l: 2 } });
    r.passable = (x, z) => x >= 0 && x < 3 && z >= 0 && z < 6;
    r.isGoal = (p) => p.x === 1 && p.z === 3;
    const path = findPath(r)!;
    expect(path).not.toBeNull();
    expect(path.some((s) => s.type === 'turn')).toBe(true);
    // 旋回の掃引領域はすべて通行可能
    for (const s of path) if (s.type === 'turn') expect(r.passable(s.from.x, s.from.z)).toBe(true);
  });

  it('2x2 robot cannot pass through a 1-wide gap', () => {
    const r = req({ start: { x: 0, z: 0, dir: 0 }, goal: { x: 5, z: 0 }, shape: { w: 2, l: 2 } });
    // x=3 の列は z=0 だけ通れる（幅1の隙間）
    r.passable = (x, z) => x >= 0 && x < 8 && z >= 0 && z < 4 && !(x === 3 && z !== 0);
    expect(findPath({ ...r, horizon: 100, maxExpansions: 3000 })).toBeNull();
    // 隙間を 2 マスにすれば通れる
    r.passable = (x, z) => x >= 0 && x < 8 && z >= 0 && z < 4 && !(x === 3 && z > 1);
    expect(findPath(r)).not.toBeNull();
  });
});
