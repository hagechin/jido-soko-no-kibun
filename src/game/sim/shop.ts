/** 購入・アップグレード（§4.4 / §9.4）。コインの確認と上限チェックはすべてここで行う */
import { isDrone } from './layers';
import { ROBOT } from '../data/balance';
import { cellAt, isFloorWalkable } from './grid';
import { addRobot, createBin } from './world';
import type { Robot, Stack, WorldState } from './types';

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

/** 棚ロボを追加（空いているスタックの上に置く）。variant = 'double' でダブルデッカー（特別ロボ、棚ロボの上限に含む） */
export function buyShelfRobot(w: WorldState, variant: 'standard' | 'double' = 'standard'): ShopResult {
  if (w.robots.filter((r) => r.kind === 'shelf').length >= limitsFor(w).maxShelfRobots) return { ok: false, reason: `棚ロボはこれ以上増やせません（上限 ${limitsFor(w).maxShelfRobots} 台）` };
  const occ = occupiedCells(w);
  const spot = w.stacks.find((s) => !occ.has(`${s.x},${s.z}`));
  if (!spot) return { ok: false, reason: '置き場所（空いているスタック）がありません' };
  const p = pay(w, variant === 'double' ? ROBOT.doubleDeckerCost : ROBOT.shelfRobotCost);
  if (!p.ok) return p;
  addRobot(w, 'shelf', spot.x, spot.z, variant);
  return { ok: true };
}

export function buyDoubleDecker(w: WorldState): ShopResult {
  return buyShelfRobot(w, 'double');
}

/** ドローン搬送ロボを追加（特別ロボ）: 空中レイヤーなので、他のドローンが居ないマスならどこにでも置ける（待機スポット優先）。上限 maxDrones */
export function buyDrone(w: WorldState): ShopResult {
  const drones = w.robots.filter((r) => isDrone(r));
  if (drones.length >= ROBOT.maxDrones) return { ok: false, reason: `ドローンはこれ以上増やせません（上限 ${ROBOT.maxDrones} 台）` };
  const taken = new Set(drones.map((r) => `${r.pose.x},${r.pose.z}`));
  let spot = w.waitSpots.find((s) => !taken.has(`${s.x},${s.z}`)) ?? null;
  if (!spot) {
    outer: for (let z = 0; z < w.height; z++) {
      for (let x = 0; x < w.width; x++) {
        if (!taken.has(`${x},${z}`)) {
          spot = { x, z };
          break outer;
        }
      }
    }
  }
  if (!spot) return { ok: false, reason: '置き場所がありません' };
  const p = pay(w, ROBOT.droneCost);
  if (!p.ok) return p;
  addRobot(w, 'amr', spot.x, spot.z, 'drone');
  return { ok: true };
}

