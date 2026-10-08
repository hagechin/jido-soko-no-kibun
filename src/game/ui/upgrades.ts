import { icon } from './icon';
import { automationPrice, dispatchPrice, price } from '../sim/pricing';
/** アップグレードショップ（§4.4 / §9.4） */
import { ADVISOR, AUTOMATION, BIN, BUILD, LIMITS, RANKS, ROBOT } from '../data/balance';
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
  upgradeAllRobots,
  upgradeAllRobotsCost,
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
import { isDrone, speedLevelOf } from '../sim/layers';
import { el, showToast } from './layout';
import { tr } from '../i18n';

export interface UpgradeContext {
  world: WorldState;
  selectedRobotId: number | null;
  refresh: () => void;
  /** 自動化 AI の購入（M9 で実装） */
  buyAutomation?: (id: string) => ShopResult;
  /** アドバイザーの提案（あれば見出しに出す） */
  hint?: string | null;
  /** 地上の搬送ロボが横付けの順番待ちをしている割合（アドバイザーの移動平均）。ドローンの買い時の目安に使う */
  amrStaged?: number;
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
    showToast(r.ok ? tr('{0} を購入しました', label) : r.reason);
    ctx.refresh();
  });
  return el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: label }), extra ? el('div', { class: 'muted small', text: extra }) : null), btn);
}

