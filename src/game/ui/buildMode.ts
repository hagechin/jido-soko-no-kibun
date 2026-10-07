/** 建設モード UI（§8）。ツールを選んで 3D ビューのセルをタップする */
import { BUILD_COST, BUILD_LABEL, expansionCost, maxExpansionsForRank, type BuildKind } from '../sim/build';
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
  onExpand: () => void;
  refresh: () => void;
}

const ICON: Record<BuildTool, string> = {
  stack: '🗄',
  port: '🟨',
  pickStation: '🧑‍🏭',
  inboundStation: '📦',
  waitSpot: '🅿️',
  erase: '🧹',
  move: '✋',
};

export function renderBuild(body: HTMLElement, ctx: BuildContext): void {
  const w = ctx.world;
  const tools = el('div', { class: 'build-tools' });
  const list: BuildTool[] = ['stack', 'port', 'pickStation', 'inboundStation', 'waitSpot', 'move', 'erase'];
  for (const t of list) {
    const label = t === 'erase' ? '撤去' : t === 'move' ? '移動' : BUILD_LABEL[t];
    const cost = t === 'erase' ? '無料' : t === 'move' ? '無料' : `${BUILD_COST[t]}🪙`;
    const b = el('button', { class: `btn build-tool${ctx.state.tool === t ? ' is-active' : ''}`, type: 'button' }, el('span', { class: 'ico', text: ICON[t] }), el('span', { class: 'lbl', text: label }), el('span', { class: 'cost', text: cost }));
    b.addEventListener('click', () => ctx.onToolChange(t));
    tools.append(b);
  }
  const exCost = expansionCost(w);
  const left = maxExpansionsForRank(w) - w.expansions;
  const ex = el('button', { class: 'btn build-tool', type: 'button' }, el('span', { class: 'ico', text: '↔️' }), el('span', { class: 'lbl', text: `面積 +4` }), el('span', { class: 'cost', text: exCost === null ? 'MAX' : left <= 0 ? 'ランク' : `${exCost}🪙` }));
  if (exCost === null || left <= 0 || w.coins < exCost) ex.setAttribute('disabled', 'true');
  ex.addEventListener('click', () => ctx.onExpand());
  tools.append(ex);
  body.append(tools);
  const hint = ctx.state.tool === 'erase' ? '撤去する設備をタップ（無料）' : ctx.state.tool === 'move' ? (ctx.state.held ? '移動先のセルをタップ' : '動かす設備をタップ') : `${BUILD_LABEL[ctx.state.tool]} を置くセルをタップ`;
  body.append(el('div', { class: 'build-hint' }, el('span', { text: hint }), el('span', { class: 'muted small', text: `　${w.width}×${w.height} マス / 建設中はシミュレーション停止` })));
}
