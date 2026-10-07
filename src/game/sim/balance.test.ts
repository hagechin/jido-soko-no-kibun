/**
 * バランスの回帰テスト（★）: 真面目な人間の遊び方を模した自動プレイヤーで 1 年（72 分）遊び、
 *  - 完全自動化（配車 Lv3 + 補充 + 再配置）に 1 年未満で到達すること
 *  - 収入が序盤から伸び続けること（クッキークリッカー的なインフレ）
 * を確かめる。数値を変えたらここが指標になる。
 */
import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepSim } from './sim';
import { commandFetch, commandRetrieve } from './commands';
import { buyAmr, buyAutomation, buyEmptyBin, buyShelfRobot, freeBinSlots, reservedSlots, upgradeLevels, upgradePicker, upgradeSpeed, upgradeLift, upgradeCargo, upgradeBinCapacity } from './shop';
import { expand, place } from './build';
import { visibleOrders, availableItemIds } from './orders';
import { CALENDAR, RANKS } from '../data/balance';
import type { WorldState } from './types';

function manualPlay(w: WorldState, rt: ReturnType<typeof createRuntime>): void {
  const a = w.automation;
  if (a.dispatch < 2) {
    // 棚ロボ: 表示中オーダーの在庫ありの行を取りに行かせる
    const inFlight = new Set<number>();
    for (const r of w.robots) { for (const id of r.carrying) inFlight.add(id); for (const j of [r.job, ...r.queue]) if (j?.type === 'retrieve') inFlight.add(j.binId); }
    for (const p of w.ports) { p.outbound.forEach((id) => inFlight.add(id)); p.returns.forEach((id) => inFlight.add(id)); }
    const wanted = new Set<string>();
    for (const o of visibleOrders(w)) for (const l of o.lines) if (l.picked < l.qty) wanted.add(l.item);
    for (const item of wanted) {
      const have = [...inFlight].some((id) => w.bins[id]?.item === item && w.bins[id].purpose !== 'inbound');
      if (have) continue;
      const robot = w.robots.find((r) => r.kind === 'shelf' && !r.job && !r.queue.length);
      if (!robot) break;
      for (const s of w.stacks) {
        const id = s.bins.find((id) => w.bins[id].item === item && w.bins[id].qty > 0 && !inFlight.has(id));
        if (id !== undefined) { commandRetrieve(w, rt, robot.id, s.id, id); inFlight.add(id); break; }
      }
    }
  }
  // 手動補充: 入荷口に山があり、入荷行きのビンが無ければ空ビン（または同じ商品の空きのあるビン）を取りに行かせる
  if (!a.restock && w.pallets.length) {
    const inboundInFlight = w.robots.some((r) => r.carrying.some((id) => w.bins[id].purpose === 'inbound') || [r.job, ...r.queue].some((j) => j?.type === 'retrieve' && (w.bins[j.binId].item === null || w.bins[j.binId].purpose === 'inbound'))) || w.ports.some((p) => p.outbound.some((id) => w.bins[id].purpose === 'inbound'));
    const robot = w.robots.find((r) => r.kind === 'shelf' && !r.job && !r.queue.length);
    if (!inboundInFlight && robot) {
      const palletItems = new Set(w.pallets.map((p) => p.item));
      outer: for (const s of w.stacks) {
        for (const id of [...s.bins].reverse()) {
          const b = w.bins[id];
          if (b.item === null || (palletItems.has(b.item) && b.qty < w.binCapacity / 2)) { commandRetrieve(w, rt, robot.id, s.id, id); break outer; }
        }
      }
    }
  }
  if (a.dispatch < 1) {
    for (const p of w.ports) {
      if (!p.outbound.length) continue;
      const robot = w.robots.find((r) => r.kind === 'amr' && !r.job && !r.queue.length);
      if (robot) commandFetch(w, rt, robot.id, p.id);
    }
  }
}

