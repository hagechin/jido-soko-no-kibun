/**
 * ロボの占有マス（§4.2）。
 * 1×1: アンカーのみ / 1×2: アンカー＋後ろ 1 マス / 2×2: アンカーを左上とする 4 マス
 */
import { ROBOT } from '../data/balance';
import type { Dir, Pose, Vec2 } from './types';

export const DIR_VEC: readonly Vec2[] = [
  { x: 1, z: 0 },
  { x: 0, z: 1 },
  { x: -1, z: 0 },
  { x: 0, z: -1 },
];

export interface Shape {
  w: number;
  l: number;
}

export function shapeFor(cargoLevel: number): Shape {
  const c = ROBOT.cargo[Math.min(cargoLevel, ROBOT.cargo.length - 1)];
  return { w: c.w, l: c.l };
}

/** 占有セル一覧 */
export function footprint(pose: Pose, shape: Shape, out: Vec2[] = []): Vec2[] {
  out.length = 0;
  if (shape.w === 1 && shape.l === 1) {
    out.push({ x: pose.x, z: pose.z });
  } else if (shape.w === 1 && shape.l === 2) {
    const d = DIR_VEC[pose.dir];
    out.push({ x: pose.x, z: pose.z }, { x: pose.x - d.x, z: pose.z - d.z });
  } else {
    for (let dz = 0; dz < shape.l; dz++) for (let dx = 0; dx < shape.w; dx++) out.push({ x: pose.x + dx, z: pose.z + dz });
  }
  return out;
}

export function turnLeft(d: Dir): Dir {
  return ((d + 3) % 4) as Dir;
}
export function turnRight(d: Dir): Dir {
  return ((d + 1) % 4) as Dir;
}
export function opposite(d: Dir): Dir {
  return ((d + 2) % 4) as Dir;
}

/**
 * 1×2 が旋回するときに通過する 2×2 の領域。
 * アンカー（前）を軸に、後ろのマスが old → new へ振れるので、
 * アンカー・旧後方・新後方・その対角 の 4 マス。
 */
export function turnSweep(pose: Pose, newDir: Dir): Vec2[] {
  const od = DIR_VEC[pose.dir];
  const nd = DIR_VEC[newDir];
  const oldTail = { x: pose.x - od.x, z: pose.z - od.z };
  const newTail = { x: pose.x - nd.x, z: pose.z - nd.z };
  const diag = { x: pose.x - od.x - nd.x, z: pose.z - od.z - nd.z };
  return [{ x: pose.x, z: pose.z }, oldTail, newTail, diag];
}

export function poseKey(p: Pose): string {
  return `${p.x},${p.z},${p.dir}`;
}

export function samePose(a: Pose, b: Pose): boolean {
  return a.x === b.x && a.z === b.z && a.dir === b.dir;
}
