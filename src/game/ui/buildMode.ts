import { icon, iconText, type IconName } from './icon';
/** 建設モード UI（§8）。ツールを選んで 3D ビューのセルをタップする */
import { BUILD_LABEL, buildCost, expansionCells, expansionCost, maxExpansionsForRank, type BuildKind, type ExpandDir } from '../sim/build';
import type { WorldState } from '../sim/types';
import { el } from './layout';
import { limitsFor } from '../sim/limits';
import { LIMITS } from '../data/balance';
import { limitHint } from './limitHint';
import { tr } from '../i18n';

export type BuildTool = BuildKind | 'erase' | 'move';

export interface BuildUiState {
  tool: BuildTool;
  /** 移動ツールで持ち上げた設備のセル */
  held: { x: number; z: number } | null;
}

export interface BuildContext {
  world: WorldState;
  state: BuildUiState;
  onToolChange: (tool: BuildTool) => void;
  onExpand: (dir: ExpandDir) => void;
  refresh: () => void;
  /** レイアウトエディタ（倉庫を止めて俯瞰でまとめて配置換え）を開く */
  onOpenEditor?: () => void;
}

const ICON: Record<BuildTool, IconName> = {
  stack: 'layers',
  port: 'square',
  pickStation: 'user',
  inboundStation: 'package',
  waitSpot: 'circle-parking',
  erase: 'eraser',
  move: 'move',
};

/** ツールの並び = ショートカットの番号（1〜7） */
export const BUILD_TOOL_ORDER: BuildTool[] = ['stack', 'port', 'pickStation', 'inboundStation', 'waitSpot', 'move', 'erase'];

/** 「30 🪙」の代わり: コインアイコン + 数字 */
function coinCost(n: number): HTMLElement {
  return el('span', { class: 'cost' }, icon('coins', 12), document.createTextNode(n.toLocaleString('ja-JP')));
}

/** ツールバーの横スクロール位置（描き直しても戻らないように覚えておく） */
let toolsScroll = 0;

export function renderBuild(body: HTMLElement, ctx: BuildContext): void {
  const w = ctx.world;
  const tools = el('div', { class: 'build-tools' });
  tools.addEventListener('scroll', () => (toolsScroll = tools.scrollLeft), { passive: true });
  const list: BuildTool[] = BUILD_TOOL_ORDER;
  list.forEach((t, i) => {
    const label = t === 'erase' ? tr(tr(tr('撤去'))) : t === 'move' ? tr(tr(tr('移動'))) : BUILD_LABEL[t];
    const cost = t === 'erase' || t === 'move' ? el('span', { class: 'cost', text: tr(tr(tr('無料'))) }) : coinCost(buildCost(w, t));
    const b = el('button', { class: `btn build-tool${ctx.state.tool === t ? ' is-active' : ''}`, type: 'button', title: tr(tr(tr('{0}（{1}）')), label, i + 1) }, el('span', { class: 'ico' }, icon(ICON[t], 20)), el('span', { class: 'lbl' }, el('kbd', { class: 'key', text: String(i + 1) }), document.createTextNode(label)), cost);
    b.addEventListener('click', () => ctx.onToolChange(t));
    tools.append(b);
  });
  const left = maxExpansionsForRank(w) - w.expansions;
  for (const [dir, ico, lbl] of [
    ['east', 'move-horizontal', tr(tr(tr('東へ +4列')))],
    ['south', 'move-vertical', tr(tr(tr('南へ +4行')))],
  ] as [ExpandDir, IconName, string][]) {
    const exCost = expansionCost(w, dir);
    const ex = el('button', { class: 'btn build-tool', type: 'button', title: exCost === null ? '' : tr(tr(tr('{0} マス増える')), expansionCells(w, dir)) }, el('span', { class: 'ico' }, icon(ico, 20)), el('span', { class: 'lbl', text: lbl }), exCost === null ? el('span', { class: 'cost', text: 'MAX' }) : left <= 0 ? el('span', { class: 'cost', text: tr(tr(tr('ランク'))) }) : coinCost(exCost));
    if (exCost === null || left <= 0 || w.coins < exCost) ex.setAttribute('disabled', 'true');
    ex.addEventListener('click', () => ctx.onExpand(dir));
    tools.append(ex);
  }
  body.append(tools);
  tools.scrollLeft = toolsScroll;
  if (ctx.onOpenEditor) {
    const open = el('button', { class: 'btn primary', type: 'button', title: 'L' }, iconText('layers', tr(tr(tr('レイアウトエディタ（倉庫を停止して俯瞰で配置換え）'))), 16), el('kbd', { class: 'key', text: 'L' }));
    open.addEventListener('click', () => ctx.onOpenEditor!());
    body.append(el('div', { class: 'settings-row' }, open));
  }
  const hint = ctx.state.tool === 'erase' ? tr(tr(tr('撤去する設備をタップ（無料）'))) : ctx.state.tool === 'move' ? (ctx.state.held ? tr(tr(tr('移動先のセルをタップ'))) : tr(tr(tr('動かす設備をタップ')))) : tr(tr(tr('{0} を置くセルをタップ')), BUILD_LABEL[ctx.state.tool]);
  const lim = limitsFor(w);
  const atMax = expansionCost(w, 'east') === null && expansionCost(w, 'south') === null;
  const capHint = limitHint(atMax, tr(tr(tr('{0}×{1} まで')), LIMITS.expanded.maxWidth, LIMITS.expanded.maxHeight));
  body.append(el('div', { class: 'build-hint' }, el('span', { text: hint }), el('span', { class: 'muted small', text: tr(tr(tr('　{0}×{1} マス（上限 {2}×{3}{4}） / 建設中はシミュレーション停止')), w.width, w.height, lim.maxWidth, lim.maxHeight, capHint) })));
}
