/**
 * 本社への投資（1.2、SPEC-1.2 §3）。倉庫ごとの恒久強化。買い切りの強化が MAX になった後のコインの受け皿。
 * 段は w.hq（古いセーブには無い = すべて 0）。
 */
import { CONTRACTS, HQ, OFFLINE } from '../data/balance';
import { price } from './pricing';
import type { HqState, WorldState } from './types';
import { tr } from '../i18n';

export type HqId = keyof HqState;
export const HQ_ORDER: HqId[] = ['sales', 'relations', 'slots', 'offline'];

type Hq = Pick<WorldState, 'hq'>;

export function hqLevel(w: Hq, id: HqId): number {
  return Math.max(0, Math.floor(w.hq?.[id] ?? 0));
}

export function hqMaxLevel(id: HqId): number {
  switch (id) {
    case 'sales':
      return HQ.sales.levels;
    case 'relations':
      return HQ.relations.costs.length;
    case 'slots':
      return HQ.slots.costs.length;
    case 'offline':
      return HQ.offline.costs.length;
  }
}

/** 次の段の値段（MAX なら null） */
export function hqCost(w: Pick<WorldState, 'hq' | 'economy'>, id: HqId): number | null {
  const lv = hqLevel(w, id);
  if (lv >= hqMaxLevel(id)) return null;
  switch (id) {
    case 'sales': {
      // 5 万 → 2.2 倍ずつ。上 2 桁で丸める
      const raw = HQ.sales.baseCost * Math.pow(HQ.sales.growth, lv);
      const mag = Math.pow(10, Math.max(0, Math.floor(Math.log10(raw)) - 1));
      return price(w, Math.round(raw / mag) * mag);
    }
    case 'relations':
      return price(w, HQ.relations.costs[lv]);
    case 'slots':
      return price(w, HQ.slots.costs[lv]);
    case 'offline':
      return price(w, HQ.offline.costs[lv]);
  }
}

/** 営業部: 出荷の報酬の倍率 */
export function salesFactor(w: Hq): number {
  return 1 + HQ.sales.perLevel * Math.min(hqLevel(w, 'sales'), HQ.sales.levels);
}

/** 渉外部: 依頼の報酬コインの倍率 */
export function relationsFactor(w: Hq): number {
  return 1 + HQ.relations.perLevel * Math.min(hqLevel(w, 'relations'), HQ.relations.costs.length);
}

/** 受注窓口: 毎日の依頼の件数 */
export function dailySlots(w: Hq): number {
  return CONTRACTS.dailySlots + Math.min(hqLevel(w, 'slots'), HQ.slots.costs.length);
}

/** 留守番体制: お留守番の上限（時間） */
export function offlineCapHours(w: Hq): number {
  const h = HQ.offline.hours;
  return h[Math.min(hqLevel(w, 'offline'), h.length - 1)];
}

export function offlineCapMs(w: Hq): number {
  return Math.max(OFFLINE.maxOfflineMs, offlineCapHours(w) * 60 * 60_000);
}

/** 部門の名前と、いまの段・次の段の効果（表示用） */
export function hqInfo(w: Hq, id: HqId): { name: string; desc: string; now: string; next: string | null } {
  const lv = hqLevel(w, id);
  const max = lv >= hqMaxLevel(id);
  const pct = (v: number) => `+${Math.round(v * 100)}%`;
  switch (id) {
    case 'sales':
      return { name: tr('営業部'), desc: tr('出荷の報酬が増える'), now: pct(HQ.sales.perLevel * lv), next: max ? null : pct(HQ.sales.perLevel * (lv + 1)) };
    case 'relations':
      return { name: tr('渉外部'), desc: tr('依頼の報酬コインが増える'), now: pct(HQ.relations.perLevel * lv), next: max ? null : pct(HQ.relations.perLevel * (lv + 1)) };
    case 'slots':
      return { name: tr('受注窓口'), desc: tr('毎日の依頼の件数が増える'), now: tr('{0} 件', CONTRACTS.dailySlots + lv), next: max ? null : tr('{0} 件', CONTRACTS.dailySlots + lv + 1) };
    case 'offline':
      return { name: tr('留守番体制'), desc: tr('お留守番でまとめて計算する時間の上限が延びる'), now: tr('{0} 時間', HQ.offline.hours[lv]), next: max ? null : tr('{0} 時間', HQ.offline.hours[lv + 1]) };
  }
}

export function buyHq(w: WorldState, id: HqId): { ok: true; message?: string } | { ok: false; reason: string } {
  const cost = hqCost(w, id);
  if (cost === null) return { ok: false, reason: tr('これ以上は上げられません') };
  if (w.coins < cost) return { ok: false, reason: tr('コインが足りません（{0} 必要）', cost) };
  w.coins -= cost;
  if (!w.hq) w.hq = { sales: 0, relations: 0, slots: 0, offline: 0 };
  w.hq[id] = hqLevel(w, id) + 1;
  const info = hqInfo(w, id);
  return { ok: true, message: tr('{0} に投資しました（{1}）', info.name, info.now) };
}
