/** 稼働中ロボ一覧: 動いているロボをタップで捕まえにくいので、ここから選択・強化する */
import { ROBOT } from '../data/balance';
import { robotMaxed } from '../sim/shop';
import { isDrone, speedLevelOf } from '../sim/layers';
import { describeRobot } from '../sim/robots';
import type { WorldState } from '../sim/types';
import { iconImg } from './icons';
import { el } from './layout';
import { tr } from '../i18n';

/** 開いたままでも状態が追いかけるように、状態の文字だけ書き換える（行の作り直しはしない） */
export function refreshRobotListStatus(body: HTMLElement, w: WorldState): void {
  for (const row of body.querySelectorAll<HTMLElement>('.robot-row[data-robot]')) {
    const r = w.robots.find((x) => x.id === Number(row.dataset.robot));
    const st = row.querySelector('.sel-status');
    if (!r || !st) continue;
    const text = describeRobot(w, r);
    if (st.textContent !== text) st.textContent = text;
    const cargo = row.querySelector<HTMLElement>('.sel-cargo');
    if (cargo && cargo.dataset.bins !== r.carrying.join(',')) {
      cargo.dataset.bins = r.carrying.join(',');
      cargo.replaceChildren(...cargoIcons(w, r));
    }
    const meta = row.querySelector<HTMLElement>('.robot-meta');
    if (meta) {
      const m = tr('{0} / 運んだ {1}{2}', meta.dataset.lv ?? '', r.carried ?? 0, r.job?.manual ? tr(' / 手動指示中') : '');
      if (meta.textContent !== m) meta.textContent = m;
    }
  }
}

function cargoIcons(w: WorldState, r: WorldState['robots'][number]): HTMLElement[] {
  return r.carrying.map((id) => {
    const b = w.bins[id];
    return b?.item ? iconImg(b.item, 18) : el('span', { class: 'slot-empty', title: tr('空ビン') });
  });
}

/** 速度 Lv の表示。ドローンは飛行の上乗せを含めた実効 Lv も */
export function speedText(r: WorldState['robots'][number]): string {
  return isDrone(r) ? tr('速度 Lv{0}（飛行 +1 → Lv{1} 相当）', r.speedLevel, speedLevelOf(r)) : tr('速度 Lv{0}', r.speedLevel);
}

export function renderRobotList(body: HTMLElement, w: WorldState, selectedId: number | null, onSelect: (id: number) => void, onUpgrade: (id: number) => void): void {
  body.append(el('p', { class: 'muted small', text: tr('タップで選択（3D ビューで指示できる）。「強化」で選択してアップグレードを開く') }));
  for (const kind of ['shelf', 'amr'] as const) {
    const list = w.robots.filter((r) => r.kind === kind);
    body.append(el('h4', { text: tr('{0}（{1} 台）', kind === 'shelf' ? tr('棚ロボ') : tr('搬送ロボ'), list.length) }));
    for (const r of list) {
      const cargo = el('span', { class: 'sel-cargo', 'data-bins': r.carrying.join(',') }, ...cargoIcons(w, r));
      const lv = kind === 'shelf' ? tr('{0} / リフト Lv{1}', speedText(r), r.liftLevel) : tr('{0} / 積載 {1}', speedText(r), ROBOT.cargo[r.cargoLevel].bins);
      const row = el(
        'div',
        { class: `robot-row${r.id === selectedId ? ' is-active' : ''}`, 'data-robot': String(r.id) },
        el('button', { class: 'btn robot-pick', type: 'button' }, el('span', { class: 'sel-name' }, el('span', { class: `robot-dot ${kind}${r.variant && r.variant !== 'standard' ? ' ' + r.variant : ''}` }), el('span', { text: ' ' + r.name })), el('span', { class: 'sel-status', text: describeRobot(w, r) }), cargo, el('span', { class: 'muted small robot-meta', 'data-lv': lv, text: tr('{0} / 運んだ {1}{2}', lv, r.carried ?? 0, r.job?.manual ? tr(' / 手動指示中') : '') })),
        el('button', { class: 'btn', type: 'button', text: robotMaxed(w, r) ? 'MAX' : tr('強化'), ...(robotMaxed(w, r) ? { disabled: 'true', title: tr('速度・リフト・積載とも最大です') } : {}) }),
      );
      row.children[0].addEventListener('click', () => onSelect(r.id));
      if (!robotMaxed(w, r)) row.children[1].addEventListener('click', () => onUpgrade(r.id));
      body.append(row);
    }
  }
}
