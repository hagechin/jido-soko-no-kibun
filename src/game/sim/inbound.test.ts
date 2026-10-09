import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { CALENDAR, INBOUND_WORKER } from '../data/balance';
import { buildPreset } from './presets';
import { addPallet, dockBacklog, emptyBinCount, forecastRestock, restockStockCap, setInbound, stockOf, stockSummary, truckLoadFactor, truckPeriodTicks } from './inbound';
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
    // 取り切って空になっただけでは「欠品」には数えない（欠品で止まったオーダーを数える）
    expect(w.stats.stockouts).toBe(0);
  });
});

describe('inbound settings: frequency and load', () => {
  it('frequency changes the interval and scales each truck so the weekly amount stays the same', () => {
    const w = createWorld({ seed: 1 });
    const weekly = forecastRestock(w).find((p) => p.item === 'apple')!.qty;
    setInbound(w, { freq: 'daily' });
    expect(truckPeriodTicks(w)).toBe(Math.round(CALENDAR.ticksPerWeek / 7));
    const daily = forecastRestock(w).find((p) => p.item === 'apple')!.qty;
    expect(daily * 7).toBeGreaterThanOrEqual(weekly - 7);
    expect(daily * 7).toBeLessThanOrEqual(weekly + 7);
    setInbound(w, { freq: 'monthly' });
    expect(truckPeriodTicks(w)).toBe(CALENDAR.ticksPerMonth);
    expect(forecastRestock(w).find((p) => p.item === 'apple')!.qty).toBe(weekly * 4);
    // 月 1: 1 か月で 1 回だけ
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    stepMany(w, rt, CALENDAR.ticksPerMonth + 40);
    expect(w.stats.trucks).toBe(1);
    // 週 2: 1 週で 2 回（入荷口の山が残っている商品は送られないので、山は片づけておく）
    setInbound(w, { freq: 'twice' });
    w.pallets = [];
    const before = w.stats.trucks;
    stepMany(w, rt, CALENDAR.ticksPerWeek + 40);
    expect(w.stats.trucks - before).toBe(2);
  });

  it('load multiplies each truck and the stock cap; fill mode follows the bin count and caps the truck at 4x', () => {
    const w = createWorld({ seed: 1 });
    const base = forecastRestock(w).find((p) => p.item === 'apple')!.qty;
    const cap = restockStockCap(w);
    setInbound(w, { load: 'huge' });
    expect(forecastRestock(w).find((p) => p.item === 'apple')!.qty).toBe(base * 4);
    expect(restockStockCap(w)).toBe(cap * 4);
    // 在庫が標準の目標を超えていても、たっぷりなら入荷が続く
    for (const b of Object.values(w.bins)) if (b.item === 'apple') b.qty = w.binCapacity;
    const applesBins = Object.values(w.bins).filter((b) => b.item === 'apple').length;
    addPallet(w, 'apple', 0);
    setInbound(w, { load: 'standard' });
    const stock = stockOf(w, 'apple');
    if (stock >= cap) expect(forecastRestock(w).some((p) => p.item === 'apple')).toBe(false);
    setInbound(w, { load: 'huge' });
    expect(forecastRestock(w).some((p) => p.item === 'apple')).toBe(true);
    expect(applesBins).toBeGreaterThan(0);
    // 倉庫いっぱい: メガDC（1800 ビン・24 商品）では 1 商品 52 杯が目標、トラックは 4 倍止まり
    const m = buildPreset('mega');
    setInbound(m, { load: 'fill' });
    expect(truckLoadFactor(m)).toBe(INBOUND_WORKER.maxLoadFactor);
    expect(restockStockCap(m) / m.binCapacity).toBeCloseTo((Object.keys(m.bins).length * INBOUND_WORKER.fillShare) / 24, 0);
    // 小さい倉庫では標準より下がらない
    const s = createWorld({ seed: 1 });
    setInbound(s, { load: 'fill' });
    expect(truckLoadFactor(s)).toBe(1);
    expect(restockStockCap(s)).toBe(restockStockCap(createWorld({ seed: 1 })));
  });
});

describe('stockout counter', () => {
  it('counts an order once when one of its lines has zero stock', () => {
    const w = createWorld({ seed: 6 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    for (const b of Object.values(w.bins)) if (b.item === 'apple') { b.qty = 0; b.item = null; }
    w.orders.push({ id: 900, lines: [{ item: 'apple', qty: 1, picked: 0 }], arrivedTick: w.tick, shownTick: null, penalized: false });
    const before = w.stats.stockouts;
    stepMany(w, rt, 200);
    expect(w.stats.stockouts).toBe(before + 1);
    stepMany(w, rt, 600);
    expect(w.stats.stockouts).toBe(before + 1);
  });
});
