/**
 * アドバイザー（★）: 倉庫の数字を見て「次に何を強化すると効くか」を 1 つ提案する。
 * クッキークリッカー的に「少し頑張れば効率が上がる」を迷わず進めるためのヒント。判断材料は毎秒のサンプル（直近 1 分の移動平均）。
 */
import { ADVISOR, AUTOMATION, PORT, ROBOT } from '../data/balance';
import { findMergePair, needsEmptyBin, outboundLoad } from './automation';
import { isDrone } from './layers';
import { automationPrice, dispatchPrice, price, rankShippedAt } from './pricing';
import { queuedCount, visibleOrders } from './orders';
import { binsToRecommended, freeBinSlots, reservedSlots } from './shop';
import { inboundSettings } from './inbound';
import { hasIdlePicker } from './build';
import type { WorldState } from './types';

export interface AdvisorStats {
  /** 直近の移動平均（0..1） */
  shelfIdle: number;
  amrIdle: number;
  portsFull: number;
  pickersBusy: number;
  /** 地上の搬送ロボのうち、横付けの順番待ち（staged）をしている割合 */
  amrStaged: number;
  samples: number;
}

/** 提案に使う、sim の外の事情（iOS の購入状態など）。省略すると特別ロボの提案はしない */
export interface AdvisorOptions {
  /** ドローン搬送ロボ: available = 買える、locked = 特別ロボパックが要る、none = この環境には無い（Web 版） */
  drones?: 'available' | 'locked' | 'none';
}

export interface Hint {
  id: string;
  text: string;
  /** 開くと良いパネル */
  panel: 'upgrades' | 'build' | 'inventory' | 'settings';
}

export function createAdvisorStats(): AdvisorStats {
  return { shelfIdle: 0, amrIdle: 0, portsFull: 0, pickersBusy: 0, amrStaged: 0, samples: 0 };
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
  const ground = amrs.filter((r) => !isDrone(r));
  const staged = ground.length ? ground.filter((r) => (r.job?.type === 'fetch' || r.job?.type === 'deliver') && r.job.staged).length / ground.length : 0;
  const a = ADVISOR.smoothing;
  st.shelfIdle = st.shelfIdle * (1 - a) + idle(shelves) * a;
  st.amrIdle = st.amrIdle * (1 - a) + idle(amrs) * a;
  st.portsFull = st.portsFull * (1 - a) + full * a;
  st.pickersBusy = st.pickersBusy * (1 - a) + busy * a;
  st.amrStaged = st.amrStaged * (1 - a) + staged * a;
  st.samples++;
}

function unlockedRank(w: WorldState, need: number): boolean {
  return w.rank >= need;
}