/** 買い物: 自動化 → 掘り出し余裕（段数・スタック）→ ロボ → ビン → 速度 */
function shop(w: WorldState, log: (s: string) => void): void {
  const a = w.automation;
  const kinds = availableItemIds(w).length;
  const bins = Object.keys(w.bins).length;
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  const amrs = w.robots.filter((r) => r.kind === 'amr').length;
  const tryBuy = (label: string, f: () => { ok: boolean; reason?: string }) => { const r = f(); if (r.ok) log(label); return r.ok; };
  // 1. 自動化（買えるものがあれば買う。解放済みで「コインが足りない」だけなら貯金する＝安い必需品以外は買わない）
  let saving = false;
  const want = (label: string, f: () => { ok: boolean; reason?: string }) => {
    if (saving) return false;
    const r = f();
    if (r.ok) { log(label); return true; }
    if (r.reason?.includes('コイン')) saving = true;
    return false;
  };
  if (a.dispatch < 1 && want('dispatch1', () => buyAutomation(w, 'dispatch'))) return;
  if (a.dispatch < 2 && want('dispatch2', () => buyAutomation(w, 'dispatch'))) return;
  if (!a.restock && want('restock', () => buyAutomation(w, 'restock'))) return;
  if (a.dispatch < 3 && want('dispatch3', () => buyAutomation(w, 'dispatch'))) return;
  if (!a.relocate && want('relocate', () => buyAutomation(w, 'relocate'))) return;
  const empties = Object.values(w.bins).filter((b) => !b.item).length;
  const needBins = bins < kinds + 2 || (w.pallets.length > 0 && empties === 0);
  if (saving) {
    // 貯金中でも、空ビンが無くて入荷口に山があるなら空ビンだけは買う（欠品で止まるため）。棚に空きが無ければ段数
    if (needBins) {
      if (freeBinSlots(w) > reservedSlots(w)) tryBuy('bin', () => buyEmptyBin(w));
      else if (w.coins >= 200) tryBuy('levels', () => upgradeLevels(w)) || (placeStack(w) && (log('stack'), true));
    }
    return;
  }
  // 2. ランク条件の面積
  const next = RANKS[w.rank + 1];
  if (next && w.width * w.height < next.area && tryBuy('expand', () => expand(w, 'east'))) return;
  // 3. ビンが商品種類より少ない → ビン（空きが無ければスタック / 段数）
  if (needBins) {
    if (freeBinSlots(w) > reservedSlots(w)) { if (tryBuy('bin', () => buyEmptyBin(w))) return; }
    else if (tryBuy('levels', () => upgradeLevels(w))) return;
    else if (placeStack(w)) { log('stack'); return; }
  }
  // 4. ポート・ピッカー: 棚ロボ 3 台ごとにポート 1 つ、搬送ロボ 4 台ごとにピッカー 1 つ
  if (w.ports.length < Math.floor(shelves / 2) && placePort(w)) { log('port'); return; }
  if (w.stations.filter((s) => s.kind === 'pick').length < 2 + Math.floor(amrs / 4) && placePicker(w)) { log('picker-station'); return; }
  // 5. ロボ（ランクで上限アップ）
  const cap = 2 + w.rank * 3;
  if (shelves < cap && shelves <= amrs && tryBuy('shelf', () => buyShelfRobot(w))) return;
  if (amrs < cap && tryBuy('amr', () => buyAmr(w))) return;
  // 5. 速度・リフト・積載・ピッカー
  for (const r of w.robots) if (tryBuy('speed', () => upgradeSpeed(w, r.id))) return;
  for (const r of w.robots) if (r.kind === 'shelf' && tryBuy('lift', () => upgradeLift(w, r.id))) return;
  for (const s of w.stations) if (s.kind === 'pick' && tryBuy('picker', () => upgradePicker(w, s.id))) return;
  for (const r of w.robots) if (r.kind === 'amr' && tryBuy('cargo', () => upgradeCargo(w, r.id))) return;
  if (tryBuy('bincap', () => upgradeBinCapacity(w))) return;
  if (tryBuy('levels', () => upgradeLevels(w))) return;
}

function placePort(w: WorldState): boolean {
  // 棚ブロック（z 2..4）の上下（z=1 / z=5）で、スタックに隣接し床に面するマス
  for (const z of [1, 5]) for (let x = 3; x < w.width - 2; x++) {
    if (w.ports.some((p) => Math.abs(p.x - x) <= 1 && p.z === z)) continue;
    const r = place(w, 'port', x, z);
    if (r.ok) return true;
  }
  return false;
}
function placePicker(w: WorldState): boolean {
  for (const z of [2, 5, 8]) for (let x = w.width - 6; x < w.width - 1; x++) {
    if (w.stations.some((s) => Math.abs(s.x - x) + Math.abs(s.z - z) <= 1)) continue;
    const r = place(w, 'pickStation', x, z);
    if (r.ok) return true;
  }
  return false;
}

