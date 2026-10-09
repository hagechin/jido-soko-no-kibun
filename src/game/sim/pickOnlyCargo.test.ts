/**
 * ★ 第 22 回: メガDC・全ロボ最大強化・倉庫いっぱいで出荷が止まった件の回帰テスト。
 * ピック専任の搬送ロボ（積載 4）がポートで「ピック 1 + 入荷 3」を積んで入荷ステーションに並び、ポートが入荷ビンで埋まっていた
 */
import { describe, expect, it } from 'vitest';
import { createWorld, createBin } from './world';
import { createRuntime, stepSim } from './sim';
import { addPallet } from './inbound';
import { inboundLoad } from './automation';
import { AUTOMATION, PORT } from '../data/balance';
import { buildPreset } from './presets';
import { upgradeAllRobots } from './shop';
import { setInbound } from './inbound';

describe('ピック専任の搬送ロボは入荷ビンを積まない', () => {
  it('ポートに入荷ビン 3 + ピックビン 1 があり、積載 4 のピック専任ロボはピックビンだけを積む', () => {
    const w = createWorld({ seed: 7 });
    const rt = createRuntime();
    w.coins = 1e6;
    w.automation = { dispatch: 3, restock: true, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    w.nextOrderTick = 1e9;
    const amr = w.robots.find((r) => r.kind === 'amr')!;
    amr.cargoLevel = 2; // 4 ビン
    // 入荷口に山（入荷専任の枠が立つ）。棚ロボは動かさない
    addPallet(w, 'apple', 200);
    for (const r of w.robots) if (r.kind === 'shelf') r.job = { type: 'park', manual: false } as never;
    const port = w.ports[0];
    const mk = (purpose: 'pick' | 'inbound') => { const b = createBin(w, purpose === 'pick' ? 'book' : null, purpose === 'pick' ? 5 : 0); b.purpose = purpose; return b.id; };
    port.outbound.push(mk('inbound'), mk('inbound'), mk('pick'), mk('inbound'));
    // ピック専任で取りに行かせる
    amr.job = { type: 'fetch', portId: port.id, stationId: null, manual: false, only: 'pick' };
    amr.step = 0;
    let loaded: number[] | null = null;
    for (let t = 0; t < 1200; t++) {
      stepSim(w, rt);
      const job = amr.job as { type: string } | null;
      if (job?.type === 'deliver') { loaded = [...amr.carrying]; break; }
    }
    expect(loaded).not.toBeNull();
    expect(loaded!.length).toBe(1);
    expect(w.bins[loaded![0]].purpose).toBe('pick');
    expect(port.outbound.filter((id) => w.bins[id].purpose === 'inbound')).toHaveLength(3);
  });

  it('1 つのポートに置く入荷ビンは上限まで（inboundLoad）', () => {
    const w = createWorld({ seed: 8 });
    const port = w.ports[0];
    expect(inboundLoad(w, port.id)).toBe(0);
    for (let i = 0; i < 3; i++) { const b = createBin(w, null, 0); b.purpose = 'inbound'; port.outbound.push(b.id); }
    expect(inboundLoad(w, port.id)).toBe(3);
    expect(AUTOMATION.inboundBinsPerPortMax).toBeLessThan(PORT.outboundCapacity);
  });

  it('メガDC・全ロボ最大強化・倉庫いっぱいで 15 分出荷が続く（最長の無出荷 90 秒未満、評判 85 以上）', () => {
    const w = buildPreset('mega');
    w.coins = 1e7;
    upgradeAllRobots(w);
    setInbound(w, { load: 'fill' });
    const rt = createRuntime();
    let last = 0; let gap = 0; let worst = 0;
    for (let t = 0; t < 600 * 15; t++) {
      stepSim(w, rt);
      w.events.length = 0;
      if (w.stats.totalShipped !== last) { last = w.stats.totalShipped; gap = 0; } else { gap++; worst = Math.max(worst, gap); }
    }
    expect(worst).toBeLessThan(90 * 10);
    expect(w.reputation).toBeGreaterThanOrEqual(85);
    expect(w.stats.totalShipped - 700).toBeGreaterThan(60); // プリセットの累計は 700 から。倉庫いっぱいのみの実測は 15 分で約 65
  }, 200_000);
});
