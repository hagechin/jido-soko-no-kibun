import { describe, expect, it } from 'vitest';
import { detectLocale, locale, missingTranslations, setLocale, tr } from './index';
import { EN } from './en';

describe('i18n', () => {
  it('端末の言語: ja で始まれば日本語、それ以外は英語、無ければ日本語', () => {
    expect(detectLocale(['ja-JP', 'en'])).toBe('ja');
    expect(detectLocale(['en-US'])).toBe('en');
    expect(detectLocale(['fr', 'ja'])).toBe('ja');
    expect(detectLocale([])).toBe('ja');
  });
  it('日本語ではそのまま、英語では辞書、無いキーは日本語のまま。引数は {0} {1}', () => {
    expect(locale()).toBe('ja');
    expect(tr('現在 {0} 台（上限 {1}）{2}', 3, 40, '')).toBe('現在 3 台（上限 40）');
    setLocale('en');
    expect(tr('現在 {0} 台（上限 {1}）{2}', 3, 40, '')).toBe('Now 3 (limit 40)');
    expect(tr('辞書に無い文')).toBe('辞書に無い文');
    expect(tr('りんご')).toBe('Apple');
    setLocale('ja');
  });
  it('辞書のプレースホルダはキーと一致している', () => {
    const ph = (s: string) => [...s.matchAll(/\{(\d+)\}/g)].map((m) => m[1]).sort().join(',');
    const bad = Object.entries(EN).filter(([k, v]) => ph(k) !== ph(v));
    expect(bad).toEqual([]);
    expect(Object.keys(EN).length).toBeGreaterThan(650);
    expect(missingTranslations(['りんご', '辞書に無い文'])).toEqual(['辞書に無い文']);
  });
});
