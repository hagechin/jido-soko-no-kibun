/**
 * 多言語対応（feature/i18n）。日本語の文字列そのものをキーにする gettext 方式。
 *  t('現在 {0} 台', n) → 英語なら辞書（en.ts）の訳を返し、無ければ日本語をそのまま返す。
 * DOM に依存しない（sim からも呼べる）。言語の切替は UI 側が setLocale() で行う
 */
import { EN } from './en';

export type Locale = 'ja' | 'en';
export type LocaleSetting = 'auto' | Locale;

export const LOCALE_KEY = 'jido-soko-no-kibun:locale';

/** 起動時に決める（設定があればそれ、無ければ端末の言語）。モジュール読み込み時の t() も正しい言語になる。切替は再読み込みで反映 */
function initialLocale(): Locale {
  try {
    const saved = typeof localStorage !== 'undefined' ? (localStorage.getItem(LOCALE_KEY) as LocaleSetting | null) : null;
    if (saved === 'ja' || saved === 'en') return saved;
    // ブラウザの中だけ端末の言語を見る（Node にも navigator があるので document の有無で判定。テストは常に日本語）
    if (typeof document !== 'undefined' && typeof navigator !== 'undefined') return detectLocale(navigator.languages ?? [navigator.language]);
  } catch {
    /* ignore */
  }
  return 'ja';
}

let current: Locale = initialLocale();
const listeners = new Set<() => void>();

/** 設定の保存（反映は再読み込み後） */
export function saveLocaleSetting(s: LocaleSetting): void {
  try {
    if (s === 'auto') localStorage.removeItem(LOCALE_KEY);
    else localStorage.setItem(LOCALE_KEY, s);
  } catch {
    /* ignore */
  }
}

export function localeSetting(): LocaleSetting {
  try {
    const v = localStorage.getItem(LOCALE_KEY);
    return v === 'ja' || v === 'en' ? v : 'auto';
  } catch {
    return 'auto';
  }
}

export function locale(): Locale {
  return current;
}

export function setLocale(l: Locale): void {
  if (current === l) return;
  current = l;
  for (const h of listeners) h();
}

export function onLocaleChange(h: () => void): () => void {
  listeners.add(h);
  return () => listeners.delete(h);
}

/** 端末の言語から決める（日本語以外は英語） */
export function detectLocale(languages: readonly string[]): Locale {
  for (const l of languages) if (l.toLowerCase().startsWith('ja')) return 'ja';
  return languages.length ? 'en' : 'ja';
}

/** 翻訳。{0} {1} … を引数で埋める。英語の訳が無いキーは日本語のまま */
export function t(key: string, ...args: (string | number)[]): string {
  const s = current === 'en' ? (EN[key] ?? key) : key;
  if (!args.length) return s;
  return s.replace(/\{(\d+)\}/g, (m, i) => {
    const v = args[Number(i)];
    return v === undefined ? m : String(v);
  });
}

/** t の別名（ローカル変数 t との衝突を避けるため、コードではこちらを使う） */
export const tr = t;

/** 辞書に無い（未訳の）キーを列挙する（テスト・開発用） */
export function missingTranslations(keys: Iterable<string>): string[] {
  const out: string[] = [];
  for (const k of keys) if (!(k in EN)) out.push(k);
  return out;
}
