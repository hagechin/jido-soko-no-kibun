import { describe, expect, it } from 'vitest';
import { buildPreset, PRESETS } from './presets';
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
