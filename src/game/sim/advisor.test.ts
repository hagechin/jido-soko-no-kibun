import { describe, expect, it } from 'vitest';
import { createWorld } from './world';
import { adviseNext, createAdvisorStats, sampleAdvisor } from './advisor';
import { addPallet } from './inbound';
import { ADVISOR, AUTOMATION, ROBOT } from '../data/balance';

describe('advisor hints', () => {
  it('starts with the automation ladder, then bins when the dock piles up with no empty bin', () => {
    const w = createWorld({ seed: 1 });
    const st = createAdvisorStats();
    expect(adviseNext(w, st)?.id).toBe('dispatch1');
    w.automation.dispatch = 1;
    expect(adviseNext(w, st)?.id).toBe('rank-dispatch2'); // ランク 1 ではまだ解放されていない
    w.rank = AUTOMATION.unlockRank.dispatch2;
    expect(adviseNext(w, st)?.id).toBe('dispatch2');
    w.automation.dispatch = 2;
    addPallet(w, 'apple', 30);
    expect(adviseNext(w, st)?.id).toBe('restock');
    w.automation.restock = true;
    for (const b of Object.values(w.bins)) if (!b.item) { b.item = 'book'; b.qty = 5; }
    expect(adviseNext(w, st)?.id).toBe('slots'); // 段数 1 で棚が満杯 → まず棚の空き
    w.levels = 2;
    expect(adviseNext(w, st)?.id).toBe('bins');
  });

  it('after warm-up, points at the bottleneck: idle AMRs + busy shelf robots → add shelf robots', () => {
    const w = createWorld({ seed: 2 });
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'balanced', lastRetrieveTick: 0 };
    const st = createAdvisorStats();
    // 棚ロボは常に仕事中、搬送ロボは常に暇、という状態をサンプルで作る
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    shelf.job = { type: 'park', x: 3, z: 2, manual: false };
    shelf.job = { type: 'store', portId: 1, binId: null, stackId: null, manual: false };
    for (let i = 0; i < ADVISOR.minSamples + 200; i++) sampleAdvisor(w, st);
    expect(st.shelfIdle).toBeLessThan(ADVISOR.lowIdleRatio);
    expect(st.amrIdle).toBeGreaterThan(ADVISOR.highIdleRatio);
    expect(adviseNext(w, st)?.id).toBe('shelf');
  });

  it('ドローンの買い時: 地上の搬送ロボが横付けの順番待ちをしていると、ドローンを勧める（Web 版では勧めない）', () => {
    const w = createWorld({ seed: 3 });
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'balanced', lastRetrieveTick: 0 };
    const st = createAdvisorStats();
    for (const r of w.robots) {
      if (r.kind === 'amr') r.job = { type: 'fetch', portId: w.ports[0].id, stationId: null, manual: false, staged: true };
      else r.job = { type: 'store', portId: w.ports[0].id, binId: null, stackId: null, manual: false };
    }
    for (let i = 0; i < ADVISOR.minSamples + 300; i++) sampleAdvisor(w, st);
    expect(st.amrStaged).toBeGreaterThanOrEqual(ADVISOR.stagedRatio);
    expect(adviseNext(w, st)?.id).not.toBe('drone');
    expect(adviseNext(w, st, { drones: 'none' })?.id).not.toBe('drone');
    expect(adviseNext(w, st, { drones: 'locked' })?.id).toBe('drone-locked');
    expect(adviseNext(w, st, { drones: 'available' })?.id).toBe('drone');
    // 上限まで買ってあれば勧めない
    for (let i = 0; i < ROBOT.maxDrones; i++) w.robots.push({ ...w.robots.find((r) => r.kind === 'amr')!, id: 900 + i, variant: 'drone', job: null, queue: [] });
    expect(adviseNext(w, st, { drones: 'available' })?.id).not.toBe('drone');
  });
});
