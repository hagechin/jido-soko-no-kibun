/** お留守番レポート（§10.2） */
import { itemDef } from '../data/items';
import type { OfflineReport } from '../sim/offline';
import { el } from './layout';

export function offlineReportNode(r: OfflineReport): Node {
  const min = Math.round(r.elapsedMs / 60_000);
  const hours = Math.floor(min / 60);
  const dur = hours ? `${hours}時間${min % 60}分` : `${min}分`;
  const rows = el('ul', { class: 'report-list' });
  rows.append(el('li', { text: `📦 出荷: ${r.shipped} 件` }));
  rows.append(el('li', { text: `🪙 稼いだコイン: ${r.coins.toLocaleString('ja-JP')}` }));
  rows.append(el('li', { text: `🚚 入荷トラック: ${r.trucks} 回` }));
  rows.append(el('li', { text: r.stockouts.length ? `❗ 欠品した商品: ${r.stockouts.map((i) => itemDef(i).name).join('・')}` : '欠品なし' }));
  if (r.events.length) rows.append(el('li', { text: `📅 その間の季節イベント: ${r.events.join('・')}` }));
  const note =
    r.cappedBy === 'cyberWeek'
      ? '⚠️ サイバーウィークの直前で止めました。えらい目に遭う準備はいいですか？'
      : r.cappedBy === 'max'
        ? '留守番は最長 8 時間ぶんまでです。'
        : r.shipped === 0
          ? '自動化が無いと留守中は何も出荷されません（オーダーは溜まるだけ）。'
          : '';
  return el('div', {}, el('p', { text: `お留守番の時間: ${dur}` }), rows, note ? el('p', { class: 'muted', text: note }) : null);
}
