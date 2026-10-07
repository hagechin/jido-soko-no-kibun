import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepSim } from './sim';
import { commandRetrieve } from './commands';
import { upgradeLevels, upgradeBinCapacity, upgradeCargo } from './shop';
import { deserialize, serialize } from './save';
import { LEVELS, SAVE } from '../data/balance';
import type { WorldState } from './types';

function until(w: WorldState, rt: ReturnType<typeof createRuntime>, cond: () => boolean, maxTicks = 3000): number {
  let n = 0;
  while (!cond() && n < maxTicks) {
    stepSim(w, rt);
    n++;
  }
  return n;
}

describe('M6 levels & digging (§3.2)', () => {
  it('levels upgrade costs follow the table and respect the rank cap', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    expect(upgradeLevels(w)).toEqual({ ok: true });
    expect(w.levels).toBe(2);
    expect(w.coins).toBe(1e6 - LEVELS.costs[0]);
    expect(upgradeLevels(w).ok).toBe(false); // ランク0 は 2 段まで
    w.rank = 4;
    for (let i = w.levels; i < LEVELS.max; i++) expect(upgradeLevels(w).ok).toBe(true);
    expect(upgradeLevels(w).ok).toBe(false);
  });

  it('retrieving a buried bin digs the bin above to a neighbour stack; the dug bin stays on top there', () => {
    const w = createWorld({ seed: 2 });
    w.coins = 1e6;
    w.nextOrderTick = 1e9;
    upgradeLevels(w);
    // スタック0 に [apple(下), book(上)] を作る
    const s0 = w.stacks[0];
    const s1 = w.stacks[1];
    const book = s1.bins.pop()!;
    s0.bins.push(book);
    const apple = s0.bins[0];
    expect(s0.bins).toEqual([apple, book]);
    const rt = createRuntime();
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    commandRetrieve(w, rt, shelf.id, s0.id, apple);
    let dug = false;
    until(w, rt, () => {
      if (shelf.step === 12 || shelf.step === 13) dug = true;
      return w.ports[0].outbound.includes(apple);
    });
    expect(dug).toBe(true);
    expect(w.ports[0].outbound).toContain(apple);
    const holder = w.stacks.find((s) => s.bins.includes(book))!;
    expect(holder.id).not.toBe(s0.id);
    expect(holder.bins[holder.bins.length - 1]).toBe(book);
    expect(holder.bins.length).toBeLessThanOrEqual(w.levels);
    // 返却されたビンは頂上に積まれる
    w.ports[0].outbound = [];
    w.ports[0].returns.push(apple);
    until(w, rt, () => w.stacks.some((s) => s.bins.includes(apple)));
    const back = w.stacks.find((s) => s.bins.includes(apple))!;
    expect(back.bins[back.bins.length - 1]).toBe(apple);
  });

  it('digging waits when no stack has room', () => {
    const w = createWorld({ seed: 3 });
    w.nextOrderTick = 1e9;
    // 段数 1 のまま 2 段積みにする（不正状態を作って「退避先なし」を再現）
    const s0 = w.stacks[0];
    const book = w.stacks[1].bins.pop()!;
    s0.bins.push(book);
    w.stacks[1].bins.push(w.stacks[2].bins.pop()!); // スタック1 を埋める
    w.stacks[2].bins.push(w.stacks[3].bins.pop()!);
    w.stacks[3].bins.push(w.stacks[4].bins.pop()!);
    // いずれかのスタックは空になる → そこが退避先になるので、全部埋める
    for (const s of w.stacks) if (!s.bins.length) s.bins.push(w.stacks[0].bins[0]);
    const rt = createRuntime();
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    commandRetrieve(w, rt, shelf.id, s0.id, s0.bins[0]);
    until(w, rt, () => false, 400);
    expect(w.ports[0].outbound).toHaveLength(0);
    expect(shelf.job?.type).toBe('retrieve');
  });

  it('bin capacity and cargo upgrades', () => {
    const w = createWorld({ seed: 4 });
    w.coins = 1e6;
    expect(upgradeBinCapacity(w)).toEqual({ ok: true });
    expect(w.binCapacity).toBe(30);
    expect(upgradeBinCapacity(w)).toEqual({ ok: true });
    expect(upgradeBinCapacity(w).ok).toBe(false);
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    expect(upgradeCargo(w, amr.id)).toEqual({ ok: true });
    expect(amr.cargoLevel).toBe(1);
    expect(upgradeCargo(w, amr.id)).toEqual({ ok: true });
    expect(amr.cargoLevel).toBe(2);
    expect(upgradeCargo(w, amr.id).ok).toBe(false);
  });
});

describe('M6 save/load', () => {
  it('round-trips the world and continues simulating', () => {
    const w = createWorld({ seed: 5 });
    const rt = createRuntime();
    for (let i = 0; i < 300; i++) stepSim(w, rt);
    const text = serialize(w, 123);
    const res = deserialize(text);
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    expect(res.savedAt).toBe(123);
    expect(res.world.tick).toBe(w.tick);
    expect(res.world.orders.length).toBe(w.orders.length);
    const rt2 = createRuntime();
    for (let i = 0; i < 300; i++) stepSim(res.world, rt2);
    expect(res.world.tick).toBe(w.tick + 300);
  });
  it('rejects garbage and newer versions', () => {
    expect(deserialize('nope').ok).toBe(false);
    expect(deserialize('{"version":999,"world":{}}').ok).toBe(false);
    expect(deserialize('{"foo":1}').ok).toBe(false);
  });
  it('migrates older versions by filling missing fields', () => {
    const w = createWorld({ seed: 6 });
    const file = JSON.parse(serialize(w));
    file.version = SAVE.version - 1;
    delete file.world.trucks;
    delete file.world.stats.trucks;
    const res = deserialize(JSON.stringify(file));
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.migrated).toBe(true);
      expect(res.world.trucks).toEqual([]);
      expect(res.world.stats.trucks).toBe(0);
    }
  });
});
