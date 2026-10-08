/** デバッグ画面（`/?debug` で下部バーに虫アイコンが出る）: コイン、プリセット倉庫、ランク、暦ジャンプ、計測 */
import { CALENDAR, RANKS } from '../data/balance';
import { calendarFromTick } from '../sim/calendar';
import { updateEvents } from '../sim/events';
import { forecastRestock, scheduleTruck } from '../sim/inbound';
import { buildPreset, PRESETS } from '../sim/presets';
import { generateOrder } from '../sim/orders';
import { maxOutRobots } from '../sim/shop';
import { diagnoseIdle } from '../sim/automation';
import type { WorldState } from '../sim/types';
import { el, showToast } from './layout';
import { tr } from '../i18n';

export interface DebugContext {
  world: WorldState;
  loadWorld: (w: WorldState) => void;
  refresh: () => void;
  stats: { simMs: number; fps: number; robots: number };
  showStats: boolean;
  setShowStats: (on: boolean) => void;
  /** ボタンを押すたびに呼ばれる（サンドボックスとして使われた印を付ける） */
  onAction?: () => void;
}

let onAction: (() => void) | undefined;

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { class: `btn ${cls}`, type: 'button', text: label });
  b.addEventListener('click', () => {
    onAction?.();
    onClick();
  });
  return b;
}

/** 暦を指定 tick へ進める（戻すことはしない） */
function jumpTo(w: WorldState, tick: number): void {
  if (tick <= w.tick) return;
  w.tick = tick;
  w.calendar = calendarFromTick(tick);
  w.nextOrderTick = tick + 1;
  for (const o of w.orders) {
    o.arrivedTick = tick;
    o.shownTick = null;
  }
  updateEvents(w);
}

function tickOf(w: WorldState, month: number, week: number): number {
  // 現在の年（または来年）の month/week の先頭 tick
  const c = w.calendar;
  const yearStart = w.tick - (((c.month - CALENDAR.startMonth + 12) % 12) * CALENDAR.ticksPerMonth + (c.week - 1) * CALENDAR.ticksPerWeek + (w.tick % CALENDAR.ticksPerWeek));
  let t = yearStart + (((month - CALENDAR.startMonth + 12) % 12) * CALENDAR.ticksPerMonth + (week - 1) * CALENDAR.ticksPerWeek);
  if (t <= w.tick) t += CALENDAR.ticksPerYear;
  return t;
}

export function renderDebug(body: HTMLElement, ctx: DebugContext): void {
  const w = ctx.world;
  onAction = ctx.onAction;
  body.append(el('p', { class: 'muted small', text: tr('デモ・デバッグ用。ここでの変更もセーブされます。') }));

  body.append(el('h4', { text: tr('コイン') }));
  const coins = el('div', { class: 'settings-row' });
  for (const n of [1000, 10000, 100000]) coins.append(btn(`+${n.toLocaleString('ja-JP')}`, () => { w.coins += n; showToast(tr('+{0} コイン', n)); ctx.refresh(); }));
  coins.append(btn(tr('評判 100'), () => { w.reputation = 100; ctx.refresh(); }));
  body.append(coins);

  body.append(el('h4', { text: tr('プリセット倉庫を読み込む') }));
  for (const p of PRESETS) {
    const row = el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: p.name }), el('div', { class: 'muted small', text: p.desc })), btn(tr('読み込む'), () => {
      if (!confirm(tr('{0} を読み込みます。今の倉庫は消えます。よろしいですか？', p.name))) return;
      ctx.loadWorld(buildPreset(p.id, { seed: Date.now() >>> 0 }));
      showToast(tr('{0} を読み込みました', p.name));
    }));
    body.append(row);
  }

  body.append(el('h4', { text: tr('ランク・自動化') }));
  const rankRow = el('div', { class: 'settings-row' });
  RANKS.forEach((r, i) => rankRow.append(btn(`${i + 1}: ${r.name}`, () => { w.rank = i; w.stats.totalShipped = Math.max(w.stats.totalShipped, r.shipped); showToast(tr('ランク: {0}', r.name)); ctx.refresh(); }, w.rank === i ? 'is-active' : '')));
  body.append(rankRow);
  body.append(el('div', { class: 'settings-row' }, btn(tr('全 AI を有効化'), () => { w.automation.dispatch = 3; w.automation.restock = true; w.automation.relocate = true; showToast(tr('自動化AI をすべて有効にしました')); ctx.refresh(); }), btn(tr('AI をすべて無効化'), () => { w.automation.dispatch = 0; w.automation.restock = false; w.automation.relocate = false; ctx.refresh(); })));

  body.append(el('h4', { text: tr('ロボ') }));
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr('ロボ MAX（全ロボの速度・リフト・積載量を最大に）'), () => {
        const r = maxOutRobots(w);
        showToast(r.skipped ? tr('{0} 台を MAX にしました（{1} 台は周りに床が無くて積載量だけ見送り）', r.upgraded, r.skipped) : tr('{0} 台を MAX にしました', r.upgraded));
        ctx.refresh();
      }),
      el('span', { class: 'muted small', text: tr('棚ロボ {0} 台 / 搬送ロボ {1} 台', w.robots.filter((r) => r.kind === 'shelf').length, w.robots.filter((r) => r.kind === 'amr').length) }),
    ),
  );

  body.append(el('h4', { text: tr('時間・イベント') }));
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr('+1 週'), () => { jumpTo(w, w.tick + CALENDAR.ticksPerWeek); ctx.refresh(); }),
      btn(tr('+1 か月'), () => { jumpTo(w, w.tick + CALENDAR.ticksPerMonth); ctx.refresh(); }),
      btn(tr('サイバーウィーク予告（11月1週）へ'), () => { jumpTo(w, tickOf(w, 11, 1)); ctx.refresh(); }),
      btn(tr('サイバーウィーク本番（11月4週）へ'), () => { jumpTo(w, tickOf(w, 11, 4)); ctx.refresh(); }),
    ),
  );
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr('入荷トラックを呼ぶ'), () => { scheduleTruck(w, forecastRestock(w, true), 'weekly', 1); showToast(tr('トラックを手配しました')); }),
      btn(tr('オーダーを 5 件追加'), () => { for (let i = 0; i < 5; i++) w.orders.push(generateOrder(w)); ctx.refresh(); }),
      btn(tr('オーダーを全部消す'), () => { w.orders = []; ctx.refresh(); }),
    ),
  );

  body.append(el('h4', { text: tr('停滞診断') }));
  const diag = el('pre', { class: 'muted small', style: 'white-space: pre-wrap; margin: 0;' });
  const runDiag = () => { diag.textContent = diagnoseIdle(w).join('\n'); };
  body.append(el('div', { class: 'settings-row' }, btn(tr('いま誰も動かない理由を調べる'), runDiag)), diag);

  body.append(el('h4', { text: tr('計測') }));
  const st = ctx.stats;
  body.append(el('div', { class: 'settings-row' }, btn(ctx.showStats ? tr('計測表示: オン') : tr('計測表示: オフ'), () => { ctx.setShowStats(!ctx.showStats); ctx.refresh(); }, ctx.showStats ? 'is-active' : ''), el('span', { class: 'muted small', text: tr('描画 {0} fps / シミュレーション {1} ms/tick / ロボ {2} 台 / {3}×{4} / スタック {5} / ビン {6}', st.fps.toFixed(0), st.simMs.toFixed(2), st.robots, w.width, w.height, w.stacks.length, Object.keys(w.bins).length) })));
}
