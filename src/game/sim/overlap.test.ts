/**
 * 重なりへの耐性（★保険）。経路計画は同じマスに 2 台を置かないはずだが、ユーザーのセーブで
 * 同じマスに重なったまま何時間も固まるロボが見つかった（持っているビンが「向かっている在庫」と数えられ、誰もその商品を取りに行かなくなる）。
 */
import { describe, expect, it } from 'vitest';
import { createWorld, addRobot, createBin } from './world';
import { buildPreset } from './presets';
import { buyAmr, buyEmptyBin, buyShelfRobot } from './shop';
import { expand, place } from './build';
import { deserialize, serialize } from './save';
import { createRng, rand, randInt } from './rng';
import { createRuntime, stepSim } from './sim';
import { AUTOMATION, PATHING } from '../data/balance';
import { atGoal } from './goals';

function overlaps(w: ReturnType<typeof createWorld>): number {
  let n = 0;
  for (const r of w.robots) for (const o of w.robots) if (o !== r && o.kind === r.kind && o.pose.x === r.pose.x && o.pose.z === r.pose.z) n++;
  return n / 2;
}

describe('overlapping robots', () => {
  it('two shelf robots on the same stack both leave and reach different goals', () => {
    const w = createWorld({ seed: 1 });
    w.nextOrderTick = 1e9;
    w.robots.length = 0;
    const a = addRobot(w, 'shelf', 4, 3);
    const b = addRobot(w, 'shelf', 4, 3);
    a.job = { type: 'park', x: 6, z: 2, manual: false };
    b.job = { type: 'park', x: 3, z: 4, manual: false };
    const rt = createRuntime();
    for (let t = 0; t < 300; t++) stepSim(w, rt);
    expect(overlaps(w)).toBe(0);
    expect(a.pose).toMatchObject({ x: 6, z: 2 });
    expect(b.pose).toMatchObject({ x: 3, z: 4 });
  });

  it('two idle AMRs stacked on one floor cell are separated after overlapHealTicks with a notice', () => {
    const w = createWorld({ seed: 2 });
    w.nextOrderTick = 1e9;
    w.automation.dispatch = 0;
    w.robots.length = 0;
    addRobot(w, 'amr', 8, 8); // 待機スポットの上なので park もしない
    addRobot(w, 'amr', 8, 8);
    const rt = createRuntime();
    const notices: string[] = [];
    for (let t = 0; t < PATHING.overlapHealTicks + 5; t++) {
      stepSim(w, rt);
      for (const e of w.events) if (e.type === 'notice') notices.push(e.text);
      w.events.length = 0;
    }
    expect(overlaps(w)).toBe(0);
    expect(notices.some((n) => n.includes('重なっていた'))).toBe(true);
    for (let t = 0; t < 100; t++) stepSim(w, rt);
    expect(overlaps(w)).toBe(0);
  });

  it('a robot bought onto a cell another robot is heading to makes that robot re-plan (no overlap on arrival)', () => {
    const w = createWorld({ seed: 3 });
    w.nextOrderTick = 1e9;
    w.automation.dispatch = 0;
    w.robots.length = 0;
    const a = addRobot(w, 'amr', 12, 10);
    a.job = { type: 'park', x: 8, z: 8, manual: false };
    const rt = createRuntime();
    for (let t = 0; t < 8; t++) stepSim(w, rt); // 動き出してから
    expect(a.goal).toMatchObject({ x: 8, z: 8 });
    const b = addRobot(w, 'amr', 8, 8); // 向かっている先に新しいロボを置く（購入と同じ）
    for (let t = 0; t < 400; t++) {
      stepSim(w, rt);
      expect(overlaps(w)).toBe(0);
    }
    // 新しいロボは「詰まったロボの目的地にいる暇なロボ」としてどかされてもよい。重ならないことが肝心
    expect(b.pose.x >= 0 && b.pose.z >= 0).toBe(true);
    expect(a.job === null || atGoal(w, a) || a.stuckTicks < 300).toBe(true);
  });
});

