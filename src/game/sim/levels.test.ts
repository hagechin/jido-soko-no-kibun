import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { createRuntime, stepSim } from './sim';
import { commandRetrieve } from './commands';
import { addRobot } from './world';
import { lockedStacks, pickStackWithRoom } from './robots';
import { place as placeImpl } from './build';
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

describe('stack locking while digging (§3.2 livelock fix)', () => {
  it('nobody stores bins on a stack that is being dug; stores level the heights; the dig completes', () => {
    const w = createWorld({ seed: 12 });
    w.coins = 1e6;
    w.rank = 4;
    w.nextOrderTick = 1e9;
    upgradeLevels(w);
    upgradeLevels(w); // 3 段
    // スタック0 に [apple(下), book, tshirt] を作る
    const s0 = w.stacks[0];
    const take = (item: string) => { const s = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === item))!; const id = s.bins.find((id) => w.bins[id].item === item)!; s.bins.splice(s.bins.indexOf(id), 1); return id; };
    const apple = s0.bins[0];
    s0.bins.push(take('book'), take('tshirt'));
    expect(s0.bins).toHaveLength(3);
    const rt = createRuntime();
    const digger = w.robots.find((r) => r.kind === 'shelf')!;
    const helper = addRobot(w, 'shelf', w.stacks[11].x, w.stacks[11].z);
    commandRetrieve(w, rt, digger.id, s0.id, apple);
    expect(lockedStacks(w).has(s0.id)).toBe(true);
    expect(pickStackWithRoom(w, s0)?.id).not.toBe(s0.id);
    // 掘っている間、返却ビンを絶え間なくポートに流す（helper が格納する）
    let maxHeightDuringDig = s0.bins.length;
    let fed = 0;
    const port = w.ports[0];
    until(w, rt, () => {
      if (port.returns.length === 0 && fed < 6) {
        const empty = Object.values(w.bins).find((b) => b.item === null && w.stacks.some((s) => s.bins.includes(b.id)));
        if (empty) {
          const s = w.stacks.find((s) => s.bins.includes(empty.id))!;
          s.bins.splice(s.bins.indexOf(empty.id), 1);
          port.returns.push(empty.id);
          fed++;
        }
      }
      if (digger.job?.type === 'retrieve') maxHeightDuringDig = Math.max(maxHeightDuringDig, s0.bins.length);
      return port.outbound.includes(apple);
    }, 4000);
    expect(port.outbound).toContain(apple);
    expect(maxHeightDuringDig).toBe(3); // 掘っている最中に誰も上に積まなかった
    expect(helper.job === null || helper.job.type !== 'retrieve').toBe(true);
    // 格納は低いスタックへ（最大と最小の差が小さい）
    const heights = w.stacks.map((s) => s.bins.length);
    expect(Math.max(...heights) - Math.min(...heights)).toBeLessThanOrEqual(2);
  });
});

describe('full port re-routing', () => {
  it('a shelf robot arriving at a full port moves on to a port with room instead of waiting', () => {
    const w = createWorld({ seed: 13 });
    w.coins = 1e5;
    w.nextOrderTick = 1e9;
    const { place } = require_build();
    expect(place(w, 'port', 7, 4)).toEqual({ ok: true });
    const [p1, p2] = w.ports;
    // p1 を満杯にする
    const spare = Object.values(w.bins).filter((b) => b.item === null).slice(0, 4);
    for (const b of spare) { const s = w.stacks.find((s) => s.bins.includes(b.id))!; s.bins.splice(s.bins.indexOf(b.id), 1); p1.outbound.push(b.id); }
    const rt = createRuntime();
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
    const apple = stack.bins.find((id) => w.bins[id].item === 'apple')!;
    commandRetrieve(w, rt, shelf.id, stack.id, apple);
    expect((shelf.job as { portId: number }).portId).toBe(p2.id); // 最初から空いている方へ
    // 途中で p2 も満杯にして、p1 を空ける → 乗り換える
    (shelf.job as { portId: number }).portId = p1.id;
    until(w, rt, () => shelf.step === 20, 600);
    p1.outbound.length = 4;
    until(w, rt, () => p2.outbound.includes(apple), 1500);
    expect(p2.outbound).toContain(apple);
  });
});

function require_build() {
  return { place: (w: WorldState, kind: 'port', x: number, z: number) => placeImpl(w, kind, x, z) };
}
