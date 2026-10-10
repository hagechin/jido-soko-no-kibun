/** セーブしない実行時データ（予約表・経路計画）。state から常に再構築できる。 */
import type { PlanStep } from './pathfinding';
import { ReservationTable } from './reservation';

export interface Runtime {
  floor: ReservationTable;
  rail: ReservationTable;
  /** ドローン（空中レイヤー） */
  air: ReservationTable;
  plans: Map<number, PlanStep[]>;
  lastPlanTick: number;
  /** レイアウト変更・ロード後など、予約表を丸ごと作り直す */
  dirty: boolean;
  /** 目標が変わったロボ（このロボだけ経路を引き直す） */
  needsPlan: Set<number>;
  /** 予約表に現在位置を登録済みのロボ */
  known: Set<number>;
  /** 他ロボと同じマスに重なっている連続 tick（重なりの解消に使う） */
  overlapTicks: Map<number, number>;
  /** ロボごとに、今の計画を引いた tick */
  planTick: Map<number, number>;
}

export function createRuntime(): Runtime {
  return { floor: new ReservationTable(), rail: new ReservationTable(), air: new ReservationTable(), plans: new Map(), lastPlanTick: -1, dirty: true, needsPlan: new Set(), known: new Set(), overlapTicks: new Map(), planTick: new Map() };
}

/** 写し（フォトモードのシャッター: 本物を動かさずに数 tick 先まで描くため） */
export function cloneRuntime(rt: Runtime): Runtime {
  return {
    floor: rt.floor.clone(),
    rail: rt.rail.clone(),
    air: rt.air.clone(),
    plans: new Map([...rt.plans].map(([k, v]) => [k, v.map((s) => structuredClone(s))])),
    lastPlanTick: rt.lastPlanTick,
    dirty: rt.dirty,
    needsPlan: new Set(rt.needsPlan),
    known: new Set(rt.known),
    overlapTicks: new Map(rt.overlapTicks),
    planTick: new Map(rt.planTick),
  };
}
