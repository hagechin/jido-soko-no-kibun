/** 実績の一覧（下部バーの「実績」パネル）: メダル・いまの値・次の段・進捗バー */
import { MEDALS } from '../data/balance';
import { achievementStatuses, formatAchievementValue, type AchievementProfile, type AchievementStatus } from '../sim/achievements';
import type { WorldState } from '../sim/types';
import { icon, type IconName } from './icon';
import { el } from './layout';

/** メダルのアイコン（銅・銀・金はメダル、プラチナは宝石、月は月） */
export function medalIcon(tier: number, size = 16): SVGSVGElement {
  const name: IconName = tier >= 5 ? 'moon' : tier >= 4 ? 'gem' : 'medal';
  return icon(name, size, `medal medal-${Math.min(tier, MEDALS.length)}`);
}

function row(s: AchievementStatus): HTMLElement {
  const { def, tier, worldTier, next, progress, value } = s;
  // 右上はプレイヤーの記録（メダル）。バーと「次」は今の倉庫の進み。記録の方が上なら「記録」と添える
  const medalText = tier > 0 ? `${tier > worldTier ? '記録 ' : ''}${MEDALS[Math.min(tier, MEDALS.length) - 1]}（${def.tiers[tier - 1].label}）` : 'まだ';
  const head = el('div', { class: 'ach-head' }, medalIcon(tier), el('span', { class: 'ach-name', text: def.name }), el('span', { class: 'muted small ach-medal', text: medalText }));
  const bar = el('div', { class: 'ach-bar' }, el('div', { class: 'ach-fill', style: `width:${Math.round(progress * 100)}%` }));
  const foot = el('div', { class: 'muted small' }, el('span', { text: `この倉庫: ${formatAchievementValue(def, value)}` }), el('span', { text: next ? ` → 次: ${next.label}` : '　この倉庫でコンプリート' }));
  return el('div', { class: `ach-row${tier > 0 ? ' is-earned' : ''}` }, head, bar, foot, el('div', { class: 'muted small ach-desc', text: def.desc }));
}

export function renderAchievements(body: HTMLElement, w: WorldState, profile: AchievementProfile = {}): void {
  const all = achievementStatuses(w, profile);
  const earned = all.filter((s) => s.tier > 0).length;
  body.append(el('h4', { text: `実績（${earned} / ${all.length} 達成）` }));
  body.append(el('p', { class: 'muted small', text: '計測はゲーム内の時間（倍速で早くはなりません）。距離は 1 マス = 1 m。金の先にプラチナと「月まで」がある実績もあります。メダルはプレイヤーの記録として、新しく始めたりセーブを読み込んだりしても残ります' }));
  if (w.sandbox) body.append(el('p', { class: 'muted small', text: 'サンドボックスのプリセット倉庫では、この倉庫での進みだけを表示し、プレイヤーの記録には入りません' }));
  for (const s of all.filter((s) => !s.def.negative)) body.append(row(s));
  body.append(el('h4', { text: '称号（ネガティブ）' }));
  for (const s of all.filter((s) => s.def.negative)) body.append(row(s));
}
