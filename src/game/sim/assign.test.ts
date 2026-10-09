import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { autoAssignItems, fillEmptyPickers, hasIdlePicker, itemLoad, place } from './build';
import { availableItemIds } from './orders';
import { createRuntime, stepMany } from './sim';
import { cellAt } from './grid';

function pickers(w: ReturnType<typeof createWorld>) {
  return w.stations.filter((s) => s.kind === 'pick');
}

describe('ピッカーの担当の自動割り振り（★）', () => {
  it('autoAssignItems: 全商品が重複なく割り当てられ、負荷（人気度）がほぼ均等になる', () => {
    const w = createWorld({ seed: 1 });
    w.coins = 1e6;
    // ピッカーを 2 か所足す（床に面した空きマス）
    let added = 0;
    for (let z = 0; z < w.height && added < 2; z++) for (let x = 0; x < w.width && added < 2; x++) if (cellAt(w, x, z) === 'floor' && place(w, 'pickStation', x, z, true).ok) added++;
    expect(pickers(w).length).toBeGreaterThanOrEqual(3);
    // 人気度に差をつける
    const items = availableItemIds(w);
    items.forEach((it, i) => (w.stats.shippedByItem[it] = i * 40));
    const n = autoAssignItems(w);
    expect(n).toBe(items.length);
    const all = pickers(w).flatMap((p) => p.assignedItems);
    expect(new Set(all).size).toBe(items.length);
    expect(all.length).toBe(items.length);
    const loads = pickers(w).map((p) => p.assignedItems.reduce((a, i) => a + itemLoad(w, i), 0));
    const max = Math.max(...loads);
    const min = Math.min(...loads);
    // いちばん重い商品 1 つぶん以上は開かない
    expect(max - min).toBeLessThanOrEqual(Math.max(...items.map((i) => itemLoad(w, i))));
  });

  it('ピッキングステーションを建設すると、担当の無い新しいピッカーに担当が移る（既存の担当は残る）', () => {
    const w = createWorld({ seed: 2 });
    w.coins = 1e6;
    const before = pickers(w).map((p) => [...p.assignedItems]);
    expect(before.flat().length).toBeGreaterThan(0);
    expect(hasIdlePicker(w)).toBe(false);
    let placed = false;
    for (let z = 0; z < w.height && !placed; z++) for (let x = 0; x < w.width && !placed; x++) if (cellAt(w, x, z) === 'floor' && place(w, 'pickStation', x, z).ok) placed = true;
    expect(placed).toBe(true);
    const fresh = pickers(w)[pickers(w).length - 1];
    expect(fresh.assignedItems.length).toBeGreaterThan(0);
    expect(hasIdlePicker(w)).toBe(false);
    expect(w.events.some((e) => e.type === 'notice' && e.text.includes('担当を割り振りました'))).toBe(true);
    // 重複なし・全部どこかにある
    const all = pickers(w).flatMap((p) => p.assignedItems);
    expect(new Set(all).size).toBe(all.length);
    expect(all.length).toBe(before.flat().length);
  });

  it('fillEmptyPickers は担当の無いピッカーにだけ効き、ピッカーが 1 か所なら何もしない', () => {
    const w = createWorld({ seed: 3 });
    expect(fillEmptyPickers(w)).toBe(0);
    const p = pickers(w)[0];
    const keep = [...p.assignedItems];
    expect(fillEmptyPickers(w)).toBe(0);
    expect(p.assignedItems).toEqual(keep);
  });

  it('hasIdlePicker はピッカーが 2 か所以上で担当の無いものがあるときだけ', () => {
    const w = createWorld({ seed: 4 });
    const rt = createRuntime();
    for (const p of pickers(w)) p.assignedItems = [];
    expect(hasIdlePicker(w)).toBe(pickers(w).length >= 2);
    stepMany(w, rt, 10);
    expect(pickers(w).every((p) => p.assignedItems.length === 0)).toBe(true);
    autoAssignItems(w);
    expect(hasIdlePicker(w)).toBe(false);
  });
});
