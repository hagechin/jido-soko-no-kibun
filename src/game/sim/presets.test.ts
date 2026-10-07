import { describe, expect, it } from 'vitest';
import { buildPreset, PRESETS } from './presets';
import { addRobot } from './world';
import { addPallet } from './inbound';
import { ITEMS } from '../data/items';
import { railConnected } from './build';
import { isAdjacentToStack, isFacingFloor, cellAt, isFloorWalkable, isRailWalkable } from './grid';
import { freeBinSlots, reservedSlots } from './shop';
import { createRuntime, stepSim } from './sim';
import { footprint, shapeFor } from './footprint';
import { pathStats } from './pathfinding';

describe('presets', () => {
  for (const p of PRESETS) {
    it(`${p.id}: layout is valid and robots sit on legal cells`, () => {
      const w = buildPreset(p.id);
      expect(railConnected(w)).toBe(true);
      for (const port of w.ports) {
        expect(isAdjacentToStack(w, port.x, port.z)).toBe(true);
        expect(isFacingFloor(w, port.x, port.z)).toBe(true);
      }
      for (const s of w.stations) expect(isFacingFloor(w, s.x, s.z)).toBe(true);
      const seen = new Set<string>();
      for (const r of w.robots) {
        for (const c of footprint(r.pose, shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel), [])) {
          const k = `${r.kind}:${c.x},${c.z}`;
          expect(seen.has(k)).toBe(false);
          seen.add(k);
          const kind = cellAt(w, c.x, c.z);
          expect(r.kind === 'shelf' ? isRailWalkable(kind) : isFloorWalkable(kind)).toBe(true);
        }
      }
      // 段数 2 以上なら掘り出し用の空きを残す（初期倉庫は段数 1 なので不要）
      expect(freeBinSlots(w)).toBeGreaterThanOrEqual(w.levels > 1 ? reservedSlots(w) : 0);
      for (const s of w.stacks) expect(s.bins.length).toBeLessThanOrEqual(w.levels);
      expect(JSON.parse(JSON.stringify(w))).toEqual(w);
    });
  }

  it('mega: 28 robots run fully automated for 6 minutes, shipping without stalls or collisions', () => {
    const w = buildPreset('mega');
    expect(w.robots).toHaveLength(28);
    expect(w.stacks.length).toBe(360);
    const rt = createRuntime();
    const t0 = performance.now();
    for (let t = 0; t < 3600; t++) {
      stepSim(w, rt);
      // 占有マスの重なり（衝突）が無いこと
      const seen = new Map<string, number>();
      for (const r of w.robots) {
        const shape = shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
        const cells = footprint(r.pose, shape, []);
        if (r.moveTo) cells.push(...footprint(r.moveTo, shape, []));
        for (const c of cells) {
          const k = `${r.kind}:${c.x},${c.z}`;
          const other = seen.get(k);
          if (other !== undefined && other !== r.id) throw new Error(`collision at tick ${w.tick}: ${other} & ${r.id} on ${k}`);
          seen.set(k, r.id);
        }
      }
    }
    const msPerTick = (performance.now() - t0) / 3600;
    console.log('mega ms/tick', msPerTick.toFixed(2), 'shipped', w.stats.totalShipped - 1000, 'pathStats', JSON.stringify(pathStats));
    expect(w.stats.totalShipped).toBeGreaterThan(1000 + 10);
    expect(msPerTick).toBeLessThan(25);
    for (const r of w.robots) expect(r.stuckTicks).toBeLessThan(300);
  });
});

describe('port load balancing (no pile-up at the port nearest the pickers)', () => {
  it('medium preset: retrievals spread over both ports, AMRs stay busy, no stall over 10 minutes', () => {
    const w = buildPreset('medium');
    const rt = createRuntime();
    const used = new Map<number, number>();
    let idleSamples = 0;
    let samples = 0;
    let lastShipped = w.stats.totalShipped;
    let maxGap = 0;
    let gap = 0;
    for (let t = 0; t < 6000; t++) {
      stepSim(w, rt);
      for (const r of w.robots) for (const j of [r.job]) if (j?.type === 'retrieve') used.set(j.portId, (used.get(j.portId) ?? 0) + 1);
      if (t % 10 === 0) {
        samples++;
        const amrs = w.robots.filter((r) => r.kind === 'amr');
        idleSamples += amrs.filter((r) => !r.job || r.job.type === 'park').length / amrs.length;
      }
      if (w.stats.totalShipped !== lastShipped) {
        lastShipped = w.stats.totalShipped;
        gap = 0;
      } else gap++;
      maxGap = Math.max(maxGap, gap);
    }
    const shipped = w.stats.totalShipped - 150;
    console.log('medium: shipped', shipped, 'ports used', JSON.stringify([...used.entries()]), 'amr idle ratio', (idleSamples / samples).toFixed(2), 'max gap', maxGap);
    expect(used.size).toBe(w.ports.length); // 両方のポートを使う
    expect(shipped).toBeGreaterThan(20);
    expect(maxGap).toBeLessThan(2400); // 4 分以上出荷が止まらない
    for (const r of w.robots) expect(r.stuckTicks).toBeLessThan(300);
  });
});

