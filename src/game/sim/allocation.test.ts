import { describe, expect, it } from 'vitest';
import { buildPreset } from './presets';
import { createRuntime, stepSim } from './sim';
import { addPallet } from './inbound';
import { restockAmrCap, restockMode, restockShare, restockShelfCap, stockFill } from './automation';
import { AUTOMATION } from '../data/balance';
import type { WorldState } from './types';

/** 棚ロボ・搬送ロボのうち入荷作業をしている割合（直近の平均） */
function measure(w: WorldState, ticks: number) {
  const rt = createRuntime();
  let shelfIn = 0, shelfBusy = 0, amrIn = 0, amrBusy = 0;
  for (let t = 0; t < ticks; t++) {
    stepSim(w, rt);
    // 山が尽きないように補給（入荷モードの測定用）
    if (t % 300 === 0) for (const item of ['apple', 'book', 'tshirt', 'mug']) addPallet(w, item, 20);
    for (const r of w.robots) {
      const j = r.job;
      if (!j || j.type === 'park') continue;
      const inbound = (j.type === 'retrieve' && w.bins[j.binId]?.purpose === 'inbound') || (j.type === 'fetch' && j.only === 'inbound') || r.carrying.some((id) => w.bins[id]?.purpose === 'inbound');
      // 棚ロボは取り出し中だけを分母に（返却ビンの格納や再配置は中立）。搬送ロボは運搬の仕事すべて
      if (r.kind === 'shelf') { if (j.type !== 'retrieve') continue; shelfBusy++; if (inbound) shelfIn++; } else { amrBusy++; if (inbound) amrIn++; }
    }
  }
  return { shelf: shelfBusy ? shelfIn / shelfBusy : 0, amr: amrBusy ? amrIn / amrBusy : 0 };
}

describe('restock allocation (priority setting + low-stock mode)', () => {
  it('the AMR priority setting changes how many robots do inbound work on both layers', () => {
    const results: Record<string, { shelf: number; amr: number }> = {};
    for (const pri of ['pick', 'balanced', 'restock'] as const) {
      const w = buildPreset('medium');
      w.automation.amrPriority = pri;
      for (const b of Object.values(w.bins)) if (b.item) b.qty = w.binCapacity; // 在庫たっぷり
      for (const item of ['apple', 'book', 'tshirt', 'mug']) addPallet(w, item, 40);
      // 在庫は十分（入荷モードにならない）ので、配分は優先設定だけで決まる
      expect(restockMode(w)).toBe(false);
      expect(restockShare(w)).toBeCloseTo(AUTOMATION.restockShareByPriority[pri]);
      results[pri] = measure(w, 3000);
    }
    console.log('inbound share by priority', JSON.stringify(results));
    expect(results.restock.shelf).toBeGreaterThan(results.pick.shelf);
    expect(results.restock.amr).toBeGreaterThan(results.pick.amr);
    expect(results.restock.shelf).toBeGreaterThan(results.pick.shelf * 1.5); // 設定で 1.5 倍以上の差
    expect(results.restock.amr).toBeGreaterThan(results.pick.amr * 1.5);
    expect(results.pick.shelf).toBeLessThan(0.25);
  });

  it('low stock + piled dock switches to restock mode: most robots do inbound work until the shelves fill up', () => {
    const w = buildPreset('medium');
    // 在庫を薄くする: 各ビンの数量を 1〜2 個に
    for (const b of Object.values(w.bins)) if (b.item) b.qty = Math.min(b.qty, 2);
    for (const item of ['apple', 'book', 'tshirt', 'mug', 'shoes', 'console']) addPallet(w, item, 60);
    expect(stockFill(w)).toBeLessThan(AUTOMATION.lowStockFill);
    expect(restockMode(w)).toBe(true);
    expect(restockShare(w)).toBeCloseTo(AUTOMATION.lowStockRestockShare);
    const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
    const amrs = w.robots.length - shelves;
    // オーダーがまだ無い（ピック待ちなし）ので棚ロボは全員、搬送ロボは配分ぶん
    expect(restockShelfCap(w)).toBeGreaterThanOrEqual(Math.round(shelves * AUTOMATION.lowStockRestockShare));
    expect(restockAmrCap(w)).toBe(Math.round(amrs * AUTOMATION.lowStockRestockShare));
    const r = measure(w, 2400);
    console.log('restock mode share', JSON.stringify(r));
    expect(r.shelf).toBeGreaterThan(0.45);
    expect(r.amr).toBeGreaterThan(0.35);
    expect(r.shelf).toBeGreaterThan(measure(buildPreset('medium'), 1).shelf - 1); // 型のため
  });
});
