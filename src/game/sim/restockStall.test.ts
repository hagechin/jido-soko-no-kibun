/**
 * 欠品の補充が止まる件: 空ビンが在庫の下に埋まっていて、欠品商品の山が入荷口にあり、欠品待ちのオーダーがキューに押し戻されている。
 * 小さな倉庫（棚ロボ 1 台）でピック待ちが続いても、空ビンを掘り出して欠品商品を補充できること。
 */
import { describe, expect, it } from 'vitest';
import { addPallet, stockOf } from './inbound';
import { needsEmptyBin } from './automation';
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

describe('空ビンが無いときのビンの統合（★ デッドロック解消）', () => {
  it('欠品商品の山が入荷口にあり空ビンが無ければ、同じ商品の 2 つのビンをまとめて空ビンを作り、欠品商品を補充する', () => {
    const w = createWorld({ seed: 31 });
    const rt = createRuntime();
    w.coins = 1e6;
    w.automation = { dispatch: 3, restock: true, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    w.levels = 2;
    w.nextOrderTick = 1e9;
    for (const s of w.stacks) s.bins = [];
    for (const id of Object.keys(w.bins)) delete w.bins[Number(id)];
    // 全スタックの頂上に「半分入ったビン」（商品は banana / book を交互）。空ビンは 1 個も無い。apple のビンも無い
    const items = ['banana', 'book'];
    w.stacks.forEach((s, i) => s.bins.push(createBin(w, items[i % 2], Math.floor(w.binCapacity / 2) - 1).id));
    expect(stockOf(w, 'apple')).toBe(0);
    addPallet(w, 'apple', 30);
    order(w, 1, [['apple', 2]]);
    let merged = -1;
    let stuffed = -1;
    for (let t = 0; t < 9000; t++) {
      stepSim(w, rt);
      if (merged < 0 && Object.values(w.bins).some((b) => b.item === null)) merged = t;
      if (stuffed < 0 && stockOf(w, 'apple') > 0) stuffed = t;
      if (stuffed >= 0) break;
    }
    expect(merged).toBeGreaterThanOrEqual(0);
    expect(stuffed).toBeGreaterThan(merged);
    expect(stuffed).toBeLessThan(6000);
    // まとめた側のビンは空（item null）になり、受け側は合算されている。商品の総数は変わらない
    const banana = Object.values(w.bins).filter((b) => b.item === 'banana').reduce((a, b) => a + b.qty, 0);
    expect(banana).toBe(w.stacks.filter((_, i) => i % 2 === 0).length * (Math.floor(w.binCapacity / 2) - 1));
  });

  it('空ビンが棚の底に埋まっている（頂上に使える空ビンが無い）ときも統合する（第 20 回の回帰）', () => {
    const w = createWorld({ seed: 33 });
    const rt = createRuntime();
    w.coins = 1e6;
    w.automation = { dispatch: 3, restock: true, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    w.levels = 3;
    w.nextOrderTick = 1e9;
    for (const s of w.stacks) s.bins = [];
    for (const id of Object.keys(w.bins)) delete w.bins[Number(id)];
    // 1 つのスタックだけ底に空ビン、その上に半分入ったビン 2 つ。ほかは頂上が半分入ったビン。apple は無い
    const items = ['banana', 'book'];
    w.stacks.forEach((s, i) => {
      if (i === 0) s.bins.push(createBin(w, null, 0).id);
      s.bins.push(createBin(w, items[i % 2], Math.floor(w.binCapacity / 2) - 1).id);
      if (i === 0) s.bins.push(createBin(w, items[1], Math.floor(w.binCapacity / 2) - 1).id);
    });
    expect(Object.values(w.bins).filter((b) => b.item === null)).toHaveLength(1);
    expect(needsEmptyBin(w)).toEqual([]);
    addPallet(w, 'apple', 30);
    order(w, 1, [['apple', 2]]);
    expect(needsEmptyBin(w)).toEqual(['apple']);
    let stuffed = -1;
    for (let t = 0; t < 9000; t++) {
      stepSim(w, rt);
      if (stockOf(w, 'apple') > 0) {
        stuffed = t;
        break;
      }
    }
    expect(stuffed).toBeGreaterThanOrEqual(0);
    expect(stuffed).toBeLessThan(6000);
  });

  it('空ビンがあるときは統合しない', () => {
    const w = createWorld({ seed: 32 });
    const rt = createRuntime();
    w.automation = { dispatch: 3, restock: true, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    w.nextOrderTick = 1e9;
    addPallet(w, 'apple', 30);
    for (let t = 0; t < 600; t++) {
      stepSim(w, rt);
      expect(w.robots.some((r) => r.job?.type === 'merge')).toBe(false);
    }
  });
});
