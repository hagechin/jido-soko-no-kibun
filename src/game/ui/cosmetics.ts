/**
 * 見た目: ロボの塗装と倉庫カラーテーマ。選んだものは localStorage、持っているものはプレイヤーの記録（ui/profile.ts）。
 * 入手先（1.2、SPEC-1.2 §4）: 標準／サポーターパック（SPEC-iOS §1）／取引先のレベル／コインで購入（季節のテーマは実際の月にだけ店に並ぶ）。
 * 使えなくなったもの（返金など）は標準に戻す
 */
import { CONTRACTS } from '../data/balance';
import { CLIENTS, clientLevel, type ClientId } from '../data/clients';
import { hasFeature } from '../platform/entitlements';
import { tr } from '../i18n';

export type Skin = string;
export type Theme = string;

/** ロボの色（render/scene.ts の robotColors と同じ形） */
export interface RobotColors {
  shelf: string;
  double: string;
  amr: string;
  amrDark: string;
  drone: string;
  droneDark: string;
}

export type CosmeticSource =
  | { type: 'free' }
  | { type: 'supporter' }
  /** 取引先のレベルで解放（無料） */
  | { type: 'client'; client: ClientId }
  /** コインで購入。months があれば実際のその月にだけ店に並ぶ（買えば一年中使える） */
  | { type: 'coins'; price: number; months?: number[] };

export interface PaintDef {
  id: Skin;
  name: string;
  desc: string;
  /** null = 標準の色 */
  colors: RobotColors | null;
  source: CosmeticSource;
}

export interface ThemeDef {
  id: Theme;
  name: string;
  desc: string;
  /** 3D ビューの背景と霧の色 */
  backdrop: string;
  /** 見本の色（店の一覧用） */
  swatch: string;
  source: CosmeticSource;
}

const CLIENT_PAINT: Record<ClientId, RobotColors> = {
  marufuku: { shelf: '#e0503c', double: '#b8402f', amr: '#f08a6c', amrDark: '#b3563f', drone: '#ffc2a8', droneDark: '#c07a60' },
  tsubame: { shelf: '#3b6fd6', double: '#2a4f9c', amr: '#7fa6ee', amrDark: '#4a6fb5', drone: '#c3d6fa', droneDark: '#7089b8' },
  denden: { shelf: '#f0b429', double: '#c98f12', amr: '#f7d36b', amrDark: '#b8962f', drone: '#fbe9a9', droneDark: '#b5a25e' },
  kotori: { shelf: '#3ca13c', double: '#2a7a2a', amr: '#7fcf7f', amrDark: '#4a964a', drone: '#c2ecc2', droneDark: '#74a874' },
  popo: { shelf: '#ff7fb0', double: '#d9598c', amr: '#ffb3d0', amrDark: '#c97a9c', drone: '#ffd9e8', droneDark: '#c99bb0' },
};

export const PAINTS: PaintDef[] = [
  { id: 'standard', name: tr('標準'), desc: tr('赤い棚ロボと青い搬送ロボ'), colors: null, source: { type: 'free' } },
  { id: 'gold', name: tr('金色'), desc: tr('全ロボを金色に'), colors: { shelf: '#e2b53a', double: '#c9931c', amr: '#d4a62a', amrDark: '#9c7514', drone: '#f0cc5c', droneDark: '#a67f1a' }, source: { type: 'supporter' } },
  ...CLIENTS.map((c): PaintDef => ({ id: `client-${c.id}`, name: tr('{0}カラー', c.name), desc: tr('{0}の色', c.name), colors: CLIENT_PAINT[c.id], source: { type: 'client', client: c.id } })),
  { id: 'mono', name: tr('モノクロ'), desc: tr('白と灰色'), colors: { shelf: '#f2f2f2', double: '#bdbdbd', amr: '#8a8a8a', amrDark: '#4d4d4d', drone: '#ffffff', droneDark: '#9a9a9a' }, source: { type: 'coins', price: 80_000 } },
  { id: 'pastel', name: tr('パステル'), desc: tr('やわらかい色'), colors: { shelf: '#f7a8b8', double: '#f9c784', amr: '#a8d8f0', amrDark: '#7fb0c8', drone: '#c8f0d0', droneDark: '#8fc0a0' }, source: { type: 'coins', price: 120_000 } },
  { id: 'neon', name: tr('ネオン'), desc: tr('夜に映える蛍光色'), colors: { shelf: '#ff2e88', double: '#ff9f1c', amr: '#00e5ff', amrDark: '#0097a7', drone: '#b6ff00', droneDark: '#6aa000' }, source: { type: 'coins', price: 250_000 } },
];

