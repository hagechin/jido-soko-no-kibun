/**
 * ロボの「層」と変種（SPEC-iOS §1、I5）。
 * - floor: 搬送ロボ（床・待機スポット）
 * - rail: 棚ロボ（スタックの上・ポート）
 * - air: ドローン搬送ロボ（範囲内の全マス。地上の渋滞とは無関係）
 * 衝突回避・予約表・重なり判定は kind ではなく layer で分ける。
 */
import { ROBOT } from '../data/balance';
import { footprint, shapeFor, type Shape } from './footprint';
import type { Robot, Vec2 } from './types';

export type Layer = 'floor' | 'rail' | 'air';

export function layerOf(r: Pick<Robot, 'kind' | 'variant'>): Layer {
  if (r.variant === 'drone') return 'air';
  return r.kind === 'shelf' ? 'rail' : 'floor';
}

export function isDrone(r: Pick<Robot, 'variant'>): boolean {
  return r.variant === 'drone';
}

export function isDoubleDecker(r: Pick<Robot, 'variant'>): boolean {
  return r.variant === 'double';
}

/** 棚ロボが同時に持てるビンの数（ダブルデッカーは 2） */
export function shelfSlots(r: Pick<Robot, 'kind' | 'variant'>): number {
  return r.kind === 'shelf' && r.variant === 'double' ? 2 : 1;
}

/** 経路計画に使う速度 Lv。ドローンは飛ぶので 1 段階速い */
export function speedLevelOf(r: Pick<Robot, 'variant' | 'speedLevel'>): number {
  return r.variant === 'drone' ? Math.min(ROBOT.maxSpeedLevel, r.speedLevel + ROBOT.droneSpeedBonus) : r.speedLevel;
}

/** 占有マスの形（棚ロボは常に 1×1、搬送ロボは積載 Lv による） */
export function shapeOf(r: Pick<Robot, 'kind' | 'cargoLevel'>): Shape {
  return shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
}

/** 今の占有マス（移動中なら行き先も） */
export function occupancyOf(r: Robot): Vec2[] {
  const shape = shapeOf(r);
  const cells = footprint(r.pose, shape, []);
  if (r.moveTo) cells.push(...footprint(r.moveTo, shape, []));
  return cells;
}
