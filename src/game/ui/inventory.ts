/** 在庫パネル（§3.1）: 商品ごとの在庫数・ビン数・置き場所・入荷口の滞留 */
import { itemDef } from '../data/items';
import { dockBacklog, emptyBinCount, stockSummary } from '../sim/inbound';
import type { WorldState } from '../sim/types';
import { iconImg } from './icons';
import { el } from './layout';
import { tr } from '../i18n';

export function renderInventory(body: HTMLElement, w: WorldState, onItemTap: (item: string) => void): void {
  const backlog = dockBacklog(w);
  body.append(
    el('div', { class: 'inv-summary' }, el('span', { text: tr(tr('空ビン {0}'), emptyBinCount(w)) }), el('span', { text: tr(tr('ビン容量 {0}'), w.binCapacity) }), el('span', { class: backlog ? 'warn' : '', text: tr(tr('入荷口の滞留 {0} 個'), backlog) })),
  );
  const table = el('div', { class: 'inv-table' });
  for (const s of stockSummary(w)) {
    const def = itemDef(s.item);
    const stockout = s.qty <= 0;
    const row = el(
      'button',
      { class: `inv-row${stockout ? ' is-stockout' : ''}`, type: 'button' },
      iconImg(s.item, 24),
      el('span', { class: 'inv-name', text: def.name }),
      el('span', { class: 'inv-qty', text: stockout ? tr(tr('欠品')) : tr(tr('{0} 個 / {1} ビン'), s.qty, s.bins) }),
      el('span', { class: 'inv-dock muted', text: s.dock ? tr(tr('入荷待ち {0}'), s.dock) : '' }),
      el('span', { class: 'inv-loc muted', text: s.locations.slice(0, 3).join('、') + (s.locations.length > 3 ? ' …' : '') }),
    );
    row.addEventListener('click', () => onItemTap(s.item));
    table.append(row);
  }
  body.append(table);
  if (w.pallets.length) {
    body.append(el('h4', { text: tr(tr('入荷口（トラックが置いていった山）')) }));
    const list = el('div', { class: 'pallet-list' });
    for (const p of w.pallets) list.append(el('span', { class: 'pallet' }, iconImg(p.item, 20), el('span', { text: `×${p.qty}` })));
    body.append(list);
    body.append(el('p', { class: 'muted small', text: tr(tr('棚ロボで空ビン（または同じ商品のビン）を取り出し、搬送ロボを入荷ステーションへ向かわせると詰め込まれます。')) }));
  }
}
