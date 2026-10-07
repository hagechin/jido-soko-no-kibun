/** ゴール判定（占有マスを考慮） */
import { approachCells, cellAt, isFloorWalkable, isRailWalkable } from './grid';
import { footprint, shapeFor } from './footprint';
import type { Goal, Pose, Robot, Vec2, WorldState } from './types';

export function passableFor(w: WorldState, r: Robot): (x: number, z: number) => boolean {
  if (r.kind === 'shelf') return (x, z) => isRailWalkable(cellAt(w, x, z));
  return (x, z) => isFloorWalkable(cellAt(w, x, z));
}

/** ゴールが「含むべきセル」の集合 */
export function goalTargetCells(w: WorldState, goal: Goal): Vec2[] {
  switch (goal.type) {
    case 'cell':
      return [{ x: goal.x, z: goal.z }];
    case 'adjacent':
      return approachCells(w, goal.x, goal.z);
    case 'any':
      return goal.cells;
  }
}

export function makeGoalTest(w: WorldState, r: Robot, goal: Goal): { isGoal: (p: Pose) => boolean; cells: Vec2[] } {
  const targets = goalTargetCells(w, goal);
  const keys = new Set(targets.map((c) => `${c.x},${c.z}`));
  const shape = shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
  const pass = passableFor(w, r);
  const tmp: Vec2[] = [];
  const isGoal = (p: Pose): boolean => {
    footprint(p, shape, tmp);
    let touches = false;
    for (const c of tmp) {
      if (!pass(c.x, c.z)) return false;
      if (keys.has(`${c.x},${c.z}`)) touches = true;
    }
    return touches;
  };
  return { isGoal, cells: targets };
}

export function atGoal(w: WorldState, r: Robot): boolean {
  if (!r.goal || r.moveTo) return false;
  return makeGoalTest(w, r, r.goal).isGoal(r.pose);
}

export function sameGoal(a: Goal | null, b: Goal | null): boolean {
  if (a === b) return true;
  if (!a || !b || a.type !== b.type) return false;
  if (a.type === 'any' && b.type === 'any') return a.cells.length === b.cells.length && a.cells.every((c, i) => c.x === b.cells[i].x && c.z === b.cells[i].z);
  if (a.type !== 'any' && b.type !== 'any') return a.x === b.x && a.z === b.z;
  return false;
}
