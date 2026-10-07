import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { assignItem, canPlace, canRemove, expand, expansionCost, move, place, railConnected, remove } from './build';
import { BUILD, EXPANSION, GRID } from '../data/balance';
import { cellAt } from './grid';
import { createRuntime, stepMany } from './sim';
import { commandRetrieve } from './commands';

describe('M7 build mode (§8)', () => {
  it('ports must touch stacks, stations must face floor, stacks must join the rail', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e5;
    expect(canPlace(w, 'port', 10, 10)).toMatch(/隣接/);
    expect(canPlace(w, 'port', 7, 4)).toBeNull(); // スタック(6,4) の東隣
    expect(canPlace(w, 'stack', 10, 10)).toMatch(/隣接/);
    expect(canPlace(w, 'stack', 3, 5)).toBeNull(); // スタック(3,4) の南隣
    expect(canPlace(w, 'pickStation', 12, 2)).toBeNull();
    expect(canPlace(w, 'stack', 8, 8)).toMatch(/何か|隣接/); // 待機スポットの上
  });

  it('placing costs coins, removing is free; cannot remove what robots stand on', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1000;
    expect(place(w, 'stack', 3, 5)).toEqual({ ok: true });
    expect(w.coins).toBe(1000 - BUILD.stackCost);
    const placed = w.stacks.find((s) => s.x === 3 && s.z === 5)!;
    expect(placed.bins).toHaveLength(1); // 空ビン付き（§9.4）
    expect(w.bins[placed.bins[0]].item).toBeNull();
    expect(remove(w, 3, 5).ok).toBe(false); // ビンが入っている
    placed.bins = [];
    expect(remove(w, 3, 5)).toEqual({ ok: true });
    expect(w.coins).toBe(1000 - BUILD.stackCost);
    expect(cellAt(w, 3, 5)).toBe('floor');
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    expect(canRemove(w, shelf.pose.x, shelf.pose.z)).toMatch(/ロボ/);
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    expect(canPlace(w, 'waitSpot', amr.pose.x, amr.pose.z)).toMatch(/ロボ|何か/);
  });

  it('refuses removals that would split the rail or remove the last port/station', () => {
    const w = createWorld({ seed: 1 });
    expect(canRemove(w, w.ports[0].x, w.ports[0].z)).toMatch(/最後のポート/);
    const inbound = w.stations.find((s) => s.kind === 'inbound')!;
    expect(canRemove(w, inbound.x, inbound.z)).toMatch(/最後の入荷/);
    // 1列だけ残したレールの真ん中を抜くと分断される
    for (const s of [...w.stacks]) if (s.z !== 3) { s.bins = []; w.cells[s.z * w.width + s.x] = 'floor'; w.stacks.splice(w.stacks.indexOf(s), 1); }
    expect(railConnected(w)).toBe(true);
    const mid = w.stacks.find((s) => s.x === 4 && s.z === 3)!;
    mid.bins = [];
    w.robots = [];
    expect(canRemove(w, mid.x, mid.z)).toMatch(/分断/);
  });

  it('moves a stack with its bins, keeping ids', () => {
    const w = createWorld({ seed: 2 });
    w.robots = w.robots.filter((r) => r.kind === 'amr');
    const s = w.stacks.find((s) => s.x === 3 && s.z === 2)!;
    const bins = [...s.bins];
    expect(move(w, 3, 2, 3, 5)).toEqual({ ok: true });
    expect(s.x).toBe(3);
    expect(s.z).toBe(5);
    expect(s.bins).toEqual(bins);
    expect(cellAt(w, 3, 2)).toBe('floor');
    expect(cellAt(w, 3, 5)).toBe('stack');
    expect(move(w, 3, 5, 12, 10).ok).toBe(false); // レールから離れる
  });

  it('expansion adds 4 columns of floor and moves the outbound dock to the new east wall', () => {
    const w = createWorld({ seed: 3 });
    w.coins = 1e5;
    w.rank = 4;
    const h = w.height;
    const docks = w.outboundDock.map((d) => ({ ...d }));
    expect(expand(w)).toEqual({ ok: true });
    expect(w.width).toBe(GRID.initialWidth + GRID.expandStep);
    expect(w.cells).toHaveLength(w.width * h);
    expect(w.coins).toBe(1e5 - EXPANSION.costs[0]);
    for (const d of docks) {
      expect(cellAt(w, d.x, d.z)).toBe('floor');
      expect(cellAt(w, w.width - 1, d.z)).toBe('outboundDock');
    }
    expect(w.stacks).toHaveLength(12);
    // 拡張後もロボが動ける
    const rt = createRuntime();
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const st = w.stacks[5];
    commandRetrieve(w, rt, shelf.id, st.id, st.bins[0]);
    stepMany(w, rt, 400);
    expect(w.ports[0].outbound).toHaveLength(1);
  });

  it('expands south by 4 rows; cost scales with the number of cells added', () => {
    const w = createWorld({ seed: 3 });
    w.coins = 1e5;
    w.rank = 4;
    const h0 = w.height;
    const east = expansionCost(w, 'east')!;
    const south = expansionCost(w, 'south')!;
    expect(east).toBe(EXPANSION.costs[0]); // 4×12 = 48 マス = 基準
    expect(south).toBe(Math.round((EXPANSION.costs[0] * 4 * 16) / EXPANSION.baseCells)); // 4×16 = 64 マス
    expect(expand(w, 'south')).toEqual({ ok: true });
    expect(w.height).toBe(h0 + GRID.expandStep);
    expect(w.cells).toHaveLength(w.width * w.height);
    expect(w.coins).toBe(1e5 - south);
    for (let z = h0; z < w.height; z++) for (let x = 0; x < w.width; x++) expect(cellAt(w, x, z)).toBe('floor');
    expect(w.outboundDock.every((d) => d.x === w.width - 1)).toBe(true);
    // 2 回目は費用表の次の段 × マス数
    expect(expansionCost(w, 'east')).toBe(Math.round((EXPANSION.costs[1] * 4 * w.height) / EXPANSION.baseCells));
    const rt = createRuntime();
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    amr.job = { type: 'park', x: 5, z: w.height - 1, manual: true };
    let reached = false;
    for (let t = 0; t < 300 && !reached; t++) {
      stepMany(w, rt, 1);
      if (amr.pose.z === w.height - 1 && amr.moveTo === null) reached = true;
    }
    expect(reached).toBe(true); // 増えた行まで走れる
  });

  it('expansion is gated by rank', () => {
    const w = createWorld({ seed: 3 });
    w.coins = 1e5;
    expect(expand(w).ok).toBe(false); // ランク0 は 0 回
  });

  it('assigning an item moves it between pickers exclusively', () => {
    const w = createWorld({ seed: 4 });
    const [a, b] = w.stations.filter((s) => s.kind === 'pick');
    expect(assignItem(w, b.id, 'apple', true)).toEqual({ ok: true });
    expect(a.assignedItems).not.toContain('apple');
    expect(b.assignedItems).toContain('apple');
    assignItem(w, b.id, 'apple', false);
    expect(b.assignedItems).not.toContain('apple');
  });
});
