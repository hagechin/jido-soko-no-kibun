/**
 * 上限突破（SPEC-iOS §1、I4）。ロボ台数・積載 Lv・段数・倉庫サイズの上限を 1 か所で決める。
 * 通常は LIMITS.base。iOS の「上限突破パック」を持っていると main が setLimitsExpanded(true) にする。
 * sim は DOM や購入状態を知らないので、ここのフラグだけを見る（テストでも切り替えられる）
 */
import { LIMITS } from '../data/balance';
import type { WorldState } from './types';

export type Limits = typeof LIMITS.base;

let expanded = false;

export function setLimitsExpanded(on: boolean): void {
  expanded = on;
}

export function limitsExpanded(): boolean {
  return expanded;
}

/** いまの上限（w は将来セーブごとの差に使う。今は全体のフラグ） */
export function limitsFor(_w?: WorldState): Limits {
  return expanded ? LIMITS.expanded : LIMITS.base;
}
