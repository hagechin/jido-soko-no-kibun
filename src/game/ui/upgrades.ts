/** アップグレードショップ（§4.4 / §9.4）。M4 時点はロボ追加・速度・リフトのみ。M6 で拡充 */
import { ROBOT } from '../data/balance';
import { buyAmr, buyShelfRobot, liftUpgradeCost, speedUpgradeCost, upgradeLift, upgradeSpeed, type ShopResult } from '../sim/shop';
import type { WorldState } from '../sim/types';
import { el, showToast } from './layout';

export interface UpgradeContext {
  world: WorldState;
  selectedRobotId: number | null;
  refresh: () => void;
}

function row(label: string, cost: number | null, onBuy: () => ShopResult, ctx: UpgradeContext, extra = ''): HTMLElement {
  const btn = el('button', { class: 'btn buy-btn', type: 'button', text: cost === null ? 'MAX' : `${cost} 🪙` });
  if (cost === null || ctx.world.coins < cost) btn.setAttribute('disabled', 'true');
  btn.addEventListener('click', () => {
    const r = onBuy();
    showToast(r.ok ? `${label} を購入しました` : r.reason);
    ctx.refresh();
  });
  return el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: label }), extra ? el('div', { class: 'muted small', text: extra }) : null), btn);
}

export function renderUpgrades(body: HTMLElement, ctx: UpgradeContext): void {
  const w = ctx.world;
  body.append(el('h4', { text: 'ロボット' }));
  body.append(row('棚ロボ追加', ROBOT.shelfRobotCost, () => buyShelfRobot(w), ctx, `現在 ${w.robots.filter((r) => r.kind === 'shelf').length} 台`));
  body.append(row('搬送ロボ追加', ROBOT.amrCost, () => buyAmr(w), ctx, `現在 ${w.robots.filter((r) => r.kind === 'amr').length} 台`));

  const r = w.robots.find((r) => r.id === ctx.selectedRobotId) ?? null;
  body.append(el('h4', { text: r ? `${r.name} の強化` : 'ロボの強化（3Dビューでロボを選択）' }));
  if (r) {
    body.append(row(`速度 Lv${r.speedLevel + 1}`, speedUpgradeCost(r), () => upgradeSpeed(w, r.id), ctx, `移動 +20%/Lv（現在 Lv${r.speedLevel}）`));
    if (r.kind === 'shelf') body.append(row(`リフト速度 Lv${r.liftLevel + 1}`, liftUpgradeCost(r), () => upgradeLift(w, r.id), ctx, `掘り出し・上げ下ろしが速くなる（現在 Lv${r.liftLevel}）`));
  }
}
