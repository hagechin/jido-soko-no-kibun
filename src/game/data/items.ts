/**
 * 商品マスタ（§10: 24種）。
 * カテゴリは季節需要（seasons.ts）の係数に使う。
 * 色はボクセル表示とUIのフォールバックに使う。ドット絵は icons.ts。
 */
export type ItemCategory = 'food' | 'drink' | 'book' | 'apparel' | 'goods' | 'toy' | 'electronics' | 'stationery' | 'appliance';

export interface ItemDef {
  id: string;
  name: string;
  category: ItemCategory;
  /** ボクセル・UIの主色 */
  color: string;
  /** 絵文字（ドット絵が無い環境のフォールバック） */
  emoji: string;
}

export const ITEMS: readonly ItemDef[] = [
  { id: 'apple', name: 'りんご', category: 'food', color: '#e03c3c', emoji: '🍎' },
  { id: 'book', name: '本', category: 'book', color: '#3b6fd6', emoji: '📘' },
  { id: 'tshirt', name: 'Tシャツ', category: 'apparel', color: '#f2f2f2', emoji: '👕' },
  { id: 'mug', name: 'マグカップ', category: 'goods', color: '#f0b429', emoji: '☕' },
  { id: 'shoes', name: '靴', category: 'apparel', color: '#8b5a2b', emoji: '👟' },
  { id: 'console', name: 'ゲーム機', category: 'electronics', color: '#444a55', emoji: '🎮' },
  { id: 'plush', name: 'ぬいぐるみ', category: 'toy', color: '#c98a5a', emoji: '🧸' },
  { id: 'ball', name: 'ボール', category: 'toy', color: '#ff8c00', emoji: '⚽' },
  { id: 'plant', name: '植物', category: 'goods', color: '#3ca13c', emoji: '🪴' },
  { id: 'clock', name: '時計', category: 'goods', color: '#dddddd', emoji: '⏰' },
  { id: 'headphones', name: 'ヘッドホン', category: 'electronics', color: '#2b2b2b', emoji: '🎧' },
  { id: 'umbrella', name: '傘', category: 'goods', color: '#7a3cd6', emoji: '☂️' },
  { id: 'cake', name: 'ケーキ', category: 'food', color: '#ffb6c1', emoji: '🍰' },
  { id: 'hat', name: '帽子', category: 'apparel', color: '#d9a441', emoji: '🎩' },
  { id: 'camera', name: 'カメラ', category: 'electronics', color: '#333333', emoji: '📷' },
  { id: 'lamp', name: 'ランプ', category: 'appliance', color: '#ffe066', emoji: '💡' },
  { id: 'guitar', name: 'ギター', category: 'goods', color: '#a0522d', emoji: '🎸' },
  { id: 'robot', name: 'ロボット玩具', category: 'toy', color: '#9fb7c9', emoji: '🤖' },
  { id: 'banana', name: 'バナナ', category: 'food', color: '#ffe135', emoji: '🍌' },
  { id: 'milk', name: '牛乳', category: 'drink', color: '#f7f7f7', emoji: '🥛' },
  { id: 'pencil', name: '鉛筆', category: 'stationery', color: '#f5c518', emoji: '✏️' },
  { id: 'scissors', name: 'ハサミ', category: 'stationery', color: '#c0c0c0', emoji: '✂️' },
  { id: 'battery', name: '電池', category: 'appliance', color: '#2e8b57', emoji: '🔋' },
  { id: 'fish', name: '魚', category: 'food', color: '#4aa3df', emoji: '🐟' },
] as const;

export const ITEM_BY_ID: Readonly<Record<string, ItemDef>> = Object.fromEntries(ITEMS.map((i) => [i.id, i]));

export function itemDef(id: string): ItemDef {
  const d = ITEM_BY_ID[id];
  if (!d) throw new Error(`unknown item: ${id}`);
  return d;
}
