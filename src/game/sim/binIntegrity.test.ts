/**
 * ★ 第 24 回: ビンが行方不明になる件の回帰テスト。
 * 掘り出し（退避ビンを持っている）の途中で目的のビンが他のロボに取られると、仕事が finishJob で終わり、
 * 次の仕事が carrying を上書きしてビンがどこにも無くなっていた（在庫はあるのに出荷できない）。
 */
import { describe, expect, it } from 'vitest';
import { createBin, createWorld } from './world';
import { createRuntime, stepSim } from './sim';
import { auditBins, rehomeOrphans } from './integrity';
import { deserialize } from './save';
import { buildPreset } from './presets';
import { upgradeAllRobots } from './shop';
import type { WorldState } from './types';
import orphanSave from './fixtures/orphan-tshirt-save.json';

function placedEverywhere(w: WorldState): boolean {
  return auditBins(w).length === 0;
}

describe('ビンの整合性', () => {
  it('掘り出しの途中で目的のビンが消えても、持っている退避ビンは棚に戻る（行方不明にならない）', () => {
    const w = createWorld({ seed: 3 });
    const rt = createRuntime();
    w.levels = 3;
    w.nextOrderTick = 1e9;
    w.automation = { dispatch: 0, restock: false, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 };
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const stack = w.stacks[0];
    stack.bins.length = 0;
    const target = createBin(w, 'apple', 10);
    const top = createBin(w, 'book', 10);
    stack.bins.push(target.id, top.id);
    shelf.pose = { x: stack.x, z: stack.z, dir: 0 };
    shelf.job = { type: 'relocate', stackId: stack.id, binId: target.id, manual: false };
    shelf.step = 0;
    // 退避ビンを持つまで進める
    let carried = false;
    for (let t = 0; t < 200 && !carried; t++) {
      stepSim(w, rt);
      carried = shelf.carrying.includes(top.id);
    }
    expect(carried).toBe(true);
    // 目的のビンが他のロボに取られた（スタックから消えてポートへ）
    stack.bins.splice(stack.bins.indexOf(target.id), 1);
    w.ports[0].outbound.push(target.id);
    for (let t = 0; t < 600; t++) stepSim(w, rt);
    expect(placedEverywhere(w)).toBe(true);
    expect(shelf.carrying).toEqual([]);
    expect(w.stacks.some((s) => s.bins.includes(top.id))).toBe(true);
  });

  it('rehomeOrphans: どこにも無いビンを棚に戻してお知らせを出す', () => {
    const w = createWorld({ seed: 4 });
    const lost = createBin(w, 'tshirt', 40);
    expect(auditBins(w)).toEqual([lost.id]);
    expect(rehomeOrphans(w)).toBe(1);
    expect(auditBins(w)).toEqual([]);
    // 初期の倉庫は棚が満杯なので、ポートの返却側に置かれる（空きがあれば棚）
    expect(w.stacks.some((s) => s.bins.includes(lost.id)) || w.ports.some((p) => p.returns.includes(lost.id))).toBe(true);
    expect(w.events.some((e) => e.type === 'notice' && e.text.includes('行方不明'))).toBe(true);
  });

  it('ユーザーのセーブ（Tシャツのビン 2 個が行方不明で全オーダーが止まっていた）: 読み込みで戻り、出荷が再開する', () => {
    const res = deserialize(JSON.stringify(orphanSave));
    expect(res.ok).toBe(true);
    if (!res.ok) return;
    const w = res.world;
    expect(auditBins(w)).toEqual([]);
    expect(w.events.some((e) => e.type === 'notice' && e.text.includes('行方不明'))).toBe(true);
    const rt = createRuntime();
    const before = w.stats.totalShipped;
    for (let t = 0; t < 1500; t++) stepSim(w, rt);
    expect(w.stats.totalShipped).toBeGreaterThan(before);
  }, 300_000);

  it('メガDC で 20 分: ビンは常にどこか 1 か所にある', () => {
    const w = buildPreset('mega', { seed: 11 });
    w.coins = 1e7;
    w.automation = { dispatch: 3, restock: true, relocate: true, amrPriority: 'balanced', lastRetrieveTick: 0 };
    upgradeAllRobots(w);
    const rt = createRuntime();
    for (let t = 0; t < 12000; t++) {
      stepSim(w, rt);
      if (t % 300 === 0) expect(auditBins(w)).toEqual([]);
    }
  }, 600_000);
});
