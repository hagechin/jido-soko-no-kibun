import { icon, iconText, type IconName } from './icon';
/** 建設モード UI（§8）。ツールを選んで 3D ビューのセルをタップする */
import { BUILD_COST, BUILD_LABEL, expansionCells, expansionCost, maxExpansionsForRank, type BuildKind, type ExpandDir } from '../sim/build';
import type { WorldState } from '../sim/types';
import { el } from './layout';

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

/** 「30 🪙」の代わり: コインアイコン + 数字 */
function coinCost(n: number): HTMLElement {
  return el('span', { class: 'cost' }, icon('coins', 12), document.createTextNode(String(n)));
}

export function renderBuild(body: HTMLElement, ctx: BuildContext): void {
  const w = ctx.world;
  const tools = el('div', { class: 'build-tools' });
  const list: BuildTool[] = ['stack', 'port', 'pickStation', 'inboundStation', 'waitSpot', 'move', 'erase'];
  for (const t of list) {
    const label = t === 'erase' ? '撤去' : t === 'move' ? '移動' : BUILD_LABEL[t];
    const cost = t === 'erase' || t === 'move' ? el('span', { class: 'cost', text: '無料' }) : coinCost(BUILD_COST[t]);
    const b = el('button', { class: `btn build-tool${ctx.state.tool === t ? ' is-active' : ''}`, type: 'button' }, el('span', { class: 'ico' }, icon(ICON[t], 20)), el('span', { class: 'lbl', text: label }), cost);
    b.addEventListener('click', () => ctx.onToolChange(t));
    tools.append(b);
  }
  const left = maxExpansionsForRank(w) - w.expansions;
  for (const [dir, ico, lbl] of [
    ['east', 'move-horizontal', '東へ +4列'],
    ['south', 'move-vertical', '南へ +4行'],
  ] as [ExpandDir, IconName, string][]) {
    const exCost = expansionCost(w, dir);
    const ex = el('button', { class: 'btn build-tool', type: 'button', title: exCost === null ? '' : `${expansionCells(w, dir)} マス増える` }, el('span', { class: 'ico' }, icon(ico, 20)), el('span', { class: 'lbl', text: lbl }), exCost === null ? el('span', { class: 'cost', text: 'MAX' }) : left <= 0 ? el('span', { class: 'cost', text: 'ランク' }) : coinCost(exCost));
    if (exCost === null || left <= 0 || w.coins < exCost) ex.setAttribute('disabled', 'true');
    ex.addEventListener('click', () => ctx.onExpand(dir));
    tools.append(ex);
  }
  body.append(tools);
  if (ctx.onOpenEditor) {
    const open = el('button', { class: 'btn primary', type: 'button' }, iconText('layers', 'レイアウトエディタ（倉庫を停止して俯瞰で配置換え）', 16));
    open.addEventListener('click', () => ctx.onOpenEditor!());
    body.append(el('div', { class: 'settings-row' }, open));
  }
  const hint = ctx.state.tool === 'erase' ? '撤去する設備をタップ（無料）' : ctx.state.tool === 'move' ? (ctx.state.held ? '移動先のセルをタップ' : '動かす設備をタップ') : `${BUILD_LABEL[ctx.state.tool]} を置くセルをタップ`;
  body.append(el('div', { class: 'build-hint' }, el('span', { text: hint }), el('span', { class: 'muted small', text: `　${w.width}×${w.height} マス / 建設中はシミュレーション停止` })));
}
