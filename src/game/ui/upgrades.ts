import { icon } from './icon';
/** アップグレードショップ（§4.4 / §9.4） */
import { AUTOMATION, BIN, BUILD, LIMITS, RANKS, ROBOT } from '../data/balance';
import {
  binCapacityUpgradeCost,
  buyAmr,
  buyDrone,
  buyDoubleDecker,
  buyEmptyBin,
  freeBinSlots,
  reservedSlots,
  buyShelfRobot,
  cargoUpgradeCost,
  levelUpgradeCost,
  liftUpgradeCost,
  maxLevelsForRank,
  pickerUpgradeCost,
  speedUpgradeCost,
  upgradeBinCapacity,
  upgradeCargo,
  upgradeLevels,
  upgradeLift,
  upgradePicker,
  upgradeSpeed,
  type ShopResult,
} from '../sim/shop';
import type { WorldState } from '../sim/types';
import { limitsFor } from '../sim/limits';
import { expansionCost } from '../sim/build';
import { limitHint, specialRobotsHint } from './limitHint';
import { hasFeature } from '../platform/entitlements';
import { isDrone } from '../sim/layers';
import { el, showToast } from './layout';

export interface UpgradeContext {
  world: WorldState;
  selectedRobotId: number | null;
  refresh: () => void;
  /** 自動化 AI の購入（M9 で実装） */
  buyAutomation?: (id: string) => ShopResult;
  /** アドバイザーの提案（あれば見出しに出す） */
  hint?: string | null;
}

function row(label: string, cost: number | null, onBuy: (() => ShopResult) | null, ctx: UpgradeContext, extra = '', lockedText?: string): HTMLElement {
  const btn = el('button', { class: 'btn buy-btn', type: 'button' });
  if (lockedText) btn.textContent = lockedText;
  else if (cost === null) btn.textContent = 'MAX';
  else btn.append(icon('coins', 14), document.createTextNode(` ${cost.toLocaleString('ja-JP')}`));
  if (lockedText || cost === null || ctx.world.coins < cost || !onBuy) btn.setAttribute('disabled', 'true');
  btn.addEventListener('click', () => {
    if (!onBuy) return;
    const r = onBuy();
    showToast(r.ok ? `${label} を購入しました` : r.reason);
    ctx.refresh();
  });
  return el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: label }), extra ? el('div', { class: 'muted small', text: extra }) : null), btn);
}

