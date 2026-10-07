/** 購入・アップグレード（§4.4 / §9.4）。コインの確認と上限チェックはすべてここで行う */
import { ROBOT } from '../data/balance';
import { cellAt, isFloorWalkable } from './grid';
import { addRobot } from './world';
import type { Robot, WorldState } from './types';

export type ShopResult = { ok: true } | { ok: false; reason: string };

function pay(w: WorldState, cost: number): ShopResult {
  if (w.coins < cost) return { ok: false, reason: `コインが足りません（${cost} 必要）` };
  w.coins -= cost;
  return { ok: true };
}

function occupiedCells(w: WorldState): Set<string> {
  const s = new Set<string>();
  for (const r of w.robots) {
    s.add(`${r.pose.x},${r.pose.z}`);
    if (r.moveTo) s.add(`${r.moveTo.x},${r.moveTo.z}`);
  }
  return s;
}

/** 棚ロボを追加（空いているスタックの上に置く） */
export function buyShelfRobot(w: WorldState): ShopResult {
  if (w.robots.filter((r) => r.kind === 'shelf').length >= ROBOT.maxShelfRobots) return { ok: false, reason: '棚ロボはこれ以上増やせません' };
  const occ = occupiedCells(w);
  const spot = w.stacks.find((s) => !occ.has(`${s.x},${s.z}`));
  if (!spot) return { ok: false, reason: '置き場所（空いているスタック）がありません' };
  const p = pay(w, ROBOT.shelfRobotCost);
  if (!p.ok) return p;
  addRobot(w, 'shelf', spot.x, spot.z);
  return { ok: true };
}

/** 搬送ロボを追加（空いている待機スポット → 空いている床） */
export function buyAmr(w: WorldState): ShopResult {
  if (w.robots.filter((r) => r.kind === 'amr').length >= ROBOT.maxAmrs) return { ok: false, reason: '搬送ロボはこれ以上増やせません' };
  const occ = occupiedCells(w);
  let spot = w.waitSpots.find((s) => !occ.has(`${s.x},${s.z}`)) ?? null;
  if (!spot) {
    outer: for (let z = 0; z < w.height; z++) {
      for (let x = 0; x < w.width; x++) {
        if (isFloorWalkable(cellAt(w, x, z)) && !occ.has(`${x},${z}`)) {
          spot = { x, z };
          break outer;
        }
      }
    }
  }
  if (!spot) return { ok: false, reason: '置き場所がありません' };
  const p = pay(w, ROBOT.amrCost);
  if (!p.ok) return p;
  addRobot(w, 'amr', spot.x, spot.z);
  return { ok: true };
}

export function speedUpgradeCost(r: Robot): number | null {
  if (r.speedLevel >= ROBOT.maxSpeedLevel) return null;
  return ROBOT.speedUpgradeCosts[Math.min(r.speedLevel, ROBOT.speedUpgradeCosts.length - 1)];
}

export function upgradeSpeed(w: WorldState, robotId: number): ShopResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r) return { ok: false, reason: 'ロボがいません' };
  const cost = speedUpgradeCost(r);
  if (cost === null) return { ok: false, reason: '速度は最大です' };
  const p = pay(w, cost);
  if (!p.ok) return p;
  r.speedLevel++;
  return { ok: true };
}

export function liftUpgradeCost(r: Robot): number | null {
  if (r.kind !== 'shelf' || r.liftLevel >= ROBOT.maxLiftLevel) return null;
  return ROBOT.liftUpgradeCosts[Math.min(r.liftLevel, ROBOT.liftUpgradeCosts.length - 1)];
}

export function upgradeLift(w: WorldState, robotId: number): ShopResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r) return { ok: false, reason: 'ロボがいません' };
  const cost = liftUpgradeCost(r);
  if (cost === null) return { ok: false, reason: 'リフト速度は最大です' };
  const p = pay(w, cost);
  if (!p.ok) return p;
  r.liftLevel++;
  return { ok: true };
}
