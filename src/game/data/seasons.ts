/**
 * 季節カレンダー・需要係数・年間イベント（§6）。
 * 需要係数は「月 → カテゴリ係数」と「月 → 商品個別係数」の 2 段。
 */
import type { ItemCategory } from './items';
import { itemDef } from './items';
import { tr } from '../i18n';

/** 月ごとのカテゴリ需要係数（1.0 = 平常） */
export const CATEGORY_DEMAND: Record<number, Partial<Record<ItemCategory, number>>> = {
  1: { toy: 1.2, food: 1.3 },
  2: { food: 1.2, appliance: 1.1 },
  3: { appliance: 1.6, goods: 1.4, stationery: 1.5 },
  4: { appliance: 1.5, goods: 1.3, stationery: 1.5 },
  5: { apparel: 1.2 },
  6: { goods: 1.1 },
  7: { food: 1.6, drink: 1.5 },
  8: { drink: 1.8, food: 1.1 },
  9: { book: 1.3 },
  10: { toy: 1.5, food: 1.4 },
  11: { electronics: 1.3, toy: 1.2 },
  12: { toy: 1.6, food: 1.5, electronics: 1.3 },
};

/** 月ごとの商品個別係数（カテゴリ係数に掛ける） */
export const ITEM_DEMAND: Record<number, Record<string, number>> = {
  1: { cake: 1.3, plush: 1.3 },
  2: { cake: 1.6 },
  3: { pencil: 1.6, scissors: 1.5, lamp: 1.4, clock: 1.4, mug: 1.4 },
  4: { pencil: 1.6, scissors: 1.5, lamp: 1.4, clock: 1.4, mug: 1.4 },
  6: { umbrella: 4.0 },
  7: { milk: 1.5, fish: 1.8, apple: 1.3, banana: 1.5 },
  8: { milk: 1.8, banana: 1.5, hat: 1.4, ball: 1.3 },
  10: { plush: 2.0, cake: 1.6, hat: 1.5 },
  11: { console: 1.5, camera: 1.4, headphones: 1.5 },
  12: { cake: 2.2, plush: 2.0, console: 1.4, robot: 1.8 },
};

export function demandFor(itemId: string, month: number): number {
  const def = itemDef(itemId);
  const cat = CATEGORY_DEMAND[month]?.[def.category] ?? 1;
  const own = ITEM_DEMAND[month]?.[itemId] ?? 1;
  return cat * own;
}

export type EventId = 'newYear' | 'newLife' | 'rainy' | 'midsummerGift' | 'halloween' | 'cyberWeek' | 'christmas';

export interface SeasonEvent {
  id: EventId;
  name: string;
  /** [月, 週] の区間（両端含む）。年をまたがない前提 */
  from: [number, number];
  to: [number, number];
  /** オーダー到着間隔の倍率（小さいほど多い） */
  intervalFactor: number;
  /** 1オーダーの行数の倍率 */
  linesFactor: number;
  /** 報酬倍率 */
  rewardFactor: number;
  /** 強調するカテゴリ／商品（オーダー生成の重み） */
  boostCategories?: Partial<Record<ItemCategory, number>>;
  boostItems?: Record<string, number>;
  banner: string;
}

export const SEASON_EVENTS: readonly SeasonEvent[] = [
  { id: 'newYear', name: tr('初売り・福袋'), from: [1, 1], to: [1, 1], intervalFactor: 1.0, linesFactor: 1.8, rewardFactor: 1.1, banner: tr('初売り・福袋セール！オーダーが大きい') },
  { id: 'newLife', name: tr('新生活'), from: [3, 1], to: [4, 4], intervalFactor: 0.9, linesFactor: 1.1, rewardFactor: 1.0, boostCategories: { appliance: 1.5, goods: 1.3, stationery: 1.3 }, banner: tr('新生活シーズン。家電・日用品が売れる') },
  { id: 'rainy', name: tr('梅雨'), from: [6, 1], to: [6, 4], intervalFactor: 0.9, linesFactor: 1.0, rewardFactor: 1.0, boostItems: { umbrella: 4 }, banner: tr('梅雨。傘が爆売れ') },
  { id: 'midsummerGift', name: tr('お中元'), from: [7, 1], to: [7, 4], intervalFactor: 1.0, linesFactor: 1.3, rewardFactor: 1.1, boostCategories: { food: 1.8, drink: 1.5 }, banner: tr('お中元。食品の大口オーダー') },
  { id: 'halloween', name: tr('ハロウィン'), from: [10, 1], to: [10, 4], intervalFactor: 0.9, linesFactor: 1.1, rewardFactor: 1.0, boostCategories: { toy: 1.6 }, boostItems: { cake: 1.5, plush: 2 }, banner: tr('ハロウィン。ぬいぐるみ・お菓子') },
  { id: 'cyberWeek', name: tr('サイバーウィーク'), from: [11, 4], to: [12, 1], intervalFactor: 0.2, linesFactor: 1.6, rewardFactor: 1.5, banner: tr('サイバーウィーク開催中！') },
  { id: 'christmas', name: tr('クリスマス・歳末'), from: [12, 3], to: [12, 4], intervalFactor: 0.75, linesFactor: 1.2, rewardFactor: 1.1, boostCategories: { toy: 1.6, food: 1.3 }, boostItems: { cake: 2 }, banner: tr('クリスマス・歳末。需要が高い') },
];

/** サイバーウィーク予告の週数（§6.4: 3週間前） */
export const CYBER_WEEK_NOTICE_WEEKS = 3;
/** 事前入荷の回数と倍率 */
export const CYBER_WEEK_PRESTOCK = { trucks: 3, factor: 2.5 };

export function weekIndex(month: number, week: number): number {
  return (month - 1) * 4 + (week - 1);
}

export function isEventActive(ev: SeasonEvent, month: number, week: number): boolean {
  const w = weekIndex(month, week);
  return w >= weekIndex(ev.from[0], ev.from[1]) && w <= weekIndex(ev.to[0], ev.to[1]);
}

export function activeEvents(month: number, week: number): SeasonEvent[] {
  return SEASON_EVENTS.filter((e) => isEventActive(e, month, week));
}

export function eventById(id: EventId): SeasonEvent {
  return SEASON_EVENTS.find((e) => e.id === id)!;
}
