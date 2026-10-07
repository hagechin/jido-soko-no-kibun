import type { CellKind } from '../data/balance';
import type { Dir, Vec2, WorldState } from './types';

export const DIRS: readonly Vec2[] = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

export function cellIndex(w: WorldState, x: number, z: number): number {
  return z * w.width + x;
}

export function inBounds(w: WorldState, x: number, z: number): boolean {
  return x >= 0 && z >= 0 && x < w.width && z < w.height;
}

export function cellAt(w: WorldState, x: number, z: number): CellKind | null {
  if (!inBounds(w, x, z)) return null;
  return w.cells[z * w.width + x];
}

export function setCell(w: WorldState, x: number, z: number, kind: CellKind): void {
  w.cells[z * w.width + x] = kind;
}

/** 搬送ロボが走れるセルか（床レイヤー）。ポートはレール下なので隣接セルから受け渡す */
export function isFloorWalkable(kind: CellKind | null): boolean {
  return kind === 'floor' || kind === 'waitSpot';
}

/** 棚ロボが走れるセルか（レールレイヤー） */
export function isRailWalkable(kind: CellKind | null): boolean {
  return kind === 'stack' || kind === 'port';
}

export function neighbors4(w: WorldState, x: number, z: number): Vec2[] {
  const out: Vec2[] = [];
  for (const d of DIRS) {
    const nx = x + d.x;
    const nz = z + d.z;
    if (inBounds(w, nx, nz)) out.push({ x: nx, z: nz });
  }
  return out;
}

export function manhattan(a: Vec2, b: Vec2): number {
  return Math.abs(a.x - b.x) + Math.abs(a.z - b.z);
}

export function dirBetween(from: Vec2, to: Vec2): Dir {
  const dx = to.x - from.x;
  const dz = to.z - from.z;
  if (dx > 0) return 0;
  if (dz > 0) return 1;
  if (dx < 0) return 2;
  return 3;
}

export function sameCell(a: Vec2, b: Vec2): boolean {
  return a.x === b.x && a.z === b.z;
}

/** 棚エリアの縁に隣接しているか（ポートの配置ルール §8） */
export function isAdjacentToStack(w: WorldState, x: number, z: number): boolean {
  return neighbors4(w, x, z).some((n) => cellAt(w, n.x, n.z) === 'stack');
}

/** 床に面しているか（ステーションの配置ルール §8） */
export function isFacingFloor(w: WorldState, x: number, z: number): boolean {
  return neighbors4(w, x, z).some((n) => isFloorWalkable(cellAt(w, n.x, n.z)));
}

/** 対象セルに隣接する、床として歩けるセル一覧 */
export function approachCells(w: WorldState, x: number, z: number): Vec2[] {
  return neighbors4(w, x, z).filter((n) => {
    const k = cellAt(w, n.x, n.z);
    return k === 'floor' || k === 'waitSpot';
  });
}