export function renderUpgrades(body: HTMLElement, ctx: UpgradeContext): void {
  const w = ctx.world;
  const rank = RANKS[Math.min(w.rank, RANKS.length - 1)];
  if (ctx.hint) body.append(el('p', { class: 'hint-box' }, icon('lightbulb', 16), el('span', { text: tr(' おすすめ: {0}', ctx.hint) })));

  body.append(el('h4', { text: tr('倉庫') }));
  const lvCost = levelUpgradeCost(w);
  const lim = limitsFor(w);
  const lvLocked = w.levels >= maxLevelsForRank(w) && w.levels < lim.maxLevels ? tr('ランク{0}で解放', w.rank + 2) : undefined;
  body.append(row(w.levels >= lim.maxLevels ? tr('棚の段数 {0}（MAX）', w.levels) : tr('棚の段数 {0} → {1}', w.levels, w.levels + 1), lvCost, () => upgradeLevels(w), ctx, tr('全スタックに +1 段。保管量が増える代わりに掘り出しが発生する{0}', limitHint(w.levels >= lim.maxLevels, tr('段数 {0} まで', LIMITS.expanded.maxLevels))), lvLocked));
  body.append(row(tr('ビン容量 {0} → {1}', w.binCapacity, w.binCapacity + 10), binCapacityUpgradeCost(w), () => upgradeBinCapacity(w), ctx, tr('1 ビンに入る個数')));
  const binsLeft = Math.max(0, freeBinSlots(w) - reservedSlots(w));
  body.append(row(tr('空ビン 1 個'), price(w, BIN.emptyBinCost), binsLeft > 0 ? () => buyEmptyBin(w) : null, ctx, tr('空きのあるスタックの頂上に置く（買えるのはあと {0} 個。掘り出し用に {1} スロットは空けておく）', binsLeft, reservedSlots(w))));
  const areaMax = expansionCost(w, 'east') === null && expansionCost(w, 'south') === null;
  body.append(row(areaMax ? tr('面積拡張 {0}×{1}（MAX）', w.width, w.height) : tr('面積拡張（東へ +4 列／南へ +4 行）'), null, null, ctx, areaMax ? tr('これ以上は広げられません{0}', limitHint(true, tr('{0}×{1} まで', LIMITS.expanded.maxWidth, LIMITS.expanded.maxHeight))) : tr('建設モードのツールバーから行います'), areaMax ? undefined : tr('建設')));
  body.append(el('p', { class: 'muted small', text: tr('スタック {0} / ポート {1} / ステーション {2} コイン。「建設」で配置します', price(w, BUILD.stackCost), price(w, BUILD.portCost), price(w, BUILD.pickStationCost)) }));

  body.append(el('h4', { text: tr('ロボット') }));
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  const amrs = w.robots.filter((r) => r.kind === 'amr' && !isDrone(r)).length;
  body.append(row(tr('棚ロボ追加'), price(w, ROBOT.shelfRobotCost), shelves < lim.maxShelfRobots ? () => buyShelfRobot(w) : null, ctx, tr('現在 {0} 台（上限 {1}）{2}', shelves, lim.maxShelfRobots, limitHint(shelves >= lim.maxShelfRobots, tr('{0} 台まで', LIMITS.expanded.maxShelfRobots)))));
  body.append(row(tr('搬送ロボ追加'), price(w, ROBOT.amrCost), amrs < lim.maxAmrs ? () => buyAmr(w) : null, ctx, tr('現在 {0} 台（上限 {1}）{2}', amrs, lim.maxAmrs, limitHint(amrs >= lim.maxAmrs, tr('{0} 台まで', LIMITS.expanded.maxAmrs)))));
  // 特別ロボ（iOS の特別ロボパック）
  const special = hasFeature('specialRobots');
  const drones = w.robots.filter((r) => isDrone(r)).length;
  body.append(el('h4', { text: tr('特別ロボ') }));
  // ドローンの買い時: 地上ロボが横付けで順番待ちしている規模になってから。小さいうちは地上ロボで足りる
  const queued = (ctx.amrStaged ?? 0) >= ADVISOR.stagedRatio;
  const droneTiming = queued ? tr('★ 今が買い時: 搬送ロボが横付けで順番待ちしています') : tr('大きな倉庫で特に威力を発揮（搬送ロボがポートで順番待ちするようになったら「おすすめ」でお知らせ。今の規模では地上ロボで足りています）');
  body.append(row(tr('ドローン搬送ロボ追加'), price(w, ROBOT.droneCost), special && drones < ROBOT.maxDrones ? () => buyDrone(w) : null, ctx, tr('棚の上を飛び越えて運ぶ（速度 +1 段階）。地上の渋滞と横付けの枠を受けず、一番溜まっているポートへ真っ先に向かい、暇なときはポートの上で待機。{0}。現在 {1} 台（上限 {2}）{3}', droneTiming, drones, ROBOT.maxDrones, specialRobotsHint()), special ? undefined : tr('ロック')));
  body.append(row(tr('ダブルデッカー棚ロボ追加'), price(w, ROBOT.doubleDeckerCost), special && shelves < lim.maxShelfRobots ? () => buyDoubleDecker(w) : null, ctx, tr('ビンを 2 段持てる棚ロボ。1 個掘れば届くビンは退避の往復なしで取り出し、深い掘り出しも 2 個ずつ運ぶ。狭い棚でも 1 台で棚ロボ 2 台ぶんの働きをするので序盤から活躍。棚ロボの上限に含む{0}', specialRobotsHint()), special ? undefined : tr('ロック')));

  const allCost = upgradeAllRobotsCost(w);
  body.append(el('h4', { text: tr('ロボの強化（全機）') }));
  body.append(row(allCost === null ? tr('全ロボを最大強化（MAX）') : tr('全ロボを最大強化'), allCost, () => upgradeAllRobots(w), ctx, allCost === null ? tr('全ロボとも速度・リフト・積載が最大です') : tr('全ロボの速度・リフト・積載を一気に最大まで（{0} 台ぶんの合計）', w.robots.length)));
  const r = w.robots.find((r) => r.id === ctx.selectedRobotId) ?? null;
  body.append(el('h4', { text: r ? tr('{0} の強化（機体ごと）', r.name) : tr('ロボの強化（3D ビューかロボ一覧でロボを選ぶと表示）') }));
  if (r) {
    body.append(row(tr('速度 Lv{0} → {1}', r.speedLevel, r.speedLevel + 1), speedUpgradeCost(r, w), () => upgradeSpeed(w, r.id), ctx, isDrone(r) ? tr('移動速度 +20%/Lv。ドローンは飛行で +1 段階（いまの実効 Lv{0}）', speedLevelOf(r)) : tr('移動速度 +20%/Lv')));
    if (r.kind === 'shelf') body.append(row(tr('リフト速度 Lv{0} → {1}', r.liftLevel, r.liftLevel + 1), liftUpgradeCost(r, w), () => upgradeLift(w, r.id), ctx, tr('掘り出し・上げ下ろしの時間短縮')));
    if (r.kind === 'amr') {
      const c = ROBOT.cargo[r.cargoLevel];
      const n = ROBOT.cargo[Math.min(r.cargoLevel + 1, lim.maxCargoLevel)];
      body.append(row(r.cargoLevel >= lim.maxCargoLevel ? tr('積載 {0} ビン（MAX）', c.bins) : tr('積載 {0} → {1} ビン', c.bins, n.bins), cargoUpgradeCost(r, w), () => upgradeCargo(w, r.id), ctx, tr('ビンを積み重ねて運び、必要なステーションを順に回る{0}', limitHint(r.cargoLevel >= lim.maxCargoLevel, tr('積載 {0} ビンまで', ROBOT.cargo[LIMITS.expanded.maxCargoLevel].bins)))));
    }
  }

  body.append(el('h4', { text: tr('ピッカー') }));
  for (const s of w.stations.filter((s) => s.kind === 'pick')) {
    body.append(row(tr('ステーション({0},{1}) ピック速度 Lv{2} → {3}', s.x, s.z, s.level, s.level + 1), pickerUpgradeCost(s, w), () => upgradePicker(w, s.id), ctx, tr('担当: {0} 品目', s.assignedItems.length)));
  }

  body.append(el('h4', { text: tr('自動化 AI') }));
  const ai: [string, string, number | null, string][] = [
    ['dispatch', tr('自動配車AI Lv{0}', w.automation.dispatch + 1), w.automation.dispatch < 3 ? dispatchPrice(w, w.automation.dispatch) : null, [tr('搬送ロボがポートのビンを自動で運ぶ（棚ロボの取り出しはまだ手動）'), tr('棚ロボがオーダーを見て自動で取り出す。ここから放置できる'), tr('同じ商品を含むオーダーをまとめて取り出す（バッチ最適化）')][w.automation.dispatch] ?? ''],
    ['restock', tr('自動補充AI'), w.automation.restock ? null : automationPrice(w, AUTOMATION.restockCost), tr('入荷があると該当ビンを自動で入荷ステーションへ')],
    ['relocate', tr('在庫再配置AI'), w.automation.relocate ? null : automationPrice(w, AUTOMATION.relocateCost), tr('暇なときに人気商品を上段へ並べ替える')],
  ];
  for (const [id, label, cost, desc] of ai) {
    const unlockRank = id === 'dispatch' ? [AUTOMATION.unlockRank.dispatch1, AUTOMATION.unlockRank.dispatch2, AUTOMATION.unlockRank.dispatch3][w.automation.dispatch] ?? 0 : id === 'restock' ? AUTOMATION.unlockRank.restock : AUTOMATION.unlockRank.relocate;
    const locked = cost !== null && w.rank < unlockRank ? tr('ランク{0}で解放', unlockRank + 1) : ctx.buyAutomation ? undefined : 'M9';
    body.append(row(label, cost, ctx.buyAutomation ? () => ctx.buyAutomation!(id) : null, ctx, desc, locked));
  }
  body.append(el('h4', { text: tr('搬送ロボの優先') }));
  const priRow = el('div', { class: 'settings-row' });
  for (const [id, label, desc] of [
    ['balanced', tr('均等'), tr('近いポートから順に運ぶ')],
    ['pick', tr('ピック優先'), tr('ピッカー行きのビンを先に運ぶ')],
    ['restock', tr('補充優先'), tr('入荷ステーション行きのビンを先に運ぶ')],
  ] as const) {
    const b = el('button', { class: `btn${w.automation.amrPriority === id ? ' is-active' : ''}`, type: 'button', text: label, title: desc });
    b.addEventListener('click', () => {
      w.automation.amrPriority = id;
      showToast(tr('搬送ロボ: {0}（{1}）', label, desc));
      ctx.refresh();
    });
    priRow.append(b);
  }
  body.append(priRow);
  body.append(el('p', { class: 'muted small', text: tr('現在のランク: {0}', rank.name) }));
}
