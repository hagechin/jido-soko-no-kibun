/** オーダーシート（§2.4）: 4×6 のアイコン、経過時間バー、ピック済み、欠品 */
import { ORDERS, REWARD, TICKS_PER_SECOND } from '../data/balance';
import { backpressureFactor, itemInStock, lateLimitTicks, queuedCount, visibleOrders } from '../sim/orders';
import type { Order, WorldState } from '../sim/types';
import { $, el } from './layout';
import { iconImg } from './icons';

interface CardRefs {
  root: HTMLElement;
  bar: HTMLElement;
  time: HTMLElement;
  cells: Map<string, HTMLElement>;
  sig: string;
}

export class OrderSheet {
  private list = $('orders-list');
  private queueBadge = $('orders-queue');
  private cards = new Map<number, CardRefs>();
  private expandedId: number | null = null;
  onItemTap: ((itemId: string, order: Order) => void) | null = null;

  update(w: WorldState): void {
    const visible = visibleOrders(w);
    const ids = new Set(visible.map((o) => o.id));
    for (const [id, c] of this.cards) {
      if (!ids.has(id)) {
        c.root.remove();
        this.cards.delete(id);
        if (this.expandedId === id) this.expandedId = null;
      }
    }
    visible.forEach((o, idx) => {
      const sig = this.signature(w, o);
      let c = this.cards.get(o.id);
      if (!c || c.sig !== sig) {
        const fresh = this.buildCard(w, o, sig);
        if (c) c.root.replaceWith(fresh.root);
        else this.list.append(fresh.root);
        c = fresh;
        this.cards.set(o.id, c);
      }
      // 並び順を保つ
      if (this.list.children[idx] !== c.root) this.list.insertBefore(c.root, this.list.children[idx] ?? null);
      this.updateTime(w, o, c);
      c.root.classList.toggle('is-expanded', this.expandedId === o.id);
    });
    const q = queuedCount(w);
    this.queueBadge.hidden = q === 0;
    const bp = backpressureFactor(w);
    this.queueBadge.textContent = bp > 1 ? `+${q} 受注抑制 ×${bp.toFixed(1)}` : `+${q}`;
    this.queueBadge.title = bp > 1 ? 'キューが長いので、新しいオーダーの到着間隔を伸ばしています' : '';
  }

  private signature(w: WorldState, o: Order): string {
    return o.lines.map((l) => `${l.item}:${l.qty}:${l.picked}:${itemInStock(w, l.item) ? 1 : 0}`).join('|');
  }

  private buildCard(w: WorldState, o: Order, sig: string): CardRefs {
    const bar = el('div', { class: 'order-bar' });
    const time = el('span', { class: 'order-time' });
    const head = el('div', { class: 'order-head' }, el('span', { class: 'order-no', text: `#${o.id}` }), time);
    const grid = el('div', { class: 'order-grid' });
    const cells = new Map<string, HTMLElement>();
    for (const l of o.lines) {
      const done = l.picked >= l.qty;
      const stockout = !done && !itemInStock(w, l.item);
      const cell = el(
        'button',
        { class: `order-cell${done ? ' is-done' : ''}${stockout ? ' is-stockout' : ''}`, type: 'button', 'data-item': l.item },
        iconImg(l.item, 28),
        el('span', { class: 'order-qty', text: `×${l.qty}` }),
        done ? el('span', { class: 'order-check', text: '✓' }) : null,
      );
      cell.addEventListener('click', (e) => {
        e.stopPropagation();
        this.onItemTap?.(l.item, o);
      });
      grid.append(cell);
      cells.set(l.item, cell);
    }
    const root = el('article', { class: 'order-card', 'data-order': o.id }, head, el('div', { class: 'order-bar-wrap' }, bar), grid);
    root.addEventListener('click', () => {
      // スマホ: タップで拡大／縮小
      this.expandedId = this.expandedId === o.id ? null : o.id;
      for (const [id, c] of this.cards) c.root.classList.toggle('is-expanded', this.expandedId === id);
    });
    return { root, bar, time, cells, sig };
  }

  private updateTime(w: WorldState, o: Order, c: CardRefs): void {
    const sec = (w.tick - o.arrivedTick) / TICKS_PER_SECOND;
    const limit = lateLimitTicks(o) / TICKS_PER_SECOND;
    const pct = Math.min(100, (sec / limit) * 100);
    c.bar.style.width = `${pct}%`;
    let cls = 'tier-0';
    const tiers = REWARD.speedBonus;
    if (sec > limit) cls = 'tier-late';
    else if (sec > tiers[2][0]) cls = 'tier-3';
    else if (sec > tiers[1][0]) cls = 'tier-2';
    else if (sec > tiers[0][0]) cls = 'tier-1';
    if (c.bar.dataset.tier !== cls) {
      c.bar.dataset.tier = cls;
      c.bar.className = `order-bar ${cls}`;
    }
    const txt = `${Math.floor(sec)}s`;
    if (c.time.textContent !== txt) c.time.textContent = txt;
  }
}
