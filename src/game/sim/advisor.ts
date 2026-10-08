/**
 * アドバイザー（★）: 倉庫の数字を見て「次に何を強化すると効くか」を 1 つ提案する。
 * クッキークリッカー的に「少し頑張れば効率が上がる」を迷わず進めるためのヒント。判断材料は毎秒のサンプル（直近 1 分の移動平均）。
 */
import { ADVISOR, AUTOMATION, PORT, RANKS } from '../data/balance';
import { outboundLoad } from './automation';
import { queuedCount, visibleOrders } from './orders';
import { freeBinSlots, reservedSlots } from './shop';
import type { WorldState } from './types';
import { tr } from '../i18n';

export interface AdvisorStats {
  /** 直近の移動平均（0..1） */
  shelfIdle: number;
  amrIdle: number;
  portsFull: number;
  pickersBusy: number;
  samples: number;
}

export interface Hint {
  id: string;
  text: string;
  /** 開くと良いパネル */
  panel: 'upgrades' | 'build' | 'inventory';
}

export function createAdvisorStats(): AdvisorStats {
  return { shelfIdle: 0, amrIdle: 0, portsFull: 0, pickersBusy: 0, samples: 0 };
}

/** 1 秒に 1 回呼ぶ */
export function sampleAdvisor(w: WorldState, st: AdvisorStats): void {
  const shelves = w.robots.filter((r) => r.kind === 'shelf');
  const amrs = w.robots.filter((r) => r.kind === 'amr');
  const idle = (rs: typeof shelves) => (rs.length ? rs.filter((r) => !r.job || r.job.type === 'park').length / rs.length : 0);
  const openPorts = w.ports.filter((p) => !p.closed);
  const full = openPorts.length ? openPorts.filter((p) => outboundLoad(w, p.id) >= PORT.outboundCapacity).length / openPorts.length : 0;
  const pickers = w.stations.filter((s) => s.kind === 'pick');
  const busy = pickers.length ? pickers.filter((s) => s.work).length / pickers.length : 0;
  const a = ADVISOR.smoothing;
  st.shelfIdle = st.shelfIdle * (1 - a) + idle(shelves) * a;
  st.amrIdle = st.amrIdle * (1 - a) + idle(amrs) * a;
  st.portsFull = st.portsFull * (1 - a) + full * a;
  st.pickersBusy = st.pickersBusy * (1 - a) + busy * a;
  st.samples++;
}

function unlockedRank(w: WorldState, need: number): boolean {
  return w.rank >= need;
}

/** いまの倉庫に効く提案を 1 つ（無ければ null） */
export function adviseNext(w: WorldState, st: AdvisorStats): Hint | null {
  const a = w.automation;
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  const amrs = w.robots.filter((r) => r.kind === 'amr').length;
  const empties = Object.values(w.bins).filter((b) => !b.item).length;
  const dock = w.pallets.reduce((s, p) => s + p.qty, 0);
  const warmedUp = st.samples >= ADVISOR.minSamples;

  // 1. 自動化は最優先（ランク条件を満たしていれば値段を示す。満たしていなければ何件出荷で解放されるか）
  const nextRankAt = (rank: number) => RANKS[Math.min(rank, RANKS.length - 1)].shipped;
  if (a.dispatch < 1) return { id: 'dispatch1', text: tr('自動配車AI Lv1（{0} コイン）を買うと、搬送ロボがポートのビンを自動で運びます', AUTOMATION.dispatchCosts[0]), panel: 'upgrades' };
  if (a.dispatch < 2) {
    if (unlockedRank(w, AUTOMATION.unlockRank.dispatch2)) return { id: 'dispatch2', text: tr('自動配車AI Lv2（{0} コイン）で棚ロボがオーダーを見て自動で取り出すようになります。手動指示から解放されます', AUTOMATION.dispatchCosts[1]), panel: 'upgrades' };
    return { id: 'rank-dispatch2', text: tr('あと {0} 件出荷するとランクが上がり、自動配車AI Lv2（棚ロボの自動取り出し）が解放されます', Math.max(0, nextRankAt(AUTOMATION.unlockRank.dispatch2) - w.stats.totalShipped)), panel: 'upgrades' };
  }
  if (!a.restock && dock > 0 && unlockedRank(w, AUTOMATION.unlockRank.restock)) return { id: 'restock', text: tr('自動補充AI（{0} コイン）で入荷口の山をロボが自動で棚に取り込みます', AUTOMATION.restockCost), panel: 'upgrades' };
  // 2. 空ビンが無いと入荷を取り込めない
  if (dock > 0 && empties === 0) {
    if (freeBinSlots(w) > reservedSlots(w)) return { id: 'bins', text: tr('空ビンがありません。空ビンを買うと入荷口の山（欠品の商品）を棚に取り込めます'), panel: 'upgrades' };
    return { id: 'slots', text: tr('空ビンも棚の空きもありません。段数を上げるかスタックを増やしてから空ビンを買いましょう'), panel: 'upgrades' };
  }
  if (!warmedUp) return null;
  // 3. ボトルネック
  if (st.portsFull >= ADVISOR.portsFullRatio) return { id: 'port', text: tr('ポートが満杯で棚ロボが待っています。ポートを増設するか、搬送ロボを増やしてみましょう'), panel: 'build' };
  if (st.pickersBusy >= ADVISOR.pickersBusyRatio) return { id: 'picker', text: tr('ピッカーが手一杯です。ピック速度を上げるか、ピッキングステーションを増設してみましょう'), panel: 'upgrades' };
  if (st.shelfIdle <= ADVISOR.lowIdleRatio && st.amrIdle >= ADVISOR.highIdleRatio) return { id: 'shelf', text: tr('棚ロボが足りません（棚ロボは常に忙しく、搬送ロボは暇）。棚ロボを追加してみましょう（現在 {0} 台）', shelves), panel: 'upgrades' };
  if (st.amrIdle <= ADVISOR.lowIdleRatio && st.shelfIdle >= ADVISOR.highIdleRatio) return { id: 'amr', text: tr('搬送ロボが足りません（搬送ロボは常に忙しく、棚ロボは暇）。搬送ロボを追加してみましょう（現在 {0} 台）', amrs), panel: 'upgrades' };
  // 4. 残りの自動化
  if (a.dispatch < 3 && unlockedRank(w, AUTOMATION.unlockRank.dispatch3)) return { id: 'dispatch3', text: tr('自動配車AI Lv3（{0} コイン）で同じ商品のオーダーをまとめて効率が上がります', AUTOMATION.dispatchCosts[2]), panel: 'upgrades' };
  if (!a.relocate && w.levels >= 2 && unlockedRank(w, AUTOMATION.unlockRank.relocate)) return { id: 'relocate', text: tr('在庫再配置AI（{0} コイン）で人気商品が上段に並び、掘り出しが減ります', AUTOMATION.relocateCost), panel: 'upgrades' };
  // 5. 溜まっているなら全体の底上げ
  if (queuedCount(w) >= ADVISOR.queueHint && visibleOrders(w).length) {
    if (st.shelfIdle <= ADVISOR.lowIdleRatio && st.amrIdle <= ADVISOR.lowIdleRatio) return { id: 'both', text: tr('オーダーが溜まっています。ロボを両方とも増やすか、速度アップグレードで回転を上げましょう'), panel: 'upgrades' };
    return { id: 'speed', text: tr('オーダーが溜まっています。ロボの速度・リフト速度・ピック速度のアップグレードが効きます'), panel: 'upgrades' };
  }
  return null;
}
