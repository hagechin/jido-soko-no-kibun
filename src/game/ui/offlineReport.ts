import { icon, type IconName } from './icon';
/** お留守番レポート（§10.2） */
import { itemDef } from '../data/items';
import type { OfflineReport } from '../sim/offline';
import { el } from './layout';
import { tr } from '../i18n';

export function offlineReportNode(r: OfflineReport): Node {
  const min = Math.round(r.elapsedMs / 60_000);
  const hours = Math.floor(min / 60);
  const dur = hours ? tr(tr('{0}時間{1}分'), hours, min % 60) : tr(tr('{0}分'), min);
  const rows = el('ul', { class: 'report-list' });
  const li = (name: IconName, text: string) => el('li', {}, icon(name, 16), el('span', { text: ' ' + text }));
  rows.append(li('package', tr(tr('出荷: {0} 件'), r.shipped)));
  rows.append(li('coins', tr(tr('稼いだコイン: {0}'), r.coins.toLocaleString('ja-JP'))));
  rows.append(li('truck', tr(tr('入荷トラック: {0} 回'), r.trucks)));
  rows.append(r.stockouts.length ? li('triangle-alert', tr(tr('欠品した商品: {0}'), r.stockouts.map((i) => itemDef(i).name).join(tr(tr('・'))))) : li('check', tr(tr('欠品なし'))));
  if (r.events.length) rows.append(li('calendar', tr(tr('その間の季節イベント: {0}'), r.events.join(tr(tr('・'))))));
  const note =
    r.cappedBy === 'cyberWeek'
      ? tr(tr('サイバーウィークの直前で止めました。えらい目に遭う準備はいいですか？'))
      : r.cappedBy === 'max'
        ? tr(tr('留守番は最長 8 時間ぶんまでです。'))
        : r.shipped === 0
          ? tr(tr('自動化が無いと留守中は何も出荷されません（オーダーは溜まるだけ）。'))
          : '';
  return el('div', {}, el('p', { text: tr(tr('お留守番の時間: {0}'), dur) }), rows, note ? el('p', { class: 'muted', text: note }) : null);
}