export function renderUpgrades(body: HTMLElement, ctx: UpgradeContext): void {
  const w = ctx.world;
  const rank = RANKS[Math.min(w.rank, RANKS.length - 1)];
  if (ctx.hint) body.append(el('p', { class: 'hint-box' }, icon('lightbulb', 16), el('span', { text: ` おすすめ: ${ctx.hint}` })));

  body.append(el('h4', { text: '倉庫' }));
  const lvCost = levelUpgradeCost(w);
  const lim = limitsFor(w);
  const lvLocked = w.levels >= maxLevelsForRank(w) && w.levels < lim.maxLevels ? `ランク${w.rank + 2}で解放` : undefined;
  body.append(row(w.levels >= lim.maxLevels ? `棚の段数 ${w.levels}（MAX）` : `棚の段数 ${w.levels} → ${w.levels + 1}`, lvCost, () => upgradeLevels(w), ctx, `全スタックに +1 段。保管量が増える代わりに掘り出しが発生する${limitHint(w.levels >= lim.maxLevels, `段数 ${LIMITS.expanded.maxLevels} まで`)}`, lvLocked));
  body.append(row(`ビン容量 ${w.binCapacity} → ${w.binCapacity + 10}`, binCapacityUpgradeCost(w), () => upgradeBinCapacity(w), ctx, '1 ビンに入る個数'));
  const binsLeft = Math.max(0, freeBinSlots(w) - reservedSlots(w));
  body.append(row('空ビン 1 個', BIN.emptyBinCost, binsLeft > 0 ? () => buyEmptyBin(w) : null, ctx, `空きのあるスタックの頂上に置く（買えるのはあと ${binsLeft} 個。掘り出し用に ${reservedSlots(w)} スロットは空けておく）`));
  const areaMax = expansionCost(w, 'east') === null && expansionCost(w, 'south') === null;
  body.append(row(areaMax ? `面積拡張 ${w.width}×${w.height}（MAX）` : '面積拡張（東へ +4 列／南へ +4 行）', null, null, ctx, areaMax ? `これ以上は広げられません${limitHint(true, `${LIMITS.expanded.maxWidth}×${LIMITS.expanded.maxHeight} まで`)}` : '建設モードのツールバーから行います', areaMax ? undefined : '建設'));
  body.append(el('p', { class: 'muted small', text: `スタック ${BUILD.stackCost} / ポート ${BUILD.portCost} / ステーション ${BUILD.pickStationCost} コイン。「建設」で配置します` }));

  body.append(el('h4', { text: 'ロボット' }));
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  const amrs = w.robots.filter((r) => r.kind === 'amr' && !isDrone(r)).length;
  body.append(row('棚ロボ追加', ROBOT.shelfRobotCost, shelves < lim.maxShelfRobots ? () => buyShelfRobot(w) : null, ctx, `現在 ${shelves} 台（上限 ${lim.maxShelfRobots}）${limitHint(shelves >= lim.maxShelfRobots, `${LIMITS.expanded.maxShelfRobots} 台まで`)}`));
  body.append(row('搬送ロボ追加', ROBOT.amrCost, amrs < lim.maxAmrs ? () => buyAmr(w) : null, ctx, `現在 ${amrs} 台（上限 ${lim.maxAmrs}）${limitHint(amrs >= lim.maxAmrs, `${LIMITS.expanded.maxAmrs} 台まで`)}`));
  // 特別ロボ（iOS の特別ロボパック）
  const special = hasFeature('specialRobots');
  const drones = w.robots.filter((r) => isDrone(r)).length;
  body.append(el('h4', { text: '特別ロボ' }));
  body.append(row('ドローン搬送ロボ追加', ROBOT.droneCost, special && drones < ROBOT.maxDrones ? () => buyDrone(w) : null, ctx, `棚の上を飛び越えて運ぶ。地上の渋滞と横付けの枠を受けない。現在 ${drones} 台（上限 ${ROBOT.maxDrones}）${specialRobotsHint()}`, special ? undefined : 'ロック'));
  body.append(row('ダブルデッカー棚ロボ追加', ROBOT.doubleDeckerCost, special && shelves < lim.maxShelfRobots ? () => buyDoubleDecker(w) : null, ctx, `ビンを 2 段持てる棚ロボ。1 個掘れば届くビンは退避の往復なしで取り出し、深い掘り出しも 2 個ずつ運ぶ。棚ロボの上限に含む${specialRobotsHint()}`, special ? undefined : 'ロック'));

  const r = w.robots.find((r) => r.id === ctx.selectedRobotId) ?? null;
  body.append(el('h4', { text: r ? `${r.name} の強化（機体ごと）` : 'ロボの強化（3D ビューでロボを選ぶと表示）' }));
  if (r) {
    body.append(row(`速度 Lv${r.speedLevel} → ${r.speedLevel + 1}`, speedUpgradeCost(r), () => upgradeSpeed(w, r.id), ctx, '移動速度 +20%/Lv'));
    if (r.kind === 'shelf') body.append(row(`リフト速度 Lv${r.liftLevel} → ${r.liftLevel + 1}`, liftUpgradeCost(r), () => upgradeLift(w, r.id), ctx, '掘り出し・上げ下ろしの時間短縮'));
    if (r.kind === 'amr') {
      const c = ROBOT.cargo[r.cargoLevel];
      const n = ROBOT.cargo[Math.min(r.cargoLevel + 1, lim.maxCargoLevel)];
      body.append(row(r.cargoLevel >= lim.maxCargoLevel ? `積載 ${c.bins} ビン（MAX）` : `積載 ${c.bins} → ${n.bins} ビン`, cargoUpgradeCost(r), () => upgradeCargo(w, r.id), ctx, `ビンを積み重ねて運び、必要なステーションを順に回る${limitHint(r.cargoLevel >= lim.maxCargoLevel, `積載 ${ROBOT.cargo[LIMITS.expanded.maxCargoLevel].bins} ビンまで`)}`));
    }
  }

  body.append(el('h4', { text: 'ピッカー' }));
  for (const s of w.stations.filter((s) => s.kind === 'pick')) {
    body.append(row(`ステーション(${s.x},${s.z}) ピック速度 Lv${s.level} → ${s.level + 1}`, pickerUpgradeCost(s), () => upgradePicker(w, s.id), ctx, `担当: ${s.assignedItems.length} 品目`));
  }

  body.append(el('h4', { text: '自動化 AI' }));
  const ai: [string, string, number | null, string][] = [
    ['dispatch', `自動配車AI Lv${w.automation.dispatch + 1}`, w.automation.dispatch < 3 ? AUTOMATION.dispatchCosts[w.automation.dispatch] : null, ['搬送ロボがポートのビンを自動で運ぶ（棚ロボの取り出しはまだ手動）', '棚ロボがオーダーを見て自動で取り出す。ここから放置できる', '同じ商品を含むオーダーをまとめて取り出す（バッチ最適化）'][w.automation.dispatch] ?? ''],
    ['restock', '自動補充AI', w.automation.restock ? null : AUTOMATION.restockCost, '入荷があると該当ビンを自動で入荷ステーションへ'],
    ['relocate', '在庫再配置AI', w.automation.relocate ? null : AUTOMATION.relocateCost, '暇なときに人気商品を上段へ並べ替える'],
  ];
  for (const [id, label, cost, desc] of ai) {
    const unlockRank = id === 'dispatch' ? [AUTOMATION.unlockRank.dispatch1, AUTOMATION.unlockRank.dispatch2, AUTOMATION.unlockRank.dispatch3][w.automation.dispatch] ?? 0 : id === 'restock' ? AUTOMATION.unlockRank.restock : AUTOMATION.unlockRank.relocate;
    const locked = cost !== null && w.rank < unlockRank ? `ランク${unlockRank + 1}で解放` : ctx.buyAutomation ? undefined : 'M9';
    body.append(row(label, cost, ctx.buyAutomation ? () => ctx.buyAutomation!(id) : null, ctx, desc, locked));
  }
  body.append(el('h4', { text: '搬送ロボの優先' }));
  const priRow = el('div', { class: 'settings-row' });
  for (const [id, label, desc] of [
    ['balanced', '均等', '近いポートから順に運ぶ'],
    ['pick', 'ピック優先', 'ピッカー行きのビンを先に運ぶ'],
    ['restock', '補充優先', '入荷ステーション行きのビンを先に運ぶ'],
  ] as const) {
    const b = el('button', { class: `btn${w.automation.amrPriority === id ? ' is-active' : ''}`, type: 'button', text: label, title: desc });
    b.addEventListener('click', () => {
      w.automation.amrPriority = id;
      showToast(`搬送ロボ: ${label}（${desc}）`);
      ctx.refresh();
    });
    priRow.append(b);
  }
  body.append(priRow);
  body.append(el('p', { class: 'muted small', text: `現在のランク: ${rank.name}` }));
}