/** 搬送ロボを追加（空いている待機スポット → 空いている床） */
export function buyAmr(w: WorldState): ShopResult {
  if (w.robots.filter((r) => r.kind === 'amr' && !isDrone(r)).length >= limitsFor(w).maxAmrs) return { ok: false, reason: `搬送ロボはこれ以上増やせません（上限 ${limitsFor(w).maxAmrs} 台）` };
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

/**
 * デバッグ用: 全ロボの機体ステータスを最大にする（速度・リフト・積載量。コイン不要）。
 * 積載量は底面積が変わる設定のときだけ、改造後の占有マスが空いているロボに限る（今の設定ではビンを積み重ねるので底面積は変わらない）
 */
export function maxOutRobots(w: WorldState): { upgraded: number; skipped: number } {
  let upgraded = 0;
  let skipped = 0;
  for (const r of w.robots) {
    r.speedLevel = ROBOT.maxSpeedLevel;
    if (r.kind === 'shelf') r.liftLevel = ROBOT.maxLiftLevel;
    if (r.kind === 'amr') {
      const maxCargo = limitsFor(w).maxCargoLevel;
      const newShape = shapeFor(maxCargo);
      const oldShape = shapeFor(r.cargoLevel);
      if (r.cargoLevel < maxCargo && (newShape.w !== oldShape.w || newShape.l !== oldShape.l)) {
        const cells = footprint(r.pose, newShape, []);
        const occ = occupiedCells(w);
        occ.delete(`${r.pose.x},${r.pose.z}`);
        if (r.moveTo || r.actRemaining > 0 || cells.some((c) => !isFloorWalkable(cellAt(w, c.x, c.z)) || occ.has(`${c.x},${c.z}`))) {
          skipped++;
          continue;
        }
      }
      r.cargoLevel = maxCargo;
    }
    upgraded++;
  }
  return { upgraded, skipped };
}

/** 全ロボを最大まで強化（速度・リフト・積載）したときの合計コイン。全部最大なら null */
export function upgradeAllRobotsCost(w: WorldState): number | null {
  let total = 0;
  for (const r of w.robots) {
    for (let lv = r.speedLevel; lv < ROBOT.maxSpeedLevel; lv++) total += ROBOT.speedUpgradeCosts[Math.min(lv, ROBOT.speedUpgradeCosts.length - 1)];
    if (r.kind === 'shelf') for (let lv = r.liftLevel; lv < ROBOT.maxLiftLevel; lv++) total += ROBOT.liftUpgradeCosts[Math.min(lv, ROBOT.liftUpgradeCosts.length - 1)];
    if (r.kind === 'amr') for (let lv = r.cargoLevel; lv < limitsFor(w).maxCargoLevel; lv++) total += ROBOT.cargoUpgradeCosts[lv];
  }
  return total > 0 ? total : null;
}

/** 全ロボを一気に最大まで強化する（コインを払う版。積載は底面積が変わらない設定なので停車中でなくてもよい） */
export function upgradeAllRobots(w: WorldState): ShopResult {
  const cost = upgradeAllRobotsCost(w);
  if (cost === null) return { ok: false, reason: '全ロボとも最大です' };
  const p = pay(w, cost);
  if (!p.ok) return p;
  const maxCargo = limitsFor(w).maxCargoLevel;
  for (const r of w.robots) {
    r.speedLevel = ROBOT.maxSpeedLevel;
    if (r.kind === 'shelf') r.liftLevel = ROBOT.maxLiftLevel;
    if (r.kind === 'amr') r.cargoLevel = Math.max(r.cargoLevel, maxCargo);
  }
  return { ok: true };
}

// ---------------------------------------------------------------- 倉庫のアップグレード（§9.4）
import { BIN, LEVELS, PICKER, RANKS } from '../data/balance';
import { footprint, shapeFor } from './footprint';
import { limitsFor } from './limits';

export function levelUpgradeCost(w: WorldState): number | null {
  if (w.levels >= limitsFor(w).maxLevels) return null;
  return LEVELS.costs[Math.min(w.levels - 1, LEVELS.costs.length - 1)];
}

/** ランクで解放される段数。最終ランクでは上限突破の段数（12）まで */
export function maxLevelsForRank(w: WorldState): number {
  const i = Math.min(w.rank, RANKS.length - 1);
  const byRank = RANKS[i].maxLevels;
  return Math.min(i === RANKS.length - 1 ? limitsFor(w).maxLevels : byRank, limitsFor(w).maxLevels);
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
  if (r.kind !== 'amr' || r.cargoLevel >= limitsFor().maxCargoLevel) return null;
  return ROBOT.cargoUpgradeCosts[r.cargoLevel];
}

/** 積載量 Lv アップ（機体ごと）。ビンを積み重ねて運ぶ（占有マスは変わらない） */
export function upgradeCargo(w: WorldState, robotId: number): ShopResult {
  const r = w.robots.find((r) => r.id === robotId);
  if (!r) return { ok: false, reason: 'ロボがいません' };
  const cost = cargoUpgradeCost(r);
  if (cost === null) return { ok: false, reason: '積載量は最大です' };
  const newShape = shapeFor(r.cargoLevel + 1);
  const oldShape = shapeFor(r.cargoLevel);
  if (newShape.w !== oldShape.w || newShape.l !== oldShape.l) {
    // 底面積が変わる設定のときだけ、今の位置で新しい占有マスが空いている必要がある
    if (r.moveTo || r.actRemaining > 0) return { ok: false, reason: '停車中のときだけ改造できます' };
    const cells = footprint(r.pose, newShape, []);
    const occ = occupiedCells(w);
    occ.delete(`${r.pose.x},${r.pose.z}`);
    for (const c of cells) {
      if (!isFloorWalkable(cellAt(w, c.x, c.z))) return { ok: false, reason: '周りに広い床が必要です（改造後の大きさぶん）' };
      if (occ.has(`${c.x},${c.z}`)) return { ok: false, reason: '隣に他のロボがいます' };
    }
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
  const stack = stackForNewEmptyBin(w);
  if (!stack) return { ok: false, reason: '今は空いているスタックがありません（運搬中のビンが戻るまで待つ）' };
  const p = pay(w, BIN.emptyBinCost);
  if (!p.ok) return p;
  stack.bins.push(createBin(w, null, 0).id);
  return { ok: true };
}

/** 空ビンを無料で 1 個置く（昇格ボーナス用）。掘り出し用の空きは必ず残す。置けなければ false */
export function grantEmptyBin(w: WorldState): boolean {
  if (freeBinSlots(w) <= reservedSlots(w)) return false;
  const stack = stackForNewEmptyBin(w);
  if (!stack) return false;
  stack.bins.push(createBin(w, null, 0).id);
  return true;
}

/** 新しい空ビンの置き場: 入荷ステーションに近く、頂上が在庫でないスタック */
function stackForNewEmptyBin(w: WorldState): Stack | null {
  const inbound = w.stations.find((s) => s.kind === 'inbound') ?? w.stacks[0];
  const candidates = w.stacks.filter((s) => s.bins.length < w.levels);
  candidates.sort((a, b) => {
    const topStocked = (s: typeof a) => (s.bins.length ? (w.bins[s.bins[s.bins.length - 1]]?.item ? 1 : 0) : 0);
    return topStocked(a) - topStocked(b) || Math.abs(a.x - inbound.x) + Math.abs(a.z - inbound.z) - (Math.abs(b.x - inbound.x) + Math.abs(b.z - inbound.z));
  });
  return candidates[0] ?? null;
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
