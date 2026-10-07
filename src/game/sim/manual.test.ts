import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { commandFetch, commandGoStation, commandRetrieve } from './commands';
import { ECONOMY, TICKS_PER_SECOND } from '../data/balance';
import type { WorldState } from './types';

function until(w: WorldState, rt: ReturnType<typeof createRuntime>, cond: () => boolean, maxTicks = 3000): number {
  let n = 0;
  while (!cond() && n < maxTicks) {
    stepSim(w, rt);
    n++;
  }
  return n;
}

function setup(seed = 7) {
  const w = createWorld({ seed });
  const rt = createRuntime();
  w.nextOrderTick = 1e9; // 自動生成を止める
  w.orders.push({ id: 1, lines: [{ item: 'apple', qty: 2, picked: 0 }], arrivedTick: 0, shownTick: null, penalized: false });
  const shelf = w.robots.find((r) => r.kind === 'shelf')!;
  const amr = w.robots.find((r) => r.kind === 'amr')!;
  const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
  const binId = stack.bins.find((id) => w.bins[id].item === 'apple')!;
  return { w, rt, shelf, amr, stack, binId };
}

describe('M3 manual flow: retrieve → fetch → pick → ship → return', () => {
  it('ships one order by hand and pays coins', () => {
    const { w, rt, shelf, amr, stack, binId } = setup();
    const port = w.ports[0];
    expect(commandRetrieve(w, rt, shelf.id, stack.id, binId)).toEqual({ ok: true });
    const t1 = until(w, rt, () => port.outbound.includes(binId));
    expect(port.outbound).toContain(binId);
    expect(t1).toBeLessThan(600);

    expect(commandFetch(w, rt, amr.id, port.id)).toEqual({ ok: true });
    const t2 = until(w, rt, () => w.stats.totalShipped === 1);
    expect(w.stats.totalShipped).toBe(1);
    expect(t2).toBeLessThan(1200);
    expect(w.orders).toHaveLength(0);
    expect(w.coins).toBeGreaterThan(ECONOMY.initialCoins);
    expect(w.bins[binId].qty).toBe(18); // 20 - 2

    // ビンは自動でポート → 棚の頂上へ戻る
    until(w, rt, () => w.stacks.some((s) => s.bins[s.bins.length - 1] === binId));
    expect(w.stacks.some((s) => s.bins[s.bins.length - 1] === binId)).toBe(true);
    expect(amr.carrying).toHaveLength(0);
    // 暇になった搬送ロボは待機スポットへ
    until(w, rt, () => w.waitSpots.some((s) => s.x === amr.pose.x && s.z === amr.pose.z && amr.moveTo === null), 600);
    expect(w.waitSpots.some((s) => s.x === amr.pose.x && s.z === amr.pose.z)).toBe(true);
  });

  it('delivers to the picker assigned to the item, and a redirect goes to the inbound station', () => {
    const { w, rt, shelf, amr, stack, binId } = setup(8);
    const port = w.ports[0];
    const assigned = w.stations.find((s) => s.kind === 'pick' && s.assignedItems.includes('apple'))!;
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    until(w, rt, () => port.outbound.includes(binId));
    commandFetch(w, rt, amr.id, port.id);
    until(w, rt, () => amr.job?.type === 'deliver');
    expect(amr.job).toMatchObject({ type: 'deliver', stationId: assigned.id });

    const inbound = w.stations.find((s) => s.kind === 'inbound')!;
    expect(commandGoStation(w, rt, amr.id, inbound.id)).toEqual({ ok: true });
    expect(amr.job).toMatchObject({ type: 'deliver', stationId: inbound.id });
    until(w, rt, () => amr.job?.type === 'return');
    // 入荷口に山が無いので何も詰まらず戻る
    expect(w.bins[binId].qty).toBe(20);
    expect(w.stats.totalShipped).toBe(0);
  });

  it('speed bonus: shipping within 30s pays x2 of base', () => {
    const { w, rt, shelf, amr, stack, binId } = setup(9);
    w.reputation = 50;
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    commandFetch(w, rt, amr.id, w.ports[0].id);
    const before = w.coins;
    until(w, rt, () => w.stats.totalShipped === 1);
    const lead = w.stats.recentShipments[0].tick / TICKS_PER_SECOND;
    expect(lead).toBeLessThan(30);
    expect(w.coins - before).toBe(Math.round(2 * 10 * 1.0 * 2.0));
  });

  it('rejects more than 3 queued commands', () => {
    const { w, rt, shelf } = setup(10);
    const stacks = w.stacks.filter((s) => s.bins.length);
    const results = stacks.slice(0, 5).map((s) => commandRetrieve(w, rt, shelf.id, s.id, s.bins[0]));
    expect(results.filter((r) => r.ok)).toHaveLength(4); // 実行中 1 + 予約 3
    expect(results[4].ok).toBe(false);
  });

  it('runs 2 minutes with manual commands without errors and keeps robots in bounds', () => {
    const { w, rt, shelf, amr, stack, binId } = setup(11);
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    commandFetch(w, rt, amr.id, w.ports[0].id);
    stepMany(w, rt, 1200);
    for (const r of w.robots) {
      expect(r.pose.x).toBeGreaterThanOrEqual(0);
      expect(r.pose.x).toBeLessThan(w.width);
      expect(r.pose.z).toBeGreaterThanOrEqual(0);
      expect(r.pose.z).toBeLessThan(w.height);
    }
    expect(w.stats.totalShipped).toBe(1);
  });
});
