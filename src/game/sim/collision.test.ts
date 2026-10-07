/**
 * M4: 衝突回避（§4.3）。
 * ロボを増やしてランダムな目的地へ動かし続け、衝突ゼロ・永久停止ゼロを確認する。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, addRobot } from './world';
import { createRuntime, stepSim } from './sim';
import { footprint, shapeFor, turnSweep } from './footprint';
import { isFloorWalkable, isRailWalkable, cellAt } from './grid';
import { rand } from './rng';
import type { Robot, Vec2, WorldState } from './types';
import { PATHING } from '../data/balance';

function occupancy(r: Robot): Vec2[] {
  const shape = shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
  const cells = footprint(r.pose, shape, []);
  if (r.moveTo) {
    if (r.phase === 'turning') cells.push(...turnSweep(r.pose, r.moveTo.dir));
    else cells.push(...footprint(r.moveTo, shape, []));
  }
  return cells;
}

function checkNoCollision(w: WorldState): string | null {
  for (const layer of ['shelf', 'amr'] as const) {
    const seen = new Map<string, number>();
    for (const r of w.robots) {
      if (r.kind !== layer) continue;
      for (const c of occupancy(r)) {
        const k = `${c.x},${c.z}`;
        const other = seen.get(k);
        if (other !== undefined && other !== r.id) return `tick ${w.tick}: ${layer} robots ${other} and ${r.id} both occupy ${k}`;
        seen.set(k, r.id);
      }
      // 通行不能セルに入っていないこと
      for (const c of footprint(r.pose, shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel), [])) {
        const k = cellAt(w, c.x, c.z);
        const ok = layer === 'shelf' ? isRailWalkable(k) : isFloorWalkable(k);
        if (!ok) return `tick ${w.tick}: robot ${r.id} on impassable cell ${c.x},${c.z} (${k})`;
      }
    }
  }
  return null;
}

function randomCell(w: WorldState, kind: 'shelf' | 'amr'): Vec2 {
  const cells: Vec2[] = [];
  for (let z = 0; z < w.height; z++)
    for (let x = 0; x < w.width; x++) {
      const k = cellAt(w, x, z);
      if (kind === 'shelf' ? isRailWalkable(k) : isFloorWalkable(k)) cells.push({ x, z });
    }
  return cells[Math.floor(rand(w.rng) * cells.length)];
}

/** ロボにランダムな目的地を与え続けて ticks 進める。到達回数と最大の詰まり時間を返す */
function randomWalk(w: WorldState, ticks: number) {
  const rt = createRuntime();
  w.nextOrderTick = 1e9;
  const arrivals = new Map<number, number>();
  const maxStuck = new Map<number, number>();
  const lastArrival = new Map<number, number>();
  for (const r of w.robots) {
    arrivals.set(r.id, 0);
    maxStuck.set(r.id, 0);
    lastArrival.set(r.id, 0);
  }
  let maxNoProgress = 0;
  for (let t = 0; t < ticks; t++) {
    for (const r of w.robots) {
      if (!r.job) {
        if (t > 0) {
          arrivals.set(r.id, arrivals.get(r.id)! + 1);
          lastArrival.set(r.id, t);
        }
        const c = randomCell(w, r.kind);
        r.job = { type: 'park', x: c.x, z: c.z, manual: true };
        r.step = 0;
      }
    }
    stepSim(w, rt);
    const err = checkNoCollision(w);
    if (err) throw new Error(err);
    for (const r of w.robots) {
      maxStuck.set(r.id, Math.max(maxStuck.get(r.id)!, r.stuckTicks));
      maxNoProgress = Math.max(maxNoProgress, t - lastArrival.get(r.id)!);
    }
  }
  return { arrivals, maxStuck, maxNoProgress };
}

describe('collision avoidance (space-time reservations)', () => {
  it('8 AMRs + 3 shelf robots wander randomly for 10 minutes: no collisions, no permanent stalls', () => {
    const w = createWorld({ seed: 42 });
    const starts = [
      [9, 8],
      [10, 8],
      [11, 8],
      [2, 10],
      [5, 10],
      [12, 10],
      [14, 6],
    ];
    for (const [x, z] of starts) addRobot(w, 'amr', x, z);
    addRobot(w, 'shelf', w.stacks[5].x, w.stacks[5].z);
    addRobot(w, 'shelf', w.stacks[10].x, w.stacks[10].z);
    expect(w.robots.filter((r) => r.kind === 'amr')).toHaveLength(8);
    const { arrivals, maxStuck, maxNoProgress } = randomWalk(w, 6000);
    for (const r of w.robots) {
      expect(arrivals.get(r.id)!, `robot ${r.id} (${r.kind}) arrivals`).toBeGreaterThan(10);
      expect(maxStuck.get(r.id)!, `robot ${r.id} max stuck`).toBeLessThan(PATHING.stuckTicks * 6);
    }
    expect(maxNoProgress).toBeLessThan(900); // 誰も 90 秒以上目的地に着けないことはない
  });

  it('8 AMRs in a tight layout with 1-wide corridors keep moving', () => {
    // 幅1の通路が交差する狭い倉庫（ポート無し・スタックは壁代わり）
    const layout = [
      '............',
      '.SS.SS.SS.S.',
      '.SS.SS.SS.S.',
      '............',
      '.SS.SS.SS.S.',
      '.SS.SS.SS.S.',
      '............',
      'WWWWWWWW....',
    ];
    const w = createWorld({ seed: 7, layout, itemKinds: 0 });
    w.robots = w.robots.filter((r) => r.kind === 'amr');
    for (let i = 1; i < 8; i++) addRobot(w, 'amr', i, 7);
    const { arrivals, maxNoProgress } = randomWalk(w, 6000);
    for (const r of w.robots) expect(arrivals.get(r.id)!, `robot ${r.id} arrivals`).toBeGreaterThan(5);
    expect(maxNoProgress).toBeLessThan(1500);
  });

  it('shelf robots share the rail layer without collisions', () => {
    const w = createWorld({ seed: 3 });
    w.robots = w.robots.filter((r) => r.kind === 'shelf');
    for (const s of [1, 4, 7, 11]) addRobot(w, 'shelf', w.stacks[s].x, w.stacks[s].z);
    const { arrivals } = randomWalk(w, 3000);
    for (const r of w.robots) expect(arrivals.get(r.id)!).toBeGreaterThan(5);
  });

  it('mixed cargo levels avoid each other (footprints follow ROBOT.cargo; 1x2/2x2 paths are covered in pathfinding.test)', () => {
    const w = createWorld({ seed: 99 });
    w.robots = w.robots.filter((r) => r.kind === 'amr');
    addRobot(w, 'amr', 11, 8).cargoLevel = 1; // 尾は (10,8)
    addRobot(w, 'amr', 2, 10).cargoLevel = 2; // (2..3, 10..11)
    addRobot(w, 'amr', 13, 1).cargoLevel = 1; // 尾は (12,1)
    addRobot(w, 'amr', 6, 10).cargoLevel = 2;
    addRobot(w, 'amr', 13, 6);
    const { arrivals } = randomWalk(w, 4000);
    for (const r of w.robots) expect(arrivals.get(r.id)!, `robot ${r.id} cargo ${r.cargoLevel}`).toBeGreaterThan(3);
  });
});
