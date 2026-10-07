/**
 * 1 tick の進行。固定タイムステップ（10 tick/秒）で呼ばれる（§11.3）。
 * 速度変更は呼び出し回数で行い、ここでは常に 1 tick だけ進める。
 */
import { updateCalendar } from './calendar';
import { updateOrders } from './orders';
import type { WorldState } from './types';

export function stepWorld(w: WorldState): void {
  w.tick++;
  updateCalendar(w);
  updateOrders(w);
}
