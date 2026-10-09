import { describe, expect, it } from 'vitest';
import { createWorld, addRobot } from './world';
import { createRuntime, stepMany, stepSim } from './sim';
import { buyAutomation, buyEmptyBin, upgradeLevels } from './shop';
import { addPallet } from './inbound';
import { checkRankUp } from './rank';
import { RANKS } from '../data/balance';
import { diagnoseIdle, findRelocation, restockMode, restockShelfCap, shelvesOnRestock } from './automation';
import { buildPreset } from './presets';
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
  it('an AMR with stacked cargo loads bins for different stations and tours them: picker then inbound, then returns', () => {
    const w = createWorld({ seed: 21 });
    const rt = createRuntime();
    w.nextOrderTick = 1e9;
    w.coins = 1e5;
    w.rank = 1;
    buyAutomation(w, 'dispatch');
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    amr.cargoLevel = 1; // 2 ビン積める（占有マスは 1×1 のまま）
    order(w, 1, [['apple', 1]]);
    addPallet(w, 'book', 10);
    const port = w.ports[0];
    const empty = Object.values(w.bins).find((b) => b.item === null)!;
    const apple = Object.values(w.bins).find((b) => b.item === 'apple')!;
    for (const s of w.stacks) s.bins = s.bins.filter((id) => id !== empty.id && id !== apple.id);
    empty.purpose = 'inbound';
    apple.purpose = 'pick';
    port.outbound.push(empty.id, apple.id);
    until(w, rt, () => amr.job?.type === 'deliver');
    expect(amr.carrying).toHaveLength(2); // 両方積む
    const visited = new Set<number>();
    until(w, rt, () => {
      if (amr.phase === 'working' && amr.job?.type === 'deliver') visited.add(amr.job.stationId);
      return amr.job?.type === 'return';
    }, 4000);
    const kinds = [...visited].map((id) => w.stations.find((s) => s.id === id)!.kind).sort();
    expect(kinds).toEqual(['inbound', 'pick']); // 両方のステーションを巡回
    expect(w.stats.totalShipped).toBe(1);
    expect(w.bins[empty.id]).toMatchObject({ item: 'book', qty: 10 });
  });

  it('restock AI keeps the number of inbound bins in flight within the allocation (1 of 3 shelf robots with ample stock, 2 of 3 in restock mode)', () => {
    const run = (thin: boolean) => {
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
      if (!thin) for (const b of Object.values(w.bins)) if (b.item) b.qty = w.binCapacity; // 在庫たっぷり → 入荷モードにならない
      for (const item of ['apple', 'book', 'mug']) addPallet(w, item, 10);
      order(w, 1, [['apple', 1]]);
      let maxInbound = 0;
      let capMax = 0;
      for (let t = 0; t < 600; t++) {
        stepSim(w, rt);
        const n = shelvesOnRestock(w);
        maxInbound = Math.max(maxInbound, n);
        capMax = Math.max(capMax, restockShelfCap(w));
      }
      return { maxInbound, capMax, mode: restockMode(w) };
    };
    const ample = run(false);
    expect(ample.mode).toBe(false);
    expect(ample.maxInbound).toBeLessThanOrEqual(ample.capMax); // ピック待ちがある間は 3 台中 1 台、無くなれば全員
    const thin = run(true);
    expect(thin.maxInbound).toBeLessThanOrEqual(thin.capMax);
  });

  it('when nothing is waiting for pickers, every idle shelf robot restocks and the backlog drains', () => {
    const w = createWorld({ seed: 23 });
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
    addRobot(w, 'amr', w.waitSpots[1].x, w.waitSpots[1].z);
    for (const item of ['apple', 'book', 'mug', 'shoes']) addPallet(w, item, 60);
    const backlog0 = w.pallets.reduce((a, p) => a + p.qty, 0);
    let maxInbound = 0;
    for (let t = 0; t < 1500; t++) {
      stepSim(w, rt);
      const n = Object.values(w.bins).filter((b) => b.purpose === 'inbound').length;
      maxInbound = Math.max(maxInbound, n);
    }
    expect(maxInbound).toBeGreaterThanOrEqual(2); // 暇な棚ロボが複数同時に補充へ
    const backlog1 = w.pallets.reduce((a, p) => a + p.qty, 0);
    expect(backlog1).toBeLessThan(backlog0 * 0.6);
  });
});

describe('AMR priority setting', () => {
  function portWithBoth(w: ReturnType<typeof createWorld>) {
    const port = w.ports[0];
    const empty = Object.values(w.bins).find((b) => b.item === null)!;
    const apple = Object.values(w.bins).find((b) => b.item === 'apple')!;
    for (const s of w.stacks) s.bins = s.bins.filter((id) => id !== empty.id && id !== apple.id);
    empty.purpose = 'inbound';
    apple.purpose = 'pick';
    port.outbound.push(empty.id, apple.id); // 入荷行きが先に置かれている
    return { empty, apple };
  }
  // ★ 均等でもピックのビン（オーダーが待っている）を先に積む。入荷ビンを先に積むのは補充優先のときだけ
  for (const [pri, expectFirst] of [['pick', 'apple'], ['restock', 'empty'], ['balanced', 'apple']] as const) {
    it(`${pri}: loads the ${expectFirst} bin first`, () => {
      const w = createWorld({ seed: 31 });
      const rt = createRuntime();
      w.nextOrderTick = 1e9;
      w.coins = 1e5;
      w.rank = 1;
      buyAutomation(w, 'dispatch');
      w.automation.amrPriority = pri;
      const { empty, apple } = portWithBoth(w);
      const amr = w.robots.find((r) => r.kind === 'amr')!;
      until(w, rt, () => amr.job?.type === 'deliver');
      expect(amr.carrying[0]).toBe(expectFirst === 'apple' ? apple.id : empty.id);
    });
  }
});

describe('idle diagnosis (debug panel)', () => {
  it('explains a stockout with pallets at the dock and no bin to stuff', () => {
    const w = buildPreset('medium');
    const rt = createRuntime();
    for (let t = 0; t < 50; t++) stepSim(w, rt);
    const lines = diagnoseIdle(w);
    expect(lines.length).toBeGreaterThan(2);
    expect(lines[0]).toContain('暇な棚ロボ');
    // 在庫ゼロの商品を注文させると「欠品」として説明される
    w.orders.unshift({ id: 9999, lines: [{ item: 'fish', qty: 1, picked: 0 }], arrivedTick: w.tick, shownTick: w.tick, penalized: false });
    for (const b of Object.values(w.bins)) if (b.item === 'fish') b.qty = 0;
    expect(diagnoseIdle(w).some((l) => l.startsWith('fish: 欠品'))).toBe(true);
  });
});