/** いまの倉庫に効く提案を 1 つ（無ければ null） */
export function adviseNext(w: WorldState, st: AdvisorStats, opts: AdvisorOptions = {}): Hint | null {
  const a = w.automation;
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  const amrs = w.robots.filter((r) => r.kind === 'amr').length;
  const empties = Object.values(w.bins).filter((b) => !b.item).length;
  const dock = w.pallets.reduce((s, p) => s + p.qty, 0);
  const warmedUp = st.samples >= ADVISOR.minSamples;

  // 1. 自動化は最優先（ランク条件を満たしていれば値段を示す。満たしていなければ何件出荷で解放されるか）
  const nextRankAt = (rank: number) => rankShippedAt(w, rank);
  if (a.dispatch < 1) return { id: 'dispatch1', text: `自動配車AI Lv1（${dispatchPrice(w, 0)} コイン）を買うと、搬送ロボがポートのビンを自動で運びます`, panel: 'upgrades' };
  if (a.dispatch < 2) {
    if (unlockedRank(w, AUTOMATION.unlockRank.dispatch2)) return { id: 'dispatch2', text: `自動配車AI Lv2（${dispatchPrice(w, 1)} コイン）で棚ロボがオーダーを見て自動で取り出すようになります。手動指示から解放されます`, panel: 'upgrades' };
    return { id: 'rank-dispatch2', text: `あと ${Math.max(0, nextRankAt(AUTOMATION.unlockRank.dispatch2) - w.stats.totalShipped)} 件出荷するとランクが上がり、自動配車AI Lv2（棚ロボの自動取り出し）が解放されます`, panel: 'upgrades' };
  }
  if (!a.restock && dock > 0 && unlockedRank(w, AUTOMATION.unlockRank.restock)) return { id: 'restock', text: `自動補充AI（${automationPrice(w, AUTOMATION.restockCost)} コイン）で入荷口の山をロボが自動で棚に取り込みます`, panel: 'upgrades' };
  // 担当の無いピッカー: 仕事が来ないので、増やしても出荷が伸びない
  if (hasIdlePicker(w)) return { id: 'assign', text: '担当商品の無いピッキングステーションがあります。ステーションをタップ → 「担当を自動で割り振る」で全ピッカーに仕事が回ります', panel: 'build' };
  // 2. 空ビンが無いと入荷を取り込めない
  if (dock > 0 && empties === 0) {
    // 同じ商品のビンをまとめて空ビンを作れるなら棚ロボが自分でやる（ビンの統合）。作れないときだけ買い物を勧める
    const stuck = needsEmptyBin(w);
    if (stuck.length && findMergePair(w, new Set())) return null;
    const why = stuck.length ? 'まとめて空にできるビンも無いので、' : '';
    if (freeBinSlots(w) > reservedSlots(w)) return { id: 'bins', text: `空ビンがありません。${why}空ビンを買うと入荷口の山（欠品の商品）を棚に取り込めます${binsToRecommended(w) > 0 ? `（「おすすめのビン数まで追加」で ${binsToRecommended(w)} 個まとめて買えます）` : ''}`, panel: 'upgrades' };
    return { id: 'slots', text: `空ビンも棚の空きもありません。${why}段数を上げるかスタックを増やしてから空ビンを買いましょう`, panel: 'upgrades' };
  }
  if (!warmedUp) return null;
  // 3. ボトルネック
  if (st.portsFull >= ADVISOR.portsFullRatio) return { id: 'port', text: 'ポートが満杯で棚ロボが待っています。ポートを増設するか、搬送ロボを増やしてみましょう', panel: 'build' };
  // ドローンの買い時: 地上の搬送ロボがポート／ステーションの横付けで順番待ちしている（搬送ロボを増やしても列が伸びるだけ）
  const droneHint = droneBuyTime(w, st, opts);
  if (droneHint) return droneHint;
  if (st.pickersBusy >= ADVISOR.pickersBusyRatio) return { id: 'picker', text: 'ピッカーが手一杯です。ピック速度を上げるか、ピッキングステーションを増設してみましょう', panel: 'upgrades' };
  if (st.shelfIdle <= ADVISOR.lowIdleRatio && st.amrIdle >= ADVISOR.highIdleRatio) return { id: 'shelf', text: `棚ロボが足りません（棚ロボは常に忙しく、搬送ロボは暇）。棚ロボを追加してみましょう（現在 ${shelves} 台）`, panel: 'upgrades' };
  if (st.amrIdle <= ADVISOR.lowIdleRatio && st.shelfIdle >= ADVISOR.highIdleRatio) return { id: 'amr', text: `搬送ロボが足りません（搬送ロボは常に忙しく、棚ロボは暇）。搬送ロボを追加してみましょう（現在 ${amrs} 台）`, panel: 'upgrades' };
  // 空ビンが余っているのに入荷が止まっている → 入荷の積載量を上げると在庫が増える（倉庫を広げた後）
  const bins = Object.keys(w.bins).length;
  if (a.restock && dock === 0 && bins >= ADVISOR.emptyBinsMin && empties >= bins * ADVISOR.emptyBinsShare && inboundSettings(w).load === 'standard') return { id: 'inboundLoad', text: `空ビンが余っています（${empties} / ${bins}）。設定の「入荷トラック」で積載量を「倉庫いっぱい」にすると、空いたビンに在庫が入ります`, panel: 'settings' };
  // 4. 残りの自動化
  if (a.dispatch < 3 && unlockedRank(w, AUTOMATION.unlockRank.dispatch3)) return { id: 'dispatch3', text: `自動配車AI Lv3（${dispatchPrice(w, 2)} コイン）で同じ商品のオーダーをまとめて効率が上がります`, panel: 'upgrades' };
  if (!a.relocate && w.levels >= 2 && unlockedRank(w, AUTOMATION.unlockRank.relocate)) return { id: 'relocate', text: `在庫再配置AI（${automationPrice(w, AUTOMATION.relocateCost)} コイン）で人気商品が上段に並び、掘り出しが減ります`, panel: 'upgrades' };
  // 5. 溜まっているなら全体の底上げ
  if (queuedCount(w) >= ADVISOR.queueHint && visibleOrders(w).length) {
    if (st.shelfIdle <= ADVISOR.lowIdleRatio && st.amrIdle <= ADVISOR.lowIdleRatio) return { id: 'both', text: 'オーダーが溜まっています。ロボを両方とも増やすか、速度アップグレードで回転を上げましょう', panel: 'upgrades' };
    return { id: 'speed', text: 'オーダーが溜まっています。ロボの速度・リフト速度・ピック速度のアップグレードが効きます', panel: 'upgrades' };
  }
  return null;
}

/** ドローンの買い時か（横付けの順番待ちが多く、ドローンがまだ上限に達していない）。Web 版や提案不要なら null */
export function droneBuyTime(w: WorldState, st: AdvisorStats, opts: AdvisorOptions): Hint | null {
  if (!opts.drones || opts.drones === 'none') return null;
  if (st.amrStaged < ADVISOR.stagedRatio) return null;
  const drones = w.robots.filter((r) => isDrone(r)).length;
  if (drones >= ROBOT.maxDrones) return null;
  if (opts.drones === 'locked') return { id: 'drone-locked', text: '搬送ロボがポートやステーションの横付けで順番待ちしています。ドローン搬送ロボ（特別ロボパック）なら棚の上を飛び越えてマスの真上に着くので、順番待ちを飛ばして運べます', panel: 'upgrades' };
  return { id: 'drone', text: `搬送ロボがポートやステーションの横付けで順番待ちしています。ドローン搬送ロボ（${price(w, ROBOT.droneCost)} コイン）なら棚の上を飛び越えてマスの真上に着くので、順番待ちを飛ばして運べます（現在 ${drones} 台）`, panel: 'upgrades' };
}
