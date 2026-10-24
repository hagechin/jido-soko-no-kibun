import { describe, expect, it } from 'vitest';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';
import { beginEdit, finishEdit, moveCells, paintCell, eraseCell, validateLayout, snapshotLayout, restoreLayout, floorConnected, layoutProblems } from './layoutEditor';
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

  it('layoutProblems marks the cells that block saving: a stack apart from the main rail, and floor cut off from the rest', () => {
    const w = buildPreset('medium');
    beginEdit(w);
    expect(layoutProblems(w)).toEqual([]);
    // 本体から離れたスタック → レールの問題にそのマスが印
    expect(paintCell(w, 'stack', 0, 0).ok).toBe(true);
    const rail = layoutProblems(w).find((p) => p.message.includes('レール'))!;
    expect(rail).toBeTruthy();
    expect(rail.cells).toEqual([{ x: 0, z: 0 }]);
    expect(eraseCell(w, 0, 0).ok).toBe(true);
    // ポートを囲う → そのポートに印（床に面していない）
    const p = w.ports[0];
    for (const [dx, dz] of [[1, 0], [0, 1], [0, -1]]) if (cellAt(w, p.x + dx, p.z + dz) === 'floor') paintCell(w, 'stack', p.x + dx, p.z + dz);
    const port = layoutProblems(w).find((q) => q.message.includes('ポート('));
    expect(port).toBeTruthy();
    expect(port!.cells).toEqual([{ x: p.x, z: p.z }]);
    // 隅の床 1 マスを塞いで分断 → その床に印
    const w2 = buildPreset('medium');
    beginEdit(w2);
    const cx = w2.width - 1;
    const cz = w2.height - 1;
    expect(cellAt(w2, cx, cz)).toBe('floor');
    for (const [x, z] of [[cx - 1, cz], [cx, cz - 1]]) if (cellAt(w2, x, z) === 'floor') paintCell(w2, 'stack', x, z);
    const floor = layoutProblems(w2).find((q) => q.message.includes('床の通路'));
    expect(floor).toBeTruthy();
    expect(floor!.cells).toEqual([{ x: cx, z: cz }]);
    // 印の無い理由（設備が無い）は cells が空
    for (const pr of layoutProblems(w)) expect(Array.isArray(pr.cells)).toBe(true);
  });
});
