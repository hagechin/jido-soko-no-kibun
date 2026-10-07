import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { CALENDAR, INBOUND_WORKER } from '../data/balance';
import { addPallet, dockBacklog, emptyBinCount, forecastRestock, stockSummary } from './inbound';
import { commandFetch, commandGoStation, commandRetrieve } from './commands';
import { itemInStock } from './orders';
import type { WorldState } from './types';

function until(w: WorldState, rt: ReturnType<typeof createRuntime>, cond: () => boolean, maxTicks = 3000): number {
  let n = 0;
  while (!cond() && n < maxTicks) {
    stepSim(w, rt);
    n++;
  }
  return n;
}

describe('M5 inbound', () => {
  it('a truck arrives once a week and piles pallets at the dock', () => {
    const w = createWorld({ seed: 1 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    stepMany(w, rt, CALENDAR.ticksPerWeek + 40);
    expect(w.stats.trucks).toBe(1);
    expect(w.pallets.length).toBeGreaterThan(0);
    expect(dockBacklog(w)).toBeGreaterThanOrEqual(INBOUND_WORKER.minRestockPerItem * w.pallets.length);
    stepMany(w, rt, CALENDAR.ticksPerWeek);
    expect(w.stats.trucks).toBe(2);
  });

  it('restock forecast grows with last week shipments and is capped', () => {
    const w = createWorld({ seed: 1 });
    const base = forecastRestock(w).find((p) => p.item === 'apple')!.qty;
    w.stats.shippedLastWeek.apple = 1000;
    const big = forecastRestock(w).find((p) => p.item === 'apple')!.qty;
    expect(big).toBeGreaterThan(base);
    expect(big).toBe(INBOUND_WORKER.maxRestockPerItem);
  });

  it('inbound station stuffs a bin from the dock pallet (manual flow)', () => {
    const w = createWorld({ seed: 5 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'book'))!;
    const binId = stack.bins[0];
    w.bins[binId].qty = 3;
    addPallet(w, 'book', 30);
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    until(w, rt, () => w.ports[0].outbound.includes(binId));
    // 需要が無く入荷待ちがあるので自動で inbound 行きになる
    expect(w.bins[binId].purpose).toBe('inbound');
    commandFetch(w, rt, amr.id, w.ports[0].id);
    until(w, rt, () => amr.job?.type === 'return');
    expect(w.bins[binId].qty).toBe(w.binCapacity); // 3 + 17
    expect(w.pallets.find((p) => p.item === 'book')!.qty).toBe(30 - 17);
    expect(dockBacklog(w)).toBe(13);
  });

  it('empty bin is filled with the most-backlogged item and a stockout resolves', () => {
    const w = createWorld({ seed: 6 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    // りんごを売り切る
    for (const b of Object.values(w.bins)) if (b.item === 'apple') { b.qty = 0; b.item = null; }
    expect(itemInStock(w, 'apple')).toBe(false);
    expect(emptyBinCount(w)).toBeGreaterThan(0);
    addPallet(w, 'apple', 10);
    addPallet(w, 'milk', 2);
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === null))!;
    const binId = stack.bins[0];
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    until(w, rt, () => w.ports[0].outbound.includes(binId));
    commandFetch(w, rt, amr.id, w.ports[0].id);
    const inbound = w.stations.find((s) => s.kind === 'inbound')!;
    commandGoStation(w, rt, amr.id, inbound.id);
    until(w, rt, () => amr.job?.type === 'return');
    expect(w.bins[binId].item).toBe('apple');
    expect(w.bins[binId].qty).toBe(10);
    expect(itemInStock(w, 'apple')).toBe(true);
    const sum = stockSummary(w).find((s) => s.item === 'apple')!;
    expect(sum.qty).toBe(10);
    expect(sum.dock).toBe(0);
  });

  it('a bin that is picked down to zero becomes an empty bin', () => {
    const w = createWorld({ seed: 8 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
    const binId = stack.bins[0];
    w.bins[binId].qty = 2;
    w.orders.push({ id: 1, lines: [{ item: 'apple', qty: 2, picked: 0 }], arrivedTick: 0, shownTick: null, penalized: false });
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    commandFetch(w, rt, amr.id, w.ports[0].id);
    until(w, rt, () => w.stats.totalShipped === 1);
    expect(w.bins[binId]).toMatchObject({ item: null, qty: 0 });
    expect(w.stats.stockouts).toBe(1);
  });
});
