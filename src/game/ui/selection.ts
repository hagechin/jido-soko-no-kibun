/** 選択中ロボの情報（下部バー）と指示のヒント */
import type { Robot, WorldState } from '../sim/types';
import { describeRobot } from '../sim/robots';
import { itemDef } from '../data/items';
import { el } from './layout';
import { iconImg } from './icons';

export function selectedInfoNode(w: WorldState, r: Robot | null, hint: string | null, onCancel: () => void): Node {
  if (!r) return el('span', { class: 'muted', text: hint ?? 'ロボをタップして選択' });
  const root = el('div', { class: 'selected-inner' });
  root.append(el('span', { class: 'sel-name', text: `${r.kind === 'shelf' ? '🟥' : '🟦'} ${r.name}` }));
  root.append(el('span', { class: 'sel-status', text: describeRobot(w, r) }));
  if (r.carrying.length) {
    const cargo = el('span', { class: 'sel-cargo' });
    for (const id of r.carrying) {
      const b = w.bins[id];
      if (b?.item) cargo.append(iconImg(b.item, 20));
      else cargo.append(el('span', { text: '▫' }));
    }
    root.append(cargo);
  }
  if (r.queue.length) root.append(el('span', { class: 'sel-queue', text: `予約 ${r.queue.length}` }));
  root.append(el('span', { class: 'hint', text: hint ?? (r.kind === 'shelf' ? 'スタックをタップで取り出し' : 'ポート／ステーションをタップ') }));
  const cancel = el('button', { class: 'btn', type: 'button', text: '✕ 指示取消', title: '指示を取り消す' });
  cancel.addEventListener('click', onCancel);
  root.append(el('span', { class: 'sel-actions' }, cancel));
  return root;
}

export function binLabel(w: WorldState, binId: number): string {
  const b = w.bins[binId];
  if (!b) return '?';
  if (!b.item) return '空ビン';
  return `${itemDef(b.item).name} ×${b.qty}`;
}
