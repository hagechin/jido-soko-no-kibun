/**
 * ★ 入荷ステーションの列で出荷が止まる件（実機・Web 版で報告）: 事前入荷などで入荷ビンが大量に出ると、搬送ロボが全員
 * 一番近い入荷ステーションの列に並び（ピックのビンを抱えたまま）、ピックステーションが何分も空く。
 * ユーザーのセーブ（11 年目、搬送ロボ 30 台・入荷ステーション 9・滞留 601 件、搬送ロボ 14 台が 1 つの入荷ステーションで順番待ち）から再開して、
 * 出荷が続き、列がほどけることを確かめる。
 */
import { describe, expect, it } from 'vitest';
import { TICKS_PER_SECOND } from '../data/balance';
import { deserialize } from './save';
import { createRuntime, stepSim } from './sim';
import save from './fixtures/inbound-queue-stall.json';

describe('入荷ステーションの列（ユーザーのセーブから再開）', () => {
  it('5 分で出荷が続き、1 つの入荷ステーションに並ぶ搬送ロボが減る', () => {
    const res = deserialize(JSON.stringify(save));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const w = res.world;
    const rt = createRuntime();
    const stagedAt = () => {
      const m = new Map<number, number>();
      for (const r of w.robots) if (r.kind === 'amr' && r.job?.type === 'deliver' && r.job.staged) m.set(r.job.stationId, (m.get(r.job.stationId) ?? 0) + 1);
      return Math.max(0, ...m.values());
    };
    const before = { shipped: w.stats.totalShipped, staged: stagedAt() };
    expect(before.staged).toBeGreaterThanOrEqual(10);
    let maxStagedLater = 0;
    for (let t = 0; t < 5 * 60 * TICKS_PER_SECOND; t++) {
      stepSim(w, rt);
      w.events.length = 0;
      if (t > 60 * TICKS_PER_SECOND) maxStagedLater = Math.max(maxStagedLater, stagedAt());
    }
    const shipped = w.stats.totalShipped - before.shipped;
    // 以前は数分間 0 件。出荷が続いていること、1 つの入荷ステーションに 10 台も並ばないこと
    expect(shipped).toBeGreaterThan(10);
    expect(maxStagedLater).toBeLessThan(8);
  });
});
