/** デバッグ画面（`/?debug` で下部バーに虫アイコンが出る）: コイン、プリセット倉庫、ランク、暦ジャンプ、計測 */
import { CALENDAR, RANKS } from '../data/balance';
import { rankShippedAt } from '../sim/pricing';
import { calendarFromTick } from '../sim/calendar';
import { updateEvents } from '../sim/events';
import { addPallet, forecastRestock, scheduleTruck } from '../sim/inbound';
import { itemDef } from '../data/items';
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
  const wasCyber = w.season.active.includes('cyberWeek');
  w.tick = tick;
  w.calendar = calendarFromTick(tick);
  w.nextOrderTick = tick + 1;
  for (const o of w.orders) {
    o.arrivedTick = tick;
    o.shownTick = null;
  }
  updateEvents(w);
  // ジャンプで飛ばした期間はシミュレーションしていないので、サイバーウィークの成績表は飛ばした分が 0 になる
  if (wasCyber && !w.season.active.includes('cyberWeek')) showToast(tr(tr('ジャンプでサイバーウィークを抜けました。飛ばした期間は成績表に数えられません（0 になります）')), 5000);
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
  body.append(el('p', { class: 'muted small', text: tr(tr('デモ・デバッグ用。ここでの変更もセーブされます。')) }));

  body.append(el('h4', { text: tr(tr('コイン')) }));
  const coins = el('div', { class: 'settings-row' });
  for (const n of [1000, 10000, 100000]) coins.append(btn(`+${n.toLocaleString('ja-JP')}`, () => { w.coins += n; showToast(tr(tr('+{0} コイン'), n)); ctx.refresh(); }));
  coins.append(btn(tr(tr('評判 100')), () => { w.reputation = 100; ctx.refresh(); }));
  body.append(coins);

  body.append(el('h4', { text: tr(tr('プリセット倉庫を読み込む')) }));
  for (const p of PRESETS) {
    const row = el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: p.name }), el('div', { class: 'muted small', text: p.desc })), btn(tr(tr('読み込む')), () => {
      if (!confirm(tr(tr('{0} を読み込みます。今の倉庫は消えます。よろしいですか？'), p.name))) return;
      ctx.loadWorld(buildPreset(p.id, { seed: Date.now() >>> 0 }));
      showToast(tr(tr('{0} を読み込みました'), p.name));
    }));
    body.append(row);
  }

  body.append(el('h4', { text: tr(tr('ランク・自動化')) }));
  const rankRow = el('div', { class: 'settings-row' });
  RANKS.forEach((r, i) => rankRow.append(btn(`${i + 1}: ${r.name}`, () => { w.rank = i; w.stats.totalShipped = Math.max(w.stats.totalShipped, rankShippedAt(w, i)); showToast(tr(tr('ランク: {0}'), r.name)); ctx.refresh(); }, w.rank === i ? 'is-active' : '')));
  body.append(rankRow);
  body.append(el('div', { class: 'settings-row' }, btn(tr(tr('全 AI を有効化')), () => { w.automation.dispatch = 3; w.automation.restock = true; w.automation.relocate = true; showToast(tr(tr('自動化AI をすべて有効にしました'))); ctx.refresh(); }), btn(tr(tr('AI をすべて無効化')), () => { w.automation.dispatch = 0; w.automation.restock = false; w.automation.relocate = false; ctx.refresh(); })));

  body.append(el('h4', { text: tr(tr('ロボ')) }));
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr(tr('ロボ MAX（全ロボの速度・リフト・積載量を最大に）')), () => {
        const r = maxOutRobots(w);
        showToast(r.skipped ? tr(tr('{0} 台を MAX にしました（{1} 台は周りに床が無くて積載量だけ見送り）'), r.upgraded, r.skipped) : tr(tr('{0} 台を MAX にしました'), r.upgraded));
        ctx.refresh();
      }),
      el('span', { class: 'muted small', text: tr(tr('棚ロボ {0} 台 / 搬送ロボ {1} 台'), w.robots.filter((r) => r.kind === 'shelf').length, w.robots.filter((r) => r.kind === 'amr').length) }),
    ),
  );

  body.append(el('h4', { text: tr(tr('時間・イベント')) }));
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr(tr('+1 週')), () => { jumpTo(w, w.tick + CALENDAR.ticksPerWeek); ctx.refresh(); }),
      btn(tr(tr('+1 か月')), () => { jumpTo(w, w.tick + CALENDAR.ticksPerMonth); ctx.refresh(); }),
      btn(tr(tr('サイバーウィーク予告（11月1週）へ')), () => { jumpTo(w, tickOf(w, 11, 1)); ctx.refresh(); }),
      btn(tr(tr('サイバーウィーク本番（11月4週）へ')), () => { jumpTo(w, tickOf(w, 11, 4)); ctx.refresh(); }),
    ),
  );
  body.append(
    el('div', { class: 'settings-row' },
      btn(tr(tr('入荷トラックを呼ぶ')), () => { scheduleTruck(w, forecastRestock(w, true), 'weekly', 1); showToast(tr(tr('トラックを手配しました'))); }),
      btn(tr(tr('オーダーを 5 件追加')), () => { for (let i = 0; i < 5; i++) w.orders.push(generateOrder(w)); ctx.refresh(); }),
      btn(tr(tr('空ビンを使い切る')), () => {
        // 空ビンを全部「他の商品が半分入ったビン」にする（ビンの統合の確認用: M40。「欠品を作る」のあとに押す）
        const counts = new Map<string, number>();
        for (const b of Object.values(w.bins)) if (b.item) counts.set(b.item, (counts.get(b.item) ?? 0) + 1);
        const item = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!item) return showToast(tr(tr('商品の入ったビンがありません')));
        let n = 0;
        for (const b of Object.values(w.bins)) if (b.item === null) { b.item = item; b.qty = Math.floor(w.binCapacity / 2) - 1; n++; }
        showToast(n ? tr(tr('空ビン {0} 個を {1} が半分入ったビンにしました'), n, itemDef(item).name) : tr(tr('空ビンはありません')));
        ctx.refresh();
      }),
      btn(tr(tr('欠品を作る')), () => {
        // 在庫が一番多い商品を選び、棚のビンを全部空ビンにして、その商品の山を入荷口に積む（補充 AI の確認用: M35）
        const stock = new Map<string, number>();
        for (const b of Object.values(w.bins)) if (b.item) stock.set(b.item, (stock.get(b.item) ?? 0) + b.qty);
        const item = [...stock.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];
        if (!item) return showToast(tr(tr('在庫のある商品がありません')));
        let bins = 0;
        for (const b of Object.values(w.bins)) if (b.item === item) { b.item = null; b.qty = 0; b.purpose = null; bins++; }
        addPallet(w, item, w.binCapacity * 2);
        w.orders.unshift({ id: w.nextIds.order++, lines: [{ item, qty: 2, picked: 0 }], arrivedTick: w.tick, shownTick: null, penalized: false });
        showToast(tr(tr('{0} を欠品にしました（ビン {1} 個を空に、入荷口に {2} 個、オーダー 1 件）'), itemDef(item).name, bins, w.binCapacity * 2));
        ctx.refresh();
      }),
      btn(tr(tr('オーダーを全部消す')), () => { w.orders = []; ctx.refresh(); }),
    ),
  );

  body.append(el('h4', { text: tr(tr('停滞診断')) }));
  const diag = el('pre', { class: 'muted small', style: 'white-space: pre-wrap; margin: 0;' });
  const runDiag = () => { diag.textContent = diagnoseIdle(w).join('\n'); };
  body.append(el('div', { class: 'settings-row' }, btn(tr(tr('いま誰も動かない理由を調べる')), runDiag)), diag);

  body.append(el('h4', { text: tr(tr('計測')) }));
  const st = ctx.stats;
  body.append(el('div', { class: 'settings-row' }, btn(ctx.showStats ? tr(tr('計測表示: オン')) : tr(tr('計測表示: オフ')), () => { ctx.setShowStats(!ctx.showStats); ctx.refresh(); }, ctx.showStats ? 'is-active' : ''), el('span', { class: 'muted small', text: tr(tr('描画 {0} fps / シミュレーション {1} ms/tick / ロボ {2} 台 / {3}×{4} / スタック {5} / ビン {6}'), st.fps.toFixed(0), st.simMs.toFixed(2), st.robots, w.width, w.height, w.stacks.length, Object.keys(w.bins).length) })));
}
