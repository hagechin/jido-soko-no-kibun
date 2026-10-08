/** 稼働中ロボ一覧: 動いているロボをタップで捕まえにくいので、ここから選択・強化する */
import { ROBOT } from '../data/balance';
import { describeRobot } from '../sim/robots';
import type { WorldState } from '../sim/types';
import { iconImg } from './icons';
import { el } from './layout';

/** 開いたままでも状態が追いかけるように、状態の文字だけ書き換える（行の作り直しはしない） */
export function refreshRobotListStatus(body: HTMLElement, w: WorldState): void {
  for (const row of body.querySelectorAll<HTMLElement>('.robot-row[data-robot]')) {
    const r = w.robots.find((x) => x.id === Number(row.dataset.robot));
    const st = row.querySelector('.sel-status');
    if (!r || !st) continue;
    const text = describeRobot(w, r);
    if (st.textContent !== text) st.textContent = text;
    const meta = row.querySelector<HTMLElement>('.robot-meta');
    if (meta) {
      const m = `${meta.dataset.lv} / 運んだ ${r.carried ?? 0}${r.job?.manual ? ' / 手動指示中' : ''}`;
      if (meta.textContent !== m) meta.textContent = m;
    }
  }
}

export function renderRobotList(body: HTMLElement, w: WorldState, selectedId: number | null, onSelect: (id: number) => void, onUpgrade: (id: number) => void): void {
  body.append(el('p', { class: 'muted small', text: 'タップで選択（3D ビューで指示できる）。「強化」で選択してアップグレードを開く' }));
  for (const kind of ['shelf', 'amr'] as const) {
    const list = w.robots.filter((r) => r.kind === kind);
    body.append(el('h4', { text: `${kind === 'shelf' ? '棚ロボ' : '搬送ロボ'}（${list.length} 台）` }));
    for (const r of list) {
      const cargo = el('span', { class: 'sel-cargo' });
      for (const id of r.carrying) {
        const b = w.bins[id];
        cargo.append(b?.item ? iconImg(b.item, 18) : el('span', { class: 'slot-empty', title: '空ビン' }));
      }
      const lv = kind === 'shelf' ? `速度 Lv${r.speedLevel} / リフト Lv${r.liftLevel}` : `速度 Lv${r.speedLevel} / 積載 ${ROBOT.cargo[r.cargoLevel].bins}`;
      const row = el(
        'div',
        { class: `robot-row${r.id === selectedId ? ' is-active' : ''}`, 'data-robot': String(r.id) },
        el('button', { class: 'btn robot-pick', type: 'button' }, el('span', { class: 'sel-name' }, el('span', { class: `robot-dot ${kind}${r.variant && r.variant !== 'standard' ? ' ' + r.variant : ''}` }), el('span', { text: ' ' + r.name })), el('span', { class: 'sel-status', text: describeRobot(w, r) }), cargo, el('span', { class: 'muted small robot-meta', 'data-lv': lv, text: `${lv} / 運んだ ${r.carried ?? 0}${r.job?.manual ? ' / 手動指示中' : ''}` })),
        el('button', { class: 'btn', type: 'button', text: '強化' }),
      );
      row.children[0].addEventListener('click', () => onSelect(r.id));
      row.children[1].addEventListener('click', () => onUpgrade(r.id));
      body.append(row);
    }
  }
}
