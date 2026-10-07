/** 購入・アップグレード（§4.4 / §9.4）。コインの確認と上限チェックはすべてここで行う */
import { ROBOT } from '../data/balance';
import { cellAt, isFloorWalkable } from './grid';
import { addRobot, createBin } from './world';
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

// ---------------------------------------------------------------- 倉庫のアップグレード（§9.4）
import { BIN, LEVELS, PICKER, RANKS } from '../data/balance';
import { footprint, shapeFor } from './footprint';

export function levelUpgradeCost(w: WorldState): number | null {
  if (w.levels >= LEVELS.max) return null;
  return LEVELS.costs[Math.min(w.levels - 1, LEVELS.costs.length - 1)];
}

export function maxLevelsForRank(w: WorldState): number {
  return RANKS[Math.min(w.rank, RANKS.length - 1)].maxLevels;
}

/** 棚の段数 +1（全スタック） */
export function upgradeLevels(w: WorldState): ShopResult {
  const cost = levelUpgradeCost(w);
  if (cost === null) return { ok: false, reason: '段数は最大です' };
  if (w.levels >= maxLevelsForRank(w)) return { ok: false, reason: `段数 ${w.levels + 1} はランクアップで解放` };
  const p = pay(w, cost);
  if (!p.ok) return p;
  w.levels++;
  return { ok: true };
}

export function binCapacityUpgradeCost(w: WorldState): number | null {
  const n = (w.binCapacity - BIN.baseCapacity) / BIN.capacityUpgradeStep;
  if (n >= BIN.capacityUpgradeCosts.length) return null;
  return BIN.capacityUpgradeCosts[n];
}

export function upgradeBinCapacity(w: WorldState): ShopResult {
  const cost = binCapacityUpgradeCost(w);
  if (cost === null) return { ok: false, reason: 'ビン容量は最大です' };
  const p = pay(w, cost);
  if (!p.ok) return p;
  w.binCapacity += BIN.capacityUpgradeStep;
  return { ok: true };
}

export function cargoUpgradeCost(r: Robot): number | null {
  if (r.kind !== 'amr' || r.cargoLevel >= ROBOT.cargo.length - 1) return null;
  return ROBOT.cargoUpgradeCosts[r.cargoLevel];
}

/** 積載量 Lv アップ（機体ごと）。底面積が増えるので、今の位置で新しい占有マスが空いている必要がある */
export function upgradeCargo(w: WorldState, robotId: number): ShopResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r) return { ok: false, reason: 'ロボがいません' };
  const cost = cargoUpgradeCost(r);
  if (cost === null) return { ok: false, reason: '積載量は最大です' };
  if (r.moveTo || r.actRemaining > 0 || r.carrying.length) return { ok: false, reason: '停車中で積荷の無いときだけ改造できます' };
  const newShape = shapeFor(r.cargoLevel + 1);
  const cells = footprint(r.pose, newShape, []);
  const occ = occupiedCells(w);
  occ.delete(`${r.pose.x},${r.pose.z}`);
  for (const c of cells) {
    if (!isFloorWalkable(cellAt(w, c.x, c.z))) return { ok: false, reason: '周りに広い床が必要です（改造後の大きさぶん）' };
    if (occ.has(`${c.x},${c.z}`)) return { ok: false, reason: '隣に他のロボがいます' };
  }
  // 他ロボの占有（複数マス）とも重ならないか
  for (const o of w.robots) {
    if (o.id === r.id || o.kind !== 'amr') continue;
    const oc = footprint(o.pose, shapeFor(o.cargoLevel), []);
    if (o.moveTo) oc.push(...footprint(o.moveTo, shapeFor(o.cargoLevel), []));
    if (oc.some((a) => cells.some((b) => a.x === b.x && a.z === b.z))) return { ok: false, reason: '隣に他のロボがいます' };
  }
  const p = pay(w, cost);
  if (!p.ok) return p;
  r.cargoLevel++;
  return { ok: true };
}

/** 全スタックのスロット数 − 全ビン数（運搬中・ポート上も含む）。これが正なら買い足せる */
export function freeBinSlots(w: WorldState): number {
  const slots = w.stacks.length * w.levels;
  return slots - Object.keys(w.bins).length;
}

/** 掘り出し（退避）のために空けておくスロット数: 段数 + 棚ロボ台数（★） */
export function reservedSlots(w: WorldState): number {
  return w.levels + w.robots.filter((r) => r.kind === 'shelf').length;
}

/** 空ビンを買って、空きのあるスタックの頂上に置く（★）。掘り出し用の空きスロットは必ず残す（棚が満杯だと掘り出しが止まる） */
export function buyEmptyBin(w: WorldState): ShopResult {
  if (freeBinSlots(w) <= reservedSlots(w)) return { ok: false, reason: `掘り出し用に空きスロットを ${reservedSlots(w)} 個残す必要があります。段数を増やすかスタックを置いてください` };
  const stack = w.stacks.find((s) => s.bins.length < w.levels);
  if (!stack) return { ok: false, reason: '今は空いているスタックがありません（運搬中のビンが戻るまで待つ）' };
  const p = pay(w, BIN.emptyBinCost);
  if (!p.ok) return p;
  stack.bins.push(createBin(w, null, 0).id);
  return { ok: true };
}

export function pickerUpgradeCost(s: { level: number }): number | null {
  if (s.level >= PICKER.maxLevel) return null;
  return PICKER.upgradeCosts[Math.min(s.level, PICKER.upgradeCosts.length - 1)];
}

export function upgradePicker(w: WorldState, stationId: number): ShopResult {
  const s = w.stations.find((s) => s.id === stationId);
  if (!s || s.kind !== 'pick') return { ok: false, reason: 'ピッキングステーションがありません' };
  const cost = pickerUpgradeCost(s);
  if (cost === null) return { ok: false, reason: 'ピック速度は最大です' };
  const p = pay(w, cost);
  if (!p.ok) return p;
  s.level++;
  return { ok: true };
}

// ---------------------------------------------------------------- 自動化 AI（§7.3）
import { AUTOMATION } from '../data/balance';

export function buyAutomation(w: WorldState, id: string): ShopResult {
  const a = w.automation;
  if (id === 'dispatch') {
    if (a.dispatch >= AUTOMATION.dispatchCosts.length) return { ok: false, reason: '自動配車AI は最大です' };
    const need = [AUTOMATION.unlockRank.dispatch1, AUTOMATION.unlockRank.dispatch2, AUTOMATION.unlockRank.dispatch3][a.dispatch];
    if (w.rank < need) return { ok: false, reason: `ランク${need + 1}で解放` };
    const p = pay(w, AUTOMATION.dispatchCosts[a.dispatch]);
    if (!p.ok) return p;
    a.dispatch++;
    return { ok: true };
  }
  if (id === 'restock') {
    if (a.restock) return { ok: false, reason: '購入済み' };
    if (w.rank < AUTOMATION.unlockRank.restock) return { ok: false, reason: `ランク${AUTOMATION.unlockRank.restock + 1}で解放` };
    const p = pay(w, AUTOMATION.restockCost);
    if (!p.ok) return p;
    a.restock = true;
    return { ok: true };
  }
  if (id === 'relocate') {
    if (a.relocate) return { ok: false, reason: '購入済み' };
    if (w.rank < AUTOMATION.unlockRank.relocate) return { ok: false, reason: `ランク${AUTOMATION.unlockRank.relocate + 1}で解放` };
    const p = pay(w, AUTOMATION.relocateCost);
    if (!p.ok) return p;
    a.relocate = true;
    return { ok: true };
  }
  return { ok: false, reason: '不明なAI' };
}
