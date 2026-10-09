/**
 * 見た目（サポーターパック、SPEC-iOS §1）: 金色ロボスキンと倉庫カラーテーマ。
 * 設定は localStorage。機能 `cosmetics` が無ければ標準に戻す（返金など）
 */
import { hasFeature } from '../platform/entitlements';
import { tr } from '../i18n';

export type Skin = 'standard' | 'gold';
export type Theme = 'standard' | 'midnight' | 'sand';

export const THEMES: { id: Theme; name: string; desc: string }[] = [
  { id: 'standard', name: tr(tr(tr(tr(tr('標準'))))), desc: tr(tr(tr(tr(tr('青みの濃紺'))))) },
  { id: 'midnight', name: tr(tr(tr(tr(tr('ミッドナイト'))))), desc: tr(tr(tr(tr(tr('黒に近い紫。夜向け'))))) },
  { id: 'sand', name: tr(tr(tr(tr(tr('サンド'))))), desc: tr(tr(tr(tr(tr('明るい砂色。昼向け'))))) },
];

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
      return { skin: c.skin === 'gold' ? 'gold' : 'standard', theme: THEMES.some((t) => t.id === c.theme) ? (c.theme as Theme) : 'standard' };
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

/** 実際に使う値（機能が無ければ標準） */
export function effectiveCosmetics(): Cosmetics {
  const c = loadCosmetics();
  return hasFeature('cosmetics') ? c : { skin: 'standard', theme: 'standard' };
}

/** CSS テーマを反映（html の data-theme） */
export function applyTheme(theme: Theme): void {
  if (theme === 'standard') delete document.documentElement.dataset.theme;
  else document.documentElement.dataset.theme = theme;
}
