/**
 * 欠品の補充が止まる件: 空ビンが在庫の下に埋まっていて、欠品商品の山が入荷口にあり、欠品待ちのオーダーがキューに押し戻されている。
 * 小さな倉庫（棚ロボ 1 台）でピック待ちが続いても、空ビンを掘り出して欠品商品を補充できること。
 */
import { describe, expect, it } from 'vitest';
import { addPallet, stockOf } from './inbound';
import { createRuntime, stepSim } from './sim';
import { addRobot, createBin, createWorld } from './world';
import type { WorldState } from './types';

function order(w: WorldState, id: number, lines: [string, number][]) {
  w.orders.push({ id, lines: lines.map(([item, qty]) => ({ item, qty, picked: 0 })), arrivedTick: w.tick, shownTick: null, penalized: false });
}

describe('欠品商品の補充（空ビンが埋まっている・欠品待ちがキューに居る）', () => {
  function setup(seed: number) {
    const w = createWorld({ seed });
    const rt = createRuntime();
    w.coins = 1e6;
    w.automation = { dispatch: 3, restock: true, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    w.levels = 3; // 各スタックに 1 段の空き（掘り出しの退避先がある）
    w.nextOrderTick = 1e9; // オーダーは手で入れる
    // apple を欠品にし、空ビンは各スタックの一番下に埋める（上は他の商品のビン）
    const items = ['banana', 'book', 'cap', 'clock', 'pencil'];
    let k = 0;
    for (const s of w.stacks) s.bins = [];
    for (const id of Object.keys(w.bins)) delete w.bins[Number(id)]; // 元のビンは捨てる
    for (const s of w.stacks) {
      const empty = createBin(w, null, 0);
      const full = createBin(w, items[k++ % items.length], w.binCapacity);
      s.bins.push(empty.id, full.id);
    }
    expect(stockOf(w, 'apple')).toBe(0);
    // 入荷口に apple の山（補充待ち）
    addPallet(w, 'apple', 30);
    // 棚ロボを 3 台にして（搬送ロボは 1 台のまま）ポートがピックのビンで埋まりがちな忙しい倉庫にする
    const used = new Set(w.robots.map((r) => `${r.pose.x},${r.pose.z}`));
    let added = 0;
    for (const s of w.stacks) {
      if (added >= 2) break;
      if (used.has(`${s.x},${s.z}`)) continue;
      addRobot(w, 'shelf', s.x, s.z);
      used.add(`${s.x},${s.z}`);
      added++;
    }
    return { w, rt, items };
  }

  it('棚ロボ 1 台でも空ビンを掘り出して欠品商品を補充する', () => {
    const { w, rt, items } = setup(21);
    // 欠品待ちのオーダー 1 件と、在庫で完了できるオーダーを絶やさず流す（ピック待ちが常にある状態）
    order(w, 1, [['apple', 2]]);
    let next = 2;
    let stuffed = -1;
    for (let t = 0; t < 9000; t++) {
      if (t % 60 === 0) order(w, next++, [[items[next % items.length], 2], [items[(next + 1) % items.length], 1]]); // ピック待ちを絶やさない
      stepSim(w, rt);
      if (stuffed < 0 && stockOf(w, 'apple') > 0) stuffed = t;
    }
    expect(stuffed).toBeGreaterThanOrEqual(0);
    expect(stuffed).toBeLessThan(6000);
  });

  it('欠品待ちのオーダーがキューに押し戻されて表示されていなくても、入荷口の欠品商品を補充する', () => {
    const { w, rt, items } = setup(22);
    // 表示枠 5 件は在庫で完了できるオーダーで埋まり、apple のオーダーは 6 件目（キュー）に居る
    for (let i = 0; i < 5; i++) order(w, i + 1, [[items[i % items.length], 1]]);
    order(w, 6, [['apple', 2]]);
    let next = 7;
    let stuffed = -1;
    for (let t = 0; t < 9000; t++) {
      if (t % 60 === 0) order(w, next++, [[items[next % items.length], 2], [items[(next + 1) % items.length], 1]]); // ピック待ちを絶やさない
      stepSim(w, rt);
      if (stuffed < 0 && stockOf(w, 'apple') > 0) stuffed = t;
    }
    expect(stuffed).toBeGreaterThanOrEqual(0);
    expect(stuffed).toBeLessThan(6000);
  });
});
