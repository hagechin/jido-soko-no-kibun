/**
 * 取引先（1.2、SPEC-1.2 §1）。依頼を出してくる会社。扱うカテゴリの商品で依頼が決まる。
 * 信用とレベルはプレイヤー全体の記録（ui/profile.ts）。経営モードでは顧客になる（PLAN-SIM-MODE）。
 */
import { tr } from '../i18n';
import { CONTRACTS } from './balance';
import type { ItemCategory } from './items';

export type ClientId = 'marufuku' | 'tsubame' | 'denden' | 'kotori' | 'popo';

export interface ClientDef {
  id: ClientId;
  name: string;
  desc: string;
  categories: ItemCategory[];
  /** 取引先の色（注文票の印、ロボの塗装） */
  color: string;
}

export const CLIENTS: readonly ClientDef[] = [
  { id: 'marufuku', name: tr('まるふく食品'), desc: tr('食品・飲料'), categories: ['food', 'drink'], color: '#e0503c' },
  { id: 'tsubame', name: tr('ツバメ文具'), desc: tr('文具・本'), categories: ['stationery', 'book'], color: '#3b6fd6' },
  { id: 'denden', name: tr('デンデン電機'), desc: tr('電子機器・家電'), categories: ['electronics', 'appliance'], color: '#f0b429' },
  { id: 'kotori', name: tr('コトリ雑貨'), desc: tr('雑貨・衣料'), categories: ['goods', 'apparel'], color: '#3ca13c' },
  { id: 'popo', name: tr('ポポ玩具'), desc: tr('おもちゃ'), categories: ['toy'], color: '#ff7fb0' },
];

export const CLIENT_BY_ID: Readonly<Record<string, ClientDef>> = Object.fromEntries(CLIENTS.map((c) => [c.id, c]));

/** 信用 → レベル（1〜） */
export function clientLevel(trust: number): number {
  let lv = 0;
  for (const t of CONTRACTS.trustLevels) if (trust >= t) lv++;
  return Math.max(1, lv);
}

/** 次のレベルに要る信用（最大レベルなら null） */
export function nextLevelTrust(trust: number): number | null {
  return CONTRACTS.trustLevels[clientLevel(trust)] ?? null;
}

/** レベルによる依頼の報酬の倍率 */
export function levelRewardFactor(level: number): number {
  return 1 + CONTRACTS.levelRewardBonus * (Math.max(1, level) - 1);
}
