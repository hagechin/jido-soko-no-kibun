import { describe, expect, it } from 'vitest';
import { createWorld, addRobot } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { buyAutomation, buyEmptyBin, upgradeLevels } from './shop';
import { addPallet } from './inbound';
import { checkRankUp } from './rank';
import { RANKS } from '../data/balance';
import { findRelocation } from './automation';
import { commandRetrieve } from './commands';
import type { WorldState } from './types';

function until(w: WorldState, rt: ReturnType<typeof createRuntime>, cond: () => boolean, maxTicks = 3000): number {
  let n = 0;
  while (!cond() && n < maxTicks) {
    stepSim(w, rt);
    n++;
  }
  return n;
}

function order(w: WorldState, id: number, lines: [string, number][]) {
  w.orders.push({ id, lines: lines.map(([item, qty]) => ({ item, qty, picked: 0 })), arrivedTick: w.tick, shownTick: null, penalized: false });
}

describe('M9 automation AI (§7.3)', () => {
  it('dispatch Lv1: AMR fetches bins from the port on its own', () => {
    const w = createWorld({ seed: 1 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    expect(buyAutomation(w, 'dispatch')).toEqual({ ok: true });
    order(w, 1, [['apple', 1]]);
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
    commandRetrieve(w, rt, w.robots[0].id, stack.id, stack.bins[0]);
    until(w, rt, () => w.stats.totalShipped === 1);
    expect(w.stats.totalShipped).toBe(1);
  });

  it('dispatch Lv2: shelf robots retrieve for visible orders, oldest first, and the warehouse runs hands-off', () => {
    const w = createWorld({ seed: 2 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    buyAutomation(w, 'dispatch');
    order(w, 1, [['book', 1]]);
    w.tick += 50;
    order(w, 2, [['apple', 2]]);
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    stepSim(w, rt);
    expect(shelf.job?.type).toBe('retrieve');
    expect(w.bins[(shelf.job as { binId: number }).binId].item).toBe('book');
    until(w, rt, () => w.stats.totalShipped === 2, 4000);
    expect(w.stats.totalShipped).toBe(2);
  });

  it('dispatch Lv3 prefers items shared by several orders (batching)', () => {
    const w = createWorld({ seed: 3 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 2;
    for (let i = 0; i < 3; i++) buyAutomation(w, 'dispatch');
    order(w, 1, [['book', 1]]);
    w.tick += 20;
    order(w, 2, [['apple', 1]]);
    w.tick += 20;
    order(w, 3, [['apple', 1]]);
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    stepSim(w, rt);
    expect(w.bins[(shelf.job as { binId: number }).binId].item).toBe('apple');
  });

  it('restock AI sends a matching or empty bin to the inbound station when pallets arrive', () => {
    const w = createWorld({ seed: 4 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    expect(buyAutomation(w, 'restock')).toEqual({ ok: true });
    const bin = Object.values(w.bins).find((b) => b.item === 'mug')!;
    bin.qty = 5;
    addPallet(w, 'mug', 12);
    until(w, rt, () => bin.qty === 17, 3000);
    expect(bin.qty).toBe(17);
    expect(w.pallets).toHaveLength(0);
  });

  it('relocate AI brings a popular buried bin to the top when idle', () => {
    const w = createWorld({ seed: 5 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e6;
    w.rank = 2;
    upgradeLevels(w);
    expect(buyAutomation(w, 'relocate')).toEqual({ ok: true });
    // apple を book の下に埋める。apple を人気にする
    const s0 = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
    const s1 = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'book'))!;
    const book = s1.bins.pop()!;
    s0.bins.push(book);
    w.stats.shippedByItem.apple = 50;
    expect(findRelocation(w, new Set())?.binId).toBe(s0.bins[0]);
    const apple = s0.bins[0];
    until(w, rt, () => s0.bins[s0.bins.length - 1] === apple, 2000);
    expect(s0.bins[s0.bins.length - 1]).toBe(apple);
  });

  it('manual commands take precedence over automation', () => {
    const w = createWorld({ seed: 6 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    buyAutomation(w, 'dispatch');
    order(w, 1, [['book', 1]]);
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'shoes'))!;
    stepSim(w, rt); // 自動で book を取りに行く
    expect(commandRetrieve(w, rt, shelf.id, stack.id, stack.bins[0])).toEqual({ ok: true });
    expect(shelf.job).toMatchObject({ type: 'retrieve', manual: true, binId: stack.bins[0] });
  });

  it('fully automated warehouse keeps shipping for 10 minutes (rank 1, 2 levels, extra bins)', () => {
    const w = createWorld({ seed: 7 });
    const rt = createRuntime();
    w.coins = 1e6;
    w.rank = 1;
    for (let i = 0; i < 2; i++) buyAutomation(w, 'dispatch');
    buyAutomation(w, 'restock');
    upgradeLevels(w);
    for (let i = 0; i < 8; i++) expect(buyEmptyBin(w)).toEqual({ ok: true });
    addRobot(w, 'shelf', w.stacks[6].x, w.stacks[6].z);
    addRobot(w, 'amr', w.waitSpots[1].x, w.waitSpots[1].z);
    addRobot(w, 'amr', w.waitSpots[2].x, w.waitSpots[2].z);
    stepMany(w, rt, 6000);
    expect(w.stats.totalShipped).toBeGreaterThan(12);
    for (const r of w.robots) expect(r.stuckTicks).toBeLessThan(300);
  });

  it('with more item kinds than bins, stockout items at the dock get empty bins first (no permanent jam)', () => {
    const w = createWorld({ seed: 7 });
    const rt = createRuntime();
    w.coins = 1e6;
    w.rank = 2;
    for (let i = 0; i < 3; i++) buyAutomation(w, 'dispatch');
    buyAutomation(w, 'restock');
    upgradeLevels(w);
    upgradeLevels(w);
    for (let i = 0; i < 10; i++) buyEmptyBin(w);
    addRobot(w, 'shelf', w.stacks[6].x, w.stacks[6].z);
    addRobot(w, 'amr', w.waitSpots[1].x, w.waitSpots[1].z);
    stepMany(w, rt, 9000);
    // 厳しい構成なので出荷は少ないが、止まらずに進む
    expect(w.stats.totalShipped).toBeGreaterThan(2);
    for (const r of w.robots) expect(r.stuckTicks).toBeLessThan(300);
  });
});

describe('M9 warehouse rank (§9.3)', () => {
  it('ranks up on shipments and area, unlocking items and assigning them to pickers', () => {
    const w = createWorld({ seed: 8 });
    expect(checkRankUp(w)).toBe(false);
    w.stats.totalShipped = RANKS[1].shipped;
    expect(checkRankUp(w)).toBe(true);
    expect(w.rank).toBe(1);
    expect(w.events.some((e) => e.type === 'rankUp')).toBe(true);
    const assigned = w.stations.filter((s) => s.kind === 'pick').flatMap((s) => s.assignedItems);
    expect(new Set(assigned).size).toBe(10); // 新商品 4 種が担当に加わる
    // ランク3 は面積も必要
    w.stats.totalShipped = RANKS[2].shipped;
    expect(checkRankUp(w)).toBe(false);
  });
});

describe('mixed destinations at the port', () => {
  it('an AMR loads only bins bound for the same station, so pick bins reach the picker', () => {
    const w = createWorld({ seed: 21 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    amr.cargoLevel = 1; // 2 ビン積める
    order(w, 1, [['apple', 1]]);
    // ポートに「入荷行き」と「ピッカー行き」を 1 つずつ置く
    const port = w.ports[0];
    const empty = Object.values(w.bins).find((b) => b.item === null)!;
    const apple = Object.values(w.bins).find((b) => b.item === 'apple')!;
    for (const s of w.stacks) s.bins = s.bins.filter((id) => id !== empty.id && id !== apple.id);
    empty.purpose = 'inbound';
    apple.purpose = 'pick';
    port.outbound.push(empty.id, apple.id);
    until(w, rt, () => amr.job?.type === 'deliver');
    expect(amr.carrying).toHaveLength(1);
    expect(amr.carrying[0]).toBe(empty.id); // 先頭（入荷行き）だけ積む
    const inbound = w.stations.find((s) => s.kind === 'inbound')!;
    expect(amr.job).toMatchObject({ type: 'deliver', stationId: inbound.id });
    // りんごはピッカーへ届いて出荷される
    until(w, rt, () => w.stats.totalShipped === 1, 4000);
    expect(w.stats.totalShipped).toBe(1);
  });

  it('restock AI leaves room at the port and runs one bin at a time while picks are pending', () => {
    const w = createWorld({ seed: 22 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e6;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    buyAutomation(w, 'restock');
    upgradeLevels(w);
    for (let i = 0; i < 6; i++) buyEmptyBin(w);
    addRobot(w, 'shelf', w.stacks[6].x, w.stacks[6].z);
    addRobot(w, 'shelf', w.stacks[9].x, w.stacks[9].z);
    for (const item of ['apple', 'book', 'mug']) addPallet(w, item, 10);
    order(w, 1, [['apple', 1]]);
    let maxInbound = 0;
    for (let t = 0; t < 600; t++) {
      stepSim(w, rt);
      const n = Object.values(w.bins).filter((b) => b.purpose === 'inbound').length;
      maxInbound = Math.max(maxInbound, n);
    }
    expect(maxInbound).toBeLessThanOrEqual(1);
  });
});
