/**
 * 後方互換: ロボを含まない軽量な 1 tick（オーダーとカレンダーだけ）。
 * ゲーム本体は sim.ts の stepSim を使う。
 */
import { updateCalendar } from './calendar';
import { updateOrders } from './orders';
import type { WorldState } from './types';

export function stepWorld(w: WorldState): void {
  w.tick++;
  updateCalendar(w);
  updateOrders(w);
}
