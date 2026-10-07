import { describe, expect, it } from 'vitest';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';
import { beginEdit, finishEdit, moveCells, paintCell, eraseCell, validateLayout, snapshotLayout, restoreLayout, floorConnected } from './layoutEditor';
import { cellAt } from './grid';

describe('layout editor (stop → edit → resume)', () => {
  it('beginEdit returns carried bins to shelves, cancels jobs and parks robots outside; finishEdit puts them back and the warehouse runs', () => {
    const w = buildPreset('medium');
    const rt = createRuntime();
    for (let t = 0; t < 900; t++) stepSim(w, rt); // 動かして荷物を持たせる
    const binsBefore = Object.keys(w.bins).length;
    beginEdit(w);
    expect(w.flags.layoutEditor).toBe(true);
    for (const r of w.robots) {
      expect(r.carrying).toEqual([]);
      expect(r.job).toBeNull();
      expect(r.pose.z).toBeLessThan(0); // 倉庫の外
    }
    // ビンは全部どこかにある（棚かポート）
    const inStacks = w.stacks.reduce((a, s) => a + s.bins.length, 0);
    const onPorts = w.ports.reduce((a, p) => a + p.outbound.length + p.returns.length, 0);
    expect(inStacks + onPorts).toBe(binsBefore);
    expect(validateLayout(w)).toEqual([]);
    const r = finishEdit(w);
    expect(r.ok).toBe(true);
    expect(w.flags.layoutEditor).toBe(false);
    const seen = new Set<string>();
    for (const ro of w.robots) {
      expect(ro.pose.z).toBeGreaterThanOrEqual(0);
      const k = `${ro.kind}:${ro.pose.x},${ro.pose.z}`;
      expect(seen.has(k)).toBe(false);
      seen.add(k);
    }
    const rt2 = createRuntime();
    const shipped0 = w.stats.totalShipped;
    for (let t = 0; t < 3000; t++) stepSim(w, rt2);
    expect(w.stats.totalShipped).toBeGreaterThan(shipped0);
  });

  it('moves a block of stacks with their bins, refuses moves onto other equipment or out of bounds, and can be restored', () => {
    const w = buildPreset('medium');
    beginEdit(w);
    const snap = snapshotLayout(w);
    const stacksOnly = w.stacks.map((s) => ({ x: s.x, z: s.z }));
    const block = [...stacksOnly, ...w.ports.map((p) => ({ x: p.x, z: p.z }))];
    const binsBefore = w.stacks.map((s) => [...s.bins]);
    const idsBefore = w.stacks.map((s) => s.id);
    // スタックだけを南へ 1 ずらすと南側のポート (7,5) にぶつかる → 拒否
    expect(moveCells(w, stacksOnly, 0, 1).ok).toBe(false);
    // スタックとポートをブロックごと南へ 3（元の位置と重なるのは選択内なので OK）
    expect(moveCells(w, block, 0, 3).ok).toBe(true);
    expect(w.stacks.map((s) => s.id)).toEqual(idsBefore);
    expect(w.stacks.map((s) => [...s.bins])).toEqual(binsBefore);
    for (const s of w.stacks) expect(cellAt(w, s.x, s.z)).toBe('stack');
    for (const p of w.ports) expect(cellAt(w, p.x, p.z)).toBe('port');
    expect(validateLayout(w)).toEqual([]); // ポートも一緒に動いたので正しいまま
    // 外へはみ出す移動は拒否
    expect(moveCells(w, block, 0, 100).ok).toBe(false);
    // 元に戻す
    restoreLayout(w, snap);
    expect(validateLayout(w)).toEqual([]);
    expect(w.stacks.map((s) => [...s.bins])).toEqual(binsBefore);
  });

  it('paint costs coins, erase refuses stacks with bins, floor connectivity is checked', () => {
    const w = buildPreset('medium');
    beginEdit(w);
    const coins = w.coins;
    expect(paintCell(w, 'stack', 0, 0).ok).toBe(true); // 途中は孤立していてもよい
    expect(w.coins).toBeLessThan(coins);
    expect(validateLayout(w).some((p) => p.includes('レール'))).toBe(true);
    expect(eraseCell(w, 0, 0).ok).toBe(true);
    expect(validateLayout(w)).toEqual([]);
    const full = w.stacks.find((s) => s.bins.length)!;
    expect(eraseCell(w, full.x, full.z).ok).toBe(false);
    expect(floorConnected(w)).toBe(true);
    // ポート (13,3) を囲う: 周りの床にスタックを塗ると床が分断 → 保存不可
    const p = w.ports[0];
    for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]]) if (cellAt(w, p.x + dx, p.z + dz) === 'floor') paintCell(w, 'stack', p.x + dx, p.z + dz);
    expect(validateLayout(w).length).toBeGreaterThan(0);
  });
});
