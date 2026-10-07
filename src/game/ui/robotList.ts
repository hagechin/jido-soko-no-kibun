/** 稼働中ロボ一覧: 動いているロボをタップで捕まえにくいので、ここから選択・強化する */
import { ROBOT } from '../data/balance';
import { describeRobot } from '../sim/robots';
import type { WorldState } from '../sim/types';
import { iconImg } from './icons';
import { el } from './layout';

export function renderRobotList(body: HTMLElement, w: WorldState, selectedId: number | null, onSelect: (id: number) => void, onUpgrade: (id: number) => void): void {
  body.append(el('p', { class: 'muted small', text: 'タップで選択（3D ビューで指示できる）。「強化」で選択してアップグレードを開く' }));
  for (const kind of ['shelf', 'amr'] as const) {
    const list = w.robots.filter((r) => r.kind === kind);
    body.append(el('h4', { text: `${kind === 'shelf' ? '棚ロボ' : '搬送ロボ'}（${list.length} 台）` }));
    for (const r of list) {
      const cargo = el('span', { class: 'sel-cargo' });
      for (const id of r.carrying) {
        const b = w.bins[id];
        cargo.append(b?.item ? iconImg(b.item, 18) : el('span', { text: '▫' }));
      }
      const lv = kind === 'shelf' ? `速度 Lv${r.speedLevel} / リフト Lv${r.liftLevel}` : `速度 Lv${r.speedLevel} / 積載 ${ROBOT.cargo[r.cargoLevel].bins}`;
      const row = el(
        'div',
        { class: `robot-row${r.id === selectedId ? ' is-active' : ''}` },
        el('button', { class: 'btn robot-pick', type: 'button' }, el('span', { class: 'sel-name', text: `${kind === 'shelf' ? '🟥' : '🟦'} ${r.name}` }), el('span', { class: 'sel-status', text: describeRobot(w, r) }), cargo, el('span', { class: 'muted small', text: `${lv}${r.job?.manual ? ' / 手動指示中' : ''}` })),
        el('button', { class: 'btn', type: 'button', text: '強化' }),
      );
      row.children[0].addEventListener('click', () => onSelect(r.id));
      row.children[1].addEventListener('click', () => onUpgrade(r.id));
      body.append(row);
    }
  }
}
