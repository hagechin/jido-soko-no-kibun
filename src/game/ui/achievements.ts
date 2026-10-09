/** 実績の一覧（設定パネルの「実績」セクション）: メダル・いまの値・次の段・進捗バー */
import { MEDALS } from '../data/balance';
import { achievementStatuses, formatAchievementValue, type AchievementStatus } from '../sim/achievements';
import type { WorldState } from '../sim/types';
import { icon, type IconName } from './icon';
import { el } from './layout';
import { tr } from '../i18n';

/** メダルのアイコン（銅・銀・金はメダル、プラチナは宝石、月は月） */
export function medalIcon(tier: number, size = 16): SVGSVGElement {
  const name: IconName = tier >= 5 ? 'moon' : tier >= 4 ? 'gem' : 'medal';
  return icon(name, size, `medal medal-${Math.min(tier, MEDALS.length)}`);
}

function row(s: AchievementStatus): HTMLElement {
  const { def, tier, next, progress, value } = s;
  const head = el('div', { class: 'ach-head' }, medalIcon(tier), el('span', { class: 'ach-name', text: def.name }), el('span', { class: 'muted small ach-medal', text: tier > 0 ? tr('{0}（{1}）', MEDALS[Math.min(tier, MEDALS.length) - 1], def.tiers[tier - 1].label) : tr('まだ') }));
  const bar = el('div', { class: 'ach-bar' }, el('div', { class: 'ach-fill', style: `width:${Math.round(progress * 100)}%` }));
  const foot = el('div', { class: 'muted small' }, el('span', { text: `${formatAchievementValue(def, value)}` }), el('span', { text: next ? tr(' → 次: {0}', next.label) : tr('　コンプリート') }));
  return el('div', { class: `ach-row${tier > 0 ? ' is-earned' : ''}` }, head, bar, foot, el('div', { class: 'muted small ach-desc', text: def.desc }));
}

export function renderAchievements(body: HTMLElement, w: WorldState): void {
  const all = achievementStatuses(w);
  const earned = all.filter((s) => s.tier > 0).length;
  body.append(el('h4', { text: tr('実績（{0} / {1}）', earned, all.length) }));
  body.append(el('p', { class: 'muted small', text: tr('計測はゲーム内の時間（倍速で早くはなりません）。距離は 1 マス = 1 m。金の先にプラチナと「月まで」がある実績もあります') }));
  for (const s of all.filter((s) => !s.def.negative)) body.append(row(s));
  body.append(el('h4', { text: tr('称号（ネガティブ）') }));
  for (const s of all.filter((s) => s.def.negative)) body.append(row(s));
}
