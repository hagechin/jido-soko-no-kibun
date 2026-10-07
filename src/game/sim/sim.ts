/**
 * 1 tick の進行（§11.3: 固定 10 tick/秒）。
 * 順序: 暦・オーダー → 自動行動 → ロボの動作と仕事 → ステーション → 再計画
 */
import { PATHING } from '../data/balance';
import { updateAutomation } from './automation';
import { updateCalendar } from './calendar';
import { onNewWeek, updateInbound } from './inbound';
import { updateEvents } from './events';
import { checkRankUp } from './rank';
import { updateOrders } from './orders';
import { updateStations } from './pickers';
import { replanAll } from './planner';
import { executeMovement, updateJob, updateStuck } from './robots';
import { createRuntime, type Runtime } from './runtime';
import type { WorldState } from './types';

export { createRuntime };
export type { Runtime };

export function stepSim(w: WorldState, rt: Runtime): void {
  w.tick++;
  const { newWeek } = updateCalendar(w);
  if (newWeek || w.tick === 1) updateEvents(w);
  if (newWeek) onNewWeek(w);
  updateInbound(w);
  updateOrders(w);
  updateAutomation(w, rt);
  for (const r of w.robots) {
    executeMovement(w, rt, r);
    updateJob(w, rt, r);
    updateStuck(w, r);
  }
  updateStations(w);
  checkRankUp(w);
  if (rt.dirty || w.tick - rt.lastPlanTick >= PATHING.replanIntervalTicks) replanAll(w, rt);
}

/** n tick 進める（テスト・追いつき計算用） */
export function stepMany(w: WorldState, rt: Runtime, n: number): void {
  for (let i = 0; i < n; i++) stepSim(w, rt);
}
