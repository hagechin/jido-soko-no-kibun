import { describe, expect, it } from 'vitest';
import { createWorld, removeCell } from './world';
import { INITIAL_LAYOUT, ORDERS } from '../data/balance';
import { isAdjacentToStack, isFacingFloor } from './grid';

describe('createWorld', () => {
  it('builds the initial layout from the spec (16x12, 4x3 stacks, 1 port, 2 pick stations, 1 inbound)', () => {
    const w = createWorld();
    expect(w.width).toBe(16);
    expect(w.height).toBe(12);
    expect(w.stacks).toHaveLength(12);
    expect(w.ports).toHaveLength(1);
    expect(w.stations.filter((s) => s.kind === 'pick')).toHaveLength(2);
    expect(w.stations.filter((s) => s.kind === 'inbound')).toHaveLength(1);
    expect(w.robots.filter((r) => r.kind === 'shelf')).toHaveLength(1);
    expect(w.robots.filter((r) => r.kind === 'amr')).toHaveLength(1);
    expect(w.levels).toBe(1);
  });

  it('places one bin per stack: initial item kinds + empty bins', () => {
    const w = createWorld();
    const stocked = Object.values(w.bins).filter((b) => b.item !== null);
    expect(stocked).toHaveLength(ORDERS.itemKindsByRank[0]);
    for (const s of w.stacks) expect(s.bins).toHaveLength(1);
  });

  it('initial layout satisfies placement rules (port touches stacks, stations face floor)', () => {
    const w = createWorld();
    for (const p of w.ports) expect(isAdjacentToStack(w, p.x, p.z)).toBe(true);
    for (const s of w.stations) expect(isFacingFloor(w, s.x, s.z)).toBe(true);
    expect(INITIAL_LAYOUT.every((r) => r.length === 16)).toBe(true);
  });

  it('refuses to remove a stack that still holds bins', () => {
    const w = createWorld();
    const s = w.stacks[0];
    expect(removeCell(w, s.x, s.z)).toBe(false);
    s.bins = [];
    expect(removeCell(w, s.x, s.z)).toBe(true);
    expect(w.stacks.find((t) => t.id === s.id)).toBeUndefined();
  });

  it('state is JSON-serializable round trip', () => {
    const w = createWorld();
    const copy = JSON.parse(JSON.stringify(w));
    expect(copy).toEqual(w);
  });
});