function placeStack(w: WorldState): boolean {
  // 既存の棚ブロック（z 2..4）を東へ 1 列ずつ伸ばす。ポートの列（x=7）は z=3 を飛ばす
  for (let x = 7; x < w.width - 6; x++) {
    for (const z of [2, 4, 3]) {
      if (w.cells[z * w.width + x] !== 'floor') continue;
      if (w.ports.some((p) => p.x === x && p.z === z)) continue;
      const r = place(w, 'stack', x, z);
      if (r.ok) return true;
    }
  }
  return false;
}

interface RunResult { fullAt: number; earnedPer10: number[]; shipped: number; rep: number; queue: number; log: string[] }

/** 自動プレイヤーで ticks ぶん遊ぶ */
function run(difficulty: WorldState['difficulty'], ticks: number): RunResult {
  const w = createWorld({ seed: 42 });
  w.difficulty = difficulty;
  const rt = createRuntime();
  const events: string[] = [];
  const log = (s: string) => events.push(`${(w.tick / 600).toFixed(1)}min ${s} (coins ${w.coins}, shipped ${w.stats.totalShipped}, rank ${w.rank + 1})`);
  let lastRank = w.rank;
  let fullAt = -1;
  let coinsEarned = 0;
  const earnedPer10: number[] = [];
  for (let t = 0; t < ticks; t++) {
    stepSim(w, rt);
    for (const e of w.events) if (e.type === 'shipped') coinsEarned += e.coins;
    w.events.length = 0;
    if (w.tick % 20 === 0) manualPlay(w, rt);
    if (w.tick % 50 === 0) shop(w, log);
    if (w.rank !== lastRank) { lastRank = w.rank; log(`RANK UP → ${w.rank + 1}`); }
    const a = w.automation;
    if (fullAt < 0 && a.dispatch >= 3 && a.restock && a.relocate) { fullAt = w.tick; log('FULL AUTOMATION'); }
    if (w.tick % 6000 === 0) { earnedPer10.push(coinsEarned); events.push(`${w.tick / 600}min: earned ${coinsEarned} shipped ${w.stats.totalShipped} rep ${w.reputation.toFixed(0)} rank ${w.rank + 1} robots ${w.robots.length} queue ${Math.max(0, w.orders.length - 5)}`); coinsEarned = 0; }
  }
  return { fullAt, earnedPer10, shipped: w.stats.totalShipped, rep: w.reputation, queue: Math.max(0, w.orders.length - 5), log: events };
}

describe('balance: a diligent player reaches full automation within a year and income keeps growing', () => {
  it('autoplay for one year (normal)', () => {
    const r = run('normal', CALENDAR.ticksPerYear);
    console.log(r.log.filter((l) => /min:|FULL|RANK/.test(l)).join('\n'));
    console.log(`full automation at ${r.fullAt < 0 ? 'never' : (r.fullAt / 600).toFixed(1) + ' min'} (1 year = ${CALENDAR.ticksPerYear / 600} min)`);
    expect(r.fullAt).toBeGreaterThan(0);
    expect(r.fullAt).toBeLessThan(CALENDAR.ticksPerYear * 0.75); // 1 年の 3/4 以内（余裕を持って）
    // インフレ: 30〜40 分の収入は最初の 10 分の 3 倍以上、1 時間後も最初の 10 分の 3 倍以上
    expect(r.earnedPer10[3]).toBeGreaterThan(r.earnedPer10[0] * 3);
    expect(r.earnedPer10[6]).toBeGreaterThan(r.earnedPer10[0] * 3);
    expect(r.rep).toBeGreaterThan(30);
  });

  it('difficulty bites: the same player under superhard ends with a worse reputation / longer queue than under easy', () => {
    const ticks = 24000; // 40 分
    const rows = (['easy', 'normal', 'hard', 'superhard'] as const).map((d) => ({ d, ...run(d, ticks) }));
    for (const r of rows) console.log(`${r.d.padEnd(9)} full=${r.fullAt < 0 ? 'never' : (r.fullAt / 600).toFixed(1) + 'min'} shipped=${r.shipped} rep=${r.rep.toFixed(0)} queue=${r.queue} earned10=${r.earnedPer10.join('/')}`);
    const easy = rows[0], superhard = rows[3];
    expect(superhard.rep < easy.rep || superhard.queue > easy.queue).toBe(true);
    for (const r of rows) expect(r.fullAt).toBeGreaterThan(0); // どの難易度でも 40 分以内に自動化はできる
  });
});