export const THEMES: ThemeDef[] = [
  { id: 'standard', name: tr('標準'), desc: tr('青みの濃紺'), backdrop: '#dfe9f3', swatch: '#243242', source: { type: 'free' } },
  { id: 'midnight', name: tr('ミッドナイト'), desc: tr('黒に近い紫。夜向け'), backdrop: '#2a2638', swatch: '#1b1824', source: { type: 'supporter' } },
  { id: 'sand', name: tr('サンド'), desc: tr('明るい砂色。昼向け'), backdrop: '#f3ead8', swatch: '#ece2cf', source: { type: 'supporter' } },
  { id: 'forest', name: tr('フォレスト'), desc: tr('深い緑'), backdrop: '#d5e6d2', swatch: '#1c2b23', source: { type: 'coins', price: 100_000 } },
  { id: 'sakura', name: tr('サクラ'), desc: tr('春の桜色'), backdrop: '#fbe8ee', swatch: '#f6d3dd', source: { type: 'coins', price: 150_000, months: [3, 4] } },
  { id: 'ramune', name: tr('ラムネ'), desc: tr('夏の水色'), backdrop: '#d6f1f5', swatch: '#123844', source: { type: 'coins', price: 150_000, months: [7, 8] } },
  { id: 'momiji', name: tr('モミジ'), desc: tr('秋の紅葉色'), backdrop: '#f1dcc4', swatch: '#3a2118', source: { type: 'coins', price: 150_000, months: [10, 11] } },
  { id: 'snow', name: tr('スノー'), desc: tr('冬の雪色'), backdrop: '#eef4fa', swatch: '#e3ebf3', source: { type: 'coins', price: 150_000, months: [12, 1, 2] } },
];

export const PAINT_BY_ID: Readonly<Record<string, PaintDef>> = Object.fromEntries(PAINTS.map((p) => [p.id, p]));
export const THEME_BY_ID: Readonly<Record<string, ThemeDef>> = Object.fromEntries(THEMES.map((t) => [t.id, t]));

/** 持っているものの記録に入れる名前（塗装とテーマで id が重ならないように） */
export const ownedKey = (kind: 'paint' | 'theme', id: string): string => `${kind}:${id}`;

/** 使えるかどうかの判定に要るもの（プレイヤーの記録から） */
export interface CosmeticAccess {
  owned: readonly string[];
  trust: Readonly<Record<string, number>>;
}

export function isUnlocked(kind: 'paint' | 'theme', id: string, source: CosmeticSource, access: CosmeticAccess): boolean {
  switch (source.type) {
    case 'free':
      return true;
    case 'supporter':
      return hasFeature('cosmetics');
    case 'client':
      return clientLevel(access.trust[source.client] ?? 0) >= CONTRACTS.paintLevel;
    case 'coins':
      return access.owned.includes(ownedKey(kind, id));
  }
}

/** いま店に並んでいるか（季節のテーマは実際の月だけ） */
export function inStore(source: CosmeticSource, month: number): boolean {
  return source.type === 'coins' && (!source.months || source.months.includes(month));
}

const KEY = 'jido-soko-no-kibun:cosmetics';

interface Cosmetics {
  skin: Skin;
  theme: Theme;
}

export function loadCosmetics(): Cosmetics {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const c = JSON.parse(raw) as Partial<Cosmetics>;
      return { skin: typeof c.skin === 'string' && PAINT_BY_ID[c.skin] ? c.skin : 'standard', theme: typeof c.theme === 'string' && THEME_BY_ID[c.theme] ? c.theme : 'standard' };
    }
  } catch {
    /* ignore */
  }
  return { skin: 'standard', theme: 'standard' };
}

export function saveCosmetics(c: Cosmetics): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(c));
  } catch {
    /* ignore */
  }
}

/** 実際に使う値（使えなくなったものは標準） */
export function effectiveCosmetics(access: CosmeticAccess): Cosmetics {
  const c = loadCosmetics();
  const paint = PAINT_BY_ID[c.skin];
  const theme = THEME_BY_ID[c.theme];
  return {
    skin: paint && isUnlocked('paint', paint.id, paint.source, access) ? paint.id : 'standard',
    theme: theme && isUnlocked('theme', theme.id, theme.source, access) ? theme.id : 'standard',
  };
}

/** CSS テーマを反映（html の data-theme） */
export function applyTheme(theme: Theme): void {
  if (theme === 'standard') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
