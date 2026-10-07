/** セーブしない実行時データ（予約表・経路計画）。state から常に再構築できる。 */
import type { PlanStep } from './pathfinding';
import { ReservationTable } from './reservation';

export interface Runtime {
  floor: ReservationTable;
  rail: ReservationTable;
  plans: Map<number, PlanStep[]>;
  lastPlanTick: number;
  /** 目標が変わったので次の tick で再計画する */
  dirty: boolean;
}

export function createRuntime(): Runtime {
  return { floor: new ReservationTable(), rail: new ReservationTable(), plans: new Map(), lastPlanTick: -1, dirty: true };
}