describe('many robots (windowed planning)', () => {
  it('mega + extra robots = 70 run 4 minutes without collisions at a bounded cost per tick', () => {
    const w = buildPreset('mega');
    // 空いている床／スタックに追加
    const occ = new Set(w.robots.map((r) => `${r.kind}:${r.pose.x},${r.pose.z}`));
    let added = 0;
    for (let z = 0; z < w.height && added < 30; z++) for (let x = 0; x < w.width && added < 30; x++) {
      if (cellAt(w, x, z) === 'floor' && !occ.has(`amr:${x},${z}`) && (x + z) % 3 === 0) { addRobot(w, 'amr', x, z); occ.add(`amr:${x},${z}`); added++; }
    }
    for (const s of w.stacks) { if (added >= 42) break; if (!occ.has(`shelf:${s.x},${s.z}`) && (s.x * 7 + s.z * 3) % 11 === 0) { addRobot(w, 'shelf', s.x, s.z); occ.add(`shelf:${s.x},${s.z}`); added++; } }
    expect(w.robots.length).toBe(70);
    const rt = createRuntime();
    const t0 = performance.now();
    for (let t = 0; t < 2400; t++) {
      stepSim(w, rt);
      const seen = new Map<string, number>();
      for (const r of w.robots) {
        const shape = shapeFor(r.kind === 'shelf' ? 0 : r.cargoLevel);
        const cells = footprint(r.pose, shape, []);
        if (r.moveTo) cells.push(...footprint(r.moveTo, shape, []));
        for (const c of cells) {
          const k = `${r.kind}:${c.x},${c.z}`;
          const other = seen.get(k);
          if (other !== undefined && other !== r.id) throw new Error(`collision at tick ${w.tick}: ${other} & ${r.id} on ${k}`);
          seen.set(k, r.id);
        }
      }
    }
    const msPerTick = (performance.now() - t0) / 2400;
    const stuck = w.robots.filter((r) => r.stuckTicks > 300).length;
    console.log('70 robots: ms/tick', msPerTick.toFixed(2), 'shipped', w.stats.totalShipped - 1000, 'stuck', stuck);
    expect(msPerTick).toBeLessThan(12);
    expect(w.stats.totalShipped - 1000).toBeGreaterThan(5);
    expect(stuck).toBeLessThanOrEqual(3);
  });
});

describe('inbound surge on the mega preset (crowding control)', () => {
  it('a big delivery does not gridlock the AMRs around the inbound stations', () => {
    const w = buildPreset('mega');
    for (const it of ITEMS) addPallet(w, it.id, 40);
    const rt = createRuntime();
    const backlog0 = w.pallets.reduce((a, p) => a + p.qty, 0);
    let maxStuck = 0;
    for (let t = 0; t < 3000; t++) {
      stepSim(w, rt);
      for (const r of w.robots) maxStuck = Math.max(maxStuck, r.stuckTicks);
    }
    const backlog1 = w.pallets.reduce((a, p) => a + p.qty, 0);
    const staged = w.robots.filter((r) => r.job && (r.job.type === 'deliver' || r.job.type === 'fetch') && r.job.staged).length;
    console.log('surge: backlog', backlog0, '->', backlog1, 'maxStuck', maxStuck, 'staged now', staged, 'shipped', w.stats.totalShipped - 1000);
    expect(backlog1).toBeLessThan(backlog0 * 0.7);
    expect(maxStuck).toBeLessThan(600); // 誰も 1 分以上動けないままにならない
    expect(w.stats.totalShipped - 1000).toBeGreaterThan(3); // 入荷ラッシュ中も出荷は続く
  });
});

describe('crowded single-port rail (livelock regression)', () => {
  // 初期倉庫（4×3 の棚、ポート 1）に棚ロボ 4 台。以前は 3 台がポートへ、1 台が退避先へ向かう形で
  // 全員が 2 マスを往復し続けるライブロックになり、2 時間で 1 件しか出荷できなかった
  it('4 shelf robots sharing one port keep shipping for 20 minutes', () => {
    const w = buildPreset('initial');
    w.rank = 2;
    w.levels = 3;
    w.coins = 100_000;
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'pick', lastRetrieveTick: 0 };
    const occ = new Set(w.robots.map((r) => `${r.pose.x},${r.pose.z}`));
    for (let i = w.robots.filter((r) => r.kind === 'shelf').length; i < 4; i++) {
      const s = w.stacks.find((s) => !occ.has(`${s.x},${s.z}`))!;
      occ.add(`${s.x},${s.z}`);
      addRobot(w, 'shelf', s.x, s.z);
    }
    for (let i = w.robots.filter((r) => r.kind === 'amr').length; i < 5; i++) addRobot(w, 'amr', 8 + i, 10);
    const rt = createRuntime();
    let maxGap = 0;
    let lastShip = 0;
    for (let t = 0; t < 12000; t++) {
      stepSim(w, rt);
      if (w.stats.totalShipped > 0 && w.tick - lastShip > maxGap) maxGap = w.tick - lastShip;
      if (w.events.some((e) => e.type === 'shipped')) lastShip = w.tick;
      w.events.length = 0;
    }
    console.log('single-port shipped', w.stats.totalShipped, 'maxGap', maxGap);
    expect(w.stats.totalShipped).toBeGreaterThanOrEqual(8);
    expect(maxGap).toBeLessThan(3000); // 5 分以上止まらない
  });
});
