/** セーブしない実行時データ（予約表・経路計画）。state から常に再構築できる。 */
import type { PlanStep } from './pathfinding';
import { ReservationTable } from './reservation';

export interface Runtime {
  floor: ReservationTable;
  rail: ReservationTable;
  plans: Map<number, PlanStep[]>;
  lastPlanTick: number;
  /** レイアウト変更・ロード後など、予約表を丸ごと作り直す */
  dirty: boolean;
  /** 目標が変わったロボ（このロボだけ経路を引き直す） */
  needsPlan: Set<number>;
  /** 予約表に現在位置を登録済みのロボ */
  known: Set<number>;
}

export function createRuntime(): Runtime {
  return { floor: new ReservationTable(), rail: new ReservationTable(), plans: new Map(), lastPlanTick: -1, dirty: true, needsPlan: new Set(), known: new Set() };
}
