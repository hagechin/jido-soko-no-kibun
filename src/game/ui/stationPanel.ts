import { iconText } from './icon';
/** ピッカーの担当商品を変更する（§5.1） */
import { ITEMS } from '../data/items';
import { assignItem, autoAssignItems } from '../sim/build';
import { availableItemIds } from '../sim/orders';
import type { WorldState } from '../sim/types';
import { iconImg } from './icons';
import { el, showToast } from './layout';

export function renderStationPanel(body: HTMLElement, w: WorldState, stationId: number, refresh: () => void): void {
  const st = w.stations.find((s) => s.id === stationId);
  if (!st) return;
  if (st.kind === 'inbound') {
    body.append(el('p', { text: '入荷担当: 搬送ロボが持ってきたビンに、入荷口の山から商品を詰めます（1 個 0.3 秒）。' }));
    body.append(el('p', { class: 'muted small', text: '空ビンには一番多く滞留している商品を詰めます。' }));
    return;
  }
  body.append(el('p', { class: 'small', text: '担当商品をタップで切り替え。ほかのピッカーの担当商品は 1/3 の速さでしか処理できません。担当の無いピッカーには仕事が来ません' }));
  const auto = el('button', { class: 'btn', type: 'button' }, iconText('sparkles', '担当を自動で割り振る（全ピッカー）', 14));
  auto.addEventListener('click', () => {
    const n = autoAssignItems(w);
    showToast(`${w.stations.filter((s) => s.kind === 'pick').length} か所のピッカーに ${n} 品目を人気度で均等に割り振りました`);
    refresh();
  });
  body.append(el('div', { class: 'settings-row' }, auto));
  const grid = el('div', { class: 'assign-grid' });
  const ids = availableItemIds(w);
  for (const def of ITEMS) {
    if (!ids.includes(def.id)) continue;
    const mine = st.assignedItems.includes(def.id);
    const other = !mine ? w.stations.find((s) => s.kind === 'pick' && s.id !== st.id && s.assignedItems.includes(def.id)) : null;
    const b = el('button', { class: `btn assign-btn${mine ? ' is-active' : ''}`, type: 'button', title: def.name }, iconImg(def.id, 26), el('span', { class: 'small', text: other ? `他(${other.x},${other.z})` : mine ? '担当' : '—' }));
    b.addEventListener('click', () => {
      assignItem(w, st.id, def.id, !mine);
      refresh();
    });
    grid.append(b);
  }
  body.append(grid);
}

/** ポートのパネル: 使用停止／再開、置かれているビン */
export function renderPortPanel(body: HTMLElement, w: WorldState, portId: number, refresh: () => void): void {
  const p = w.ports.find((p) => p.id === portId);
  if (!p) return;
  const inboundBins = p.outbound.filter((id) => w.bins[id]?.purpose === 'inbound').length;
  body.append(el('p', { text: `ポート (${p.x}, ${p.z})　出庫待ち ${p.outbound.length}（ピック ${p.outbound.length - inboundBins} / 入荷 ${inboundBins}） / 返却待ち ${p.returns.length}` }));
  const b = el('button', { class: `btn${p.closed ? ' danger' : ''}`, type: 'button', }, p.closed ? iconText('play', '使用を再開する', 14) : iconText('ban', '使用を停止する', 14));
  b.addEventListener('click', () => {
    p.closed = !p.closed;
    refresh();
  });
  body.append(el('div', { class: 'settings-row' }, b));
  body.append(
    el('p', { class: 'muted small', text: p.closed ? '停止中: 新しいビンは運び込まれません。残っているビンが片付いたら建設モードで移設・撤去できます。' : '停止すると新しいビンを運び込まなくなり、空になれば移設・撤去できます。すべてのポートを停止すると取り出しができません。' }),
  );
}