describe('stale carriers do not hide demand', () => {
  it('a bin held by a robot that has not moved for staleCarryTicks is not counted as "on its way"', () => {
    const w = createWorld({ seed: 4 });
    w.nextOrderTick = 1e9;
    w.rank = 1;
    w.automation.dispatch = 2;
    // りんごのビンを 2 つに（初期は 1 つ）
    const appleId = Number(Object.keys(w.bins).find((id) => w.bins[Number(id)].item === 'apple'));
    const second = createBin(w, 'apple', 10);
    const emptyStack = w.stacks.find((s) => s.bins.every((id) => !w.bins[id].item))!;
    emptyStack.bins.push(second.id);
    const [a, b] = [w.robots.find((r) => r.kind === 'shelf')!, addRobot(w, 'shelf', 5, 4)];
    // a は 1 つ目のりんごを持ったままポートへ行けずに固まっている
    const stack = w.stacks.find((s) => s.bins.includes(appleId))!;
    stack.bins.splice(stack.bins.indexOf(appleId), 1);
    a.carrying = [appleId];
    w.bins[appleId].purpose = 'pick';
    a.job = { type: 'retrieve', stackId: stack.id, binId: appleId, portId: w.ports[0].id, manual: false };
    a.step = 20;
    a.goal = { type: 'cell', x: w.ports[0].x, z: w.ports[0].z };
    a.stuckTicks = AUTOMATION.staleCarryTicks;
    w.orders.push({ id: 1, lines: [{ item: 'apple', qty: 1, picked: 0 }], arrivedTick: 0, shownTick: 0, penalized: false });
    const rt = createRuntime();
    stepSim(w, rt);
    expect(b.job?.type).toBe('retrieve');
    expect(b.job && b.job.type === 'retrieve' ? b.job.binId : -1).toBe(second.id);
  });

  it('an automatic retrieve that never picked up its bin is released after staleRetrieveTicks', () => {
    const w = createWorld({ seed: 5 });
    w.nextOrderTick = 1e9;
    const a = w.robots.find((r) => r.kind === 'shelf')!;
    const appleId = Number(Object.keys(w.bins).find((id) => w.bins[Number(id)].item === 'apple'));
    const stack = w.stacks.find((s) => s.bins.includes(appleId))!;
    a.job = { type: 'retrieve', stackId: stack.id, binId: appleId, portId: w.ports[0].id, manual: false };
    a.step = 0;
    a.goal = { type: 'cell', x: stack.x, z: stack.z };
    a.stuckTicks = AUTOMATION.staleRetrieveTicks;
    w.bins[appleId].purpose = 'pick';
    const rt = createRuntime();
    stepSim(w, rt);
    expect(a.job?.type ?? null).not.toBe('retrieve');
    expect(w.bins[appleId].purpose).toBeNull();
  });
});

describe('buying robots mid-run never creates an overlap (root cause of the stuck pairs in a player save)', () => {
  it('mega preset: robots are bought and the layout edited while the warehouse runs; no two robots ever share a cell', () => {
    const saved = PATHING.overlapHealTicks;
    PATHING.overlapHealTicks = 1e9; // 保険を切って、重なりが生まれないこと自体を確かめる
    try {
      const rng = createRng(2);
      let w = buildPreset('mega', { seed: 2 });
      w.coins = 1e9;
      let rt = createRuntime();
      for (let t = 0; t < 2500; t++) {
        stepSim(w, rt);
        const seen = new Map<string, number>();
        for (const r of w.robots) {
          for (const c of [r.pose, ...(r.moveTo ? [r.moveTo] : [])]) {
            const k = `${r.kind}:${c.x},${c.z}`;
            const o = seen.get(k);
            if (o !== undefined && o !== r.id) throw new Error(`tick ${w.tick}: robots ${o} and ${r.id} share ${k}`);
            seen.set(k, r.id);
          }
        }
        if (t % 150 === 0) {
          const roll = rand(rng);
          if (roll < 0.35) buyAmr(w);
          else if (roll < 0.6) buyShelfRobot(w);
          else if (roll < 0.75) {
            place(w, 'waitSpot', randInt(rng, 0, w.width - 1), randInt(rng, 17, 23));
            rt.dirty = true;
          } else if (roll < 0.85) {
            const res = deserialize(serialize(w));
            if (res.ok) {
              w = res.world;
              rt = createRuntime();
            }
          } else if (roll < 0.92) {
            expand(w, 'south');
            rt.dirty = true;
          } else buyEmptyBin(w);
        }
      }
      expect(w.robots.length).toBeGreaterThan(28);
    } finally {
      PATHING.overlapHealTicks = saved;
    }
  });
});
