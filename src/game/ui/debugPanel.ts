/** デバッグ画面（`/?debug` で下部バーに 🐞 が出る）: コイン、プリセット倉庫、ランク、暦ジャンプ、計測 */
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

export interface DebugContext {
  world: WorldState;
  loadWorld: (w: WorldState) => void;
  refresh: () => void;
  stats: { simMs: number; fps: number; robots: number };
  showStats: boolean;
  setShowStats: (on: boolean) => void;
}

function btn(label: string, onClick: () => void, cls = ''): HTMLButtonElement {
  const b = el('button', { class: `btn ${cls}`, type: 'button', text: label });
  b.addEventListener('click', onClick);
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
  body.append(el('p', { class: 'muted small', text: 'デモ・デバッグ用。ここでの変更もセーブされます。' }));

  body.append(el('h4', { text: 'コイン' }));
  const coins = el('div', { class: 'settings-row' });
  for (const n of [1000, 10000, 100000]) coins.append(btn(`+${n.toLocaleString('ja-JP')}`, () => { w.coins += n; showToast(`+${n} コイン`); ctx.refresh(); }));
  coins.append(btn('評判 100', () => { w.reputation = 100; ctx.refresh(); }));
  body.append(coins);

  body.append(el('h4', { text: 'プリセット倉庫を読み込む' }));
  for (const p of PRESETS) {
    const row = el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: p.name }), el('div', { class: 'muted small', text: p.desc })), btn('読み込む', () => {
      if (!confirm(`${p.name} を読み込みます。今の倉庫は消えます。よろしいですか？`)) return;
      ctx.loadWorld(buildPreset(p.id, { seed: Date.now() >>> 0 }));
      showToast(`${p.name} を読み込みました`);
    }));
    body.append(row);
  }

  body.append(el('h4', { text: 'ランク・自動化' }));
  const rankRow = el('div', { class: 'settings-row' });
  RANKS.forEach((r, i) => rankRow.append(btn(`${i + 1}: ${r.name}`, () => { w.rank = i; w.stats.totalShipped = Math.max(w.stats.totalShipped, r.shipped); showToast(`ランク: ${r.name}`); ctx.refresh(); }, w.rank === i ? 'is-active' : '')));
  body.append(rankRow);
  body.append(el('div', { class: 'settings-row' }, btn('全 AI を有効化', () => { w.automation.dispatch = 3; w.automation.restock = true; w.automation.relocate = true; showToast('自動化AI をすべて有効にしました'); ctx.refresh(); }), btn('AI をすべて無効化', () => { w.automation.dispatch = 0; w.automation.restock = false; w.automation.relocate = false; ctx.refresh(); })));

  body.append(el('h4', { text: 'ロボ' }));
  body.append(
    el('div', { class: 'settings-row' },
      btn('ロボ MAX（全ロボの速度・リフト・積載量を最大に）', () => {
        const r = maxOutRobots(w);
        showToast(r.skipped ? `${r.upgraded} 台を MAX にしました（${r.skipped} 台は周りに床が無くて積載量だけ見送り）` : `${r.upgraded} 台を MAX にしました`);
        ctx.refresh();
      }),
      el('span', { class: 'muted small', text: `棚ロボ ${w.robots.filter((r) => r.kind === 'shelf').length} 台 / 搬送ロボ ${w.robots.filter((r) => r.kind === 'amr').length} 台` }),
    ),
  );

  body.append(el('h4', { text: '時間・イベント' }));
  body.append(
    el('div', { class: 'settings-row' },
      btn('+1 週', () => { jumpTo(w, w.tick + CALENDAR.ticksPerWeek); ctx.refresh(); }),
      btn('+1 か月', () => { jumpTo(w, w.tick + CALENDAR.ticksPerMonth); ctx.refresh(); }),
      btn('サイバーウィーク予告（11月1週）へ', () => { jumpTo(w, tickOf(w, 11, 1)); ctx.refresh(); }),
      btn('サイバーウィーク本番（11月4週）へ', () => { jumpTo(w, tickOf(w, 11, 4)); ctx.refresh(); }),
    ),
  );
  body.append(
    el('div', { class: 'settings-row' },
      btn('入荷トラックを呼ぶ', () => { scheduleTruck(w, forecastRestock(w, true), 'weekly', 1); showToast('トラックを手配しました'); }),
      btn('オーダーを 5 件追加', () => { for (let i = 0; i < 5; i++) w.orders.push(generateOrder(w)); ctx.refresh(); }),
      btn('オーダーを全部消す', () => { w.orders = []; ctx.refresh(); }),
    ),
  );

  body.append(el('h4', { text: '停滞診断' }));
  const diag = el('pre', { class: 'muted small', style: 'white-space: pre-wrap; margin: 0;' });
  const runDiag = () => { diag.textContent = diagnoseIdle(w).join('\n'); };
  body.append(el('div', { class: 'settings-row' }, btn('いま誰も動かない理由を調べる', runDiag)), diag);

  body.append(el('h4', { text: '計測' }));
  const st = ctx.stats;
  body.append(el('div', { class: 'settings-row' }, btn(ctx.showStats ? '計測表示: オン' : '計測表示: オフ', () => { ctx.setShowStats(!ctx.showStats); ctx.refresh(); }, ctx.showStats ? 'is-active' : ''), el('span', { class: 'muted small', text: `描画 ${st.fps.toFixed(0)} fps / シミュレーション ${st.simMs.toFixed(2)} ms/tick / ロボ ${st.robots} 台 / ${w.width}×${w.height} / スタック ${w.stacks.length} / ビン ${Object.keys(w.bins).length}` })));
}
