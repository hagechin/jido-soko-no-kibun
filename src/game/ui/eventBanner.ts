import { icon } from './icon';
/** イベントバナー（§6.4 予告・開催中）と成績表モーダル */
import { bannerText, isCyberWeek } from '../sim/events';
import type { CyberWeekRecord, WorldState } from '../sim/types';
import { $, el } from './layout';

export class EventBanner {
  private banner = $('banner');
  private last = '';
  private lastCyber = false;

  update(w: WorldState): void {
    const text = bannerText(w) ?? '';
    const cyber = isCyberWeek(w);
    if (text !== this.last) {
      this.last = text;
      this.banner.textContent = text;
      this.banner.hidden = !text;
    }
    if (cyber !== this.lastCyber) {
      this.lastCyber = cyber;
      this.banner.classList.toggle('is-cyber', cyber);
      document.body.classList.toggle('is-cyber', cyber);
    }
  }
}

export class Modal {
  private root = $('modal');
  private title = $('modal-title');
  private body = $('modal-body');
  onClose: (() => void) | null = null;

  constructor() {
    $('modal-close').addEventListener('click', () => this.hide());
    this.root.addEventListener('click', (e) => {
      if (e.target === this.root) this.hide();
    });
  }

  private queue: { title: string; content: Node[] }[] = [];

  /** 表示中なら順番待ちにする（お留守番レポート → ランクアップ の順で見せる） */
  show(title: string, ...content: Node[]): void {
    if (this.visible) {
      this.queue.push({ title, content });
      return;
    }
    this.title.textContent = title;
    this.body.replaceChildren(...content);
    this.root.hidden = false;
    document.body.classList.add('has-modal');
  }

  hide(): void {
    this.root.hidden = true;
    document.body.classList.remove('has-modal');
    this.onClose?.();
    const next = this.queue.shift();
    if (next) this.show(next.title, ...next.content);
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}

/** サイバーウィーク成績表（年ごとの比較つき） */
export function cyberReportNode(record: CyberWeekRecord, history: CyberWeekRecord[]): Node {
  const rows = [...history].sort((a, b) => a.year - b.year);
  const table = el('table', { class: 'report-table' });
  table.append(el('thead', {}, el('tr', {}, el('th', { text: '年' }), el('th', { text: '出荷数' }), el('th', { text: '平均リードタイム' }), el('th', { text: '欠品' }), el('th', { text: 'コイン' }))));
  const tb = el('tbody');
  for (const r of rows) {
    tb.append(
      el('tr', { class: r.year === record.year ? 'is-now' : '' }, el('td', { text: `${r.year}年目` }), el('td', { text: String(r.shipped) }), el('td', { text: `${r.avgLeadSec}s` }), el('td', { text: String(r.stockouts) }), el('td', { text: r.coins.toLocaleString('ja-JP') })),
    );
  }
  table.append(tb);
  const prev = rows.filter((r) => r.year < record.year).pop();
  const comment = !prev
    ? '初めてのサイバーウィークを乗り切りました。来年はもっと混みます。'
    : record.shipped > prev.shipped
      ? `去年より ${record.shipped - prev.shipped} 件多く出荷できました！`
      : '去年より出荷が減りました。段数・ロボ・自動化を見直しましょう。';
  return el('div', {}, el('p', {}, icon('flame', 16), el('span', { text: ' サイバーウィーク終了。お疲れさまでした！' })), table, el('p', { class: 'muted', text: comment }));
}
