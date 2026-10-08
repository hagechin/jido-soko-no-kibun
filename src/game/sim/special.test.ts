/**
 * I5: 特別ロボ（iOS の特別ロボパック）。
 * ドローン = 空中レイヤーの搬送ロボ（棚の上を飛び、ポート／ステーションの真上に着く、横付けの枠を使わない）。
 * ダブルデッカー = 2 段持ちの棚ロボ（1 個掘れば届くビンは退避の往復なし、深い掘り出しは 2 個ずつ）。
 */
import { describe, expect, it } from 'vitest';
import { ROBOT } from '../data/balance';
import { commandFetch, commandRetrieve } from './commands';
import { footprint } from './footprint';
import { cellAt, isFloorWalkable } from './grid';
import { layerOf, shapeOf, speedLevelOf } from './layers';
import { createRuntime, stepSim } from './sim';
import { buyDrone, buyDoubleDecker, buyAmr } from './shop';
import type { Robot, WorldState } from './types';
import { addRobot, createBin, createWorld } from './world';

function until(w: WorldState, rt: ReturnType<typeof createRuntime>, cond: () => boolean, maxTicks = 3000): number {
  let n = 0;
  while (!cond() && n < maxTicks) {
    stepSim(w, rt);
    n++;
  }
  return n;
}

function quiet(seed: number): WorldState {
  const w = createWorld({ seed });
  w.nextOrderTick = 1e9;
  w.coins = 1e7;
  return w;
}

/** 同じ層のロボが同じマスに居ない／通れないマスに居ないことを毎 tick 確かめる */
function checkLayers(w: WorldState): string | null {
  const seen = new Map<string, number>();
  for (const r of w.robots) {
    const cells = footprint(r.pose, shapeOf(r), []);
    if (r.moveTo) cells.push(...footprint(r.moveTo, shapeOf(r), []));
    for (const c of cells) {
      const k = `${layerOf(r)}:${c.x},${c.z}`;
      const o = seen.get(k);
      if (o !== undefined && o !== r.id) return `tick ${w.tick}: ${k} shared by ${o} and ${r.id}`;
      seen.set(k, r.id);
    }
    if (layerOf(r) === 'floor' && !isFloorWalkable(cellAt(w, r.pose.x, r.pose.z))) return `tick ${w.tick}: amr ${r.id} off the floor`;
    if (layerOf(r) === 'air' && (r.pose.x < 0 || r.pose.z < 0 || r.pose.x >= w.width || r.pose.z >= w.height)) return `tick ${w.tick}: drone ${r.id} out of bounds`;
  }
  return null;
}

describe('ドローン搬送ロボ（空中レイヤー）', () => {
  it('棚の上を飛び越えて、地上の搬送ロボが入れないスタックのマスにも行ける', () => {
    const w = quiet(1);
    const rt = createRuntime();
    const stack = w.stacks[Math.floor(w.stacks.length / 2)];
    const drone = addRobot(w, 'amr', w.waitSpots[0].x, w.waitSpots[0].z, 'drone');
    expect(layerOf(drone)).toBe('air');
    drone.job = { type: 'park', x: stack.x, z: stack.z, manual: true };
    const n = until(w, rt, () => drone.pose.x === stack.x && drone.pose.z === stack.z && !drone.moveTo, 1500);
    expect(n).toBeLessThan(1500);
    // 地上の搬送ロボは同じ指示でスタックの上には乗れない（通れないので動けない）
    const amr = w.robots.find((r) => r.kind === 'amr' && r.variant !== 'drone')!;
    amr.job = { type: 'park', x: stack.x, z: stack.z, manual: true };
    until(w, rt, () => false, 300);
    expect(amr.pose.x === stack.x && amr.pose.z === stack.z).toBe(false);
  });

  it('ポートの真上で積み、ステーションの真上で作業して出荷できる（横付けの枠を使わない）', () => {
    const w = quiet(2);
    const rt = createRuntime();
    w.orders.push({ id: 1, lines: [{ item: 'apple', qty: 2, picked: 0 }], arrivedTick: 0, shownTick: null, penalized: false });
    const shelf = w.robots.find((r) => r.kind === 'shelf')!;
    const stack = w.stacks.find((s) => s.bins.some((id) => w.bins[id].item === 'apple'))!;
    const binId = stack.bins.find((id) => w.bins[id].item === 'apple')!;
    const port = w.ports[0];
    // 地上の搬送ロボをポートの横付け枠いっぱいまで張り付かせておく（ドローンは影響を受けない）
    const amrs = w.robots.filter((r) => r.kind === 'amr');
    for (const a of amrs) a.job = { type: 'fetch', portId: port.id, manual: true, stationId: null };
    const drone = addRobot(w, 'amr', w.waitSpots[w.waitSpots.length - 1].x, w.waitSpots[w.waitSpots.length - 1].z, 'drone');
    commandRetrieve(w, rt, shelf.id, stack.id, binId);
    until(w, rt, () => port.outbound.includes(binId));
    for (const a of amrs) {
      a.job = null; // 地上ロボには積ませない
      a.queue = [];
    }
    expect(commandFetch(w, rt, drone.id, port.id)).toEqual({ ok: true });
    const t = until(w, rt, () => drone.carrying.includes(binId), 1500);
    expect(t).toBeLessThan(1500);
    // 積むときはポートのマスの真上
    expect(drone.pose.x === port.x && drone.pose.z === port.z).toBe(true);
    const t2 = until(w, rt, () => w.stats.totalShipped === 1, 2500);
    expect(t2).toBeLessThan(2500);
    expect(w.bins[binId].qty).toBe(18);
    // 運んだ数: 棚ロボはポートに置いた 1 回、ドローンはポートへ返した時点で 1 回
    expect(shelf.carried).toBe(1);
    until(w, rt, () => (drone.carried ?? 0) >= 1, 1500);
    expect(drone.carried).toBe(1);
  });

  it('ドローン同士は空中で重ならず、地上・レールのロボとは層が違うので無関係', () => {
    const w = quiet(3);
    const rt = createRuntime();
    const drones: Robot[] = [];
    for (let i = 0; i < 4; i++) drones.push(addRobot(w, 'amr', i, 0, 'drone'));
    // 4 台を対角へ交差させる
    const goals = [
      { x: w.width - 1, z: w.height - 1 },
      { x: 0, z: w.height - 1 },
      { x: w.width - 1, z: 0 },
      { x: 0, z: 0 },
    ];
    drones.forEach((d, i) => (d.job = { type: 'park', x: goals[i].x, z: goals[i].z, manual: true }));
    // 着いたら自動化が待機スポットへ戻すので、「一度でも着いた」を記録する
    const reached = drones.map(() => false);
    for (let t = 0; t < 1500; t++) {
      stepSim(w, rt);
      const err = checkLayers(w);
      expect(err).toBeNull();
      drones.forEach((d, i) => {
        if (d.pose.x === goals[i].x && d.pose.z === goals[i].z) reached[i] = true;
      });
      if (reached.every(Boolean)) break;
    }
    expect(reached).toEqual([true, true, true, true]);
  });

  it('自動配車: 暇な地上ロボが先にいても、出庫ビンはドローンが先に取りに行く', () => {
    const w = quiet(5);
    const rt = createRuntime();
    w.automation.dispatch = 1;
    const port = w.ports[0];
    const bin = createBin(w, 'apple', 10);
    bin.purpose = 'pick';
    port.outbound.push(bin.id);
    // 地上ロボ（id が若い）は全員暇。ドローンは最後に追加する
    const drone = addRobot(w, 'amr', w.waitSpots[0].x, w.waitSpots[0].z, 'drone');
    stepSim(w, rt);
    expect(drone.job?.type).toBe('fetch');
    const ground = w.robots.filter((r) => r.kind === 'amr' && r.variant !== 'drone');
    expect(ground.some((r) => r.job?.type === 'fetch')).toBe(false);
  });

  it('自動配車: ドローンは近さより「拾われていないビンが一番多いポート」へ向かう', () => {
    const w = quiet(6);
    const rt = createRuntime();
    w.automation.dispatch = 1;
    w.robots = w.robots.filter((r) => r.kind !== 'amr'); // 地上ロボ抜き
    const [near, far] = [w.ports[0], w.ports[w.ports.length - 1]];
    for (let i = 0; i < 3; i++) {
      const b = createBin(w, 'apple', 10);
      b.purpose = 'pick';
      far.outbound.push(b.id);
    }
    const b = createBin(w, 'apple', 10);
    b.purpose = 'pick';
    near.outbound.push(b.id);
    const drone = addRobot(w, 'amr', near.x, near.z, 'drone');
    stepSim(w, rt);
    expect(drone.job?.type).toBe('fetch');
    expect((drone.job as { portId: number }).portId).toBe(far.id);
  });

  it('暇なドローンは待機スポットではなくポートの真上でホバリングして待つ', () => {
    const w = quiet(7);
    const rt = createRuntime();
    w.automation.dispatch = 1;
    const drone = addRobot(w, 'amr', w.waitSpots[0].x, w.waitSpots[0].z, 'drone');
    const n = until(w, rt, () => w.ports.some((p) => p.x === drone.pose.x && p.z === drone.pose.z) && !drone.moveTo, 1500);
    expect(n).toBeLessThan(1500);
    until(w, rt, () => false, 50);
    expect(w.ports.some((p) => p.x === drone.pose.x && p.z === drone.pose.z)).toBe(true);
  });

  it('ドローンは速度 Lv が 1 段階上（上限は maxSpeedLevel）', () => {
    expect(speedLevelOf({ variant: 'drone', speedLevel: 0 })).toBe(Math.min(ROBOT.maxSpeedLevel, ROBOT.droneSpeedBonus));
    expect(speedLevelOf({ variant: 'drone', speedLevel: ROBOT.maxSpeedLevel })).toBe(ROBOT.maxSpeedLevel);
    expect(speedLevelOf({ variant: 'standard', speedLevel: 0 })).toBe(0);
  });

  it('購入: 上限 4 台。搬送ロボの上限とは別枠', () => {
    const w = quiet(4);
    let n = 0;
    while (buyDrone(w).ok) n++;
    expect(n).toBe(ROBOT.maxDrones);
    expect(buyDrone(w).ok).toBe(false);
    expect(w.robots.filter((r) => r.variant === 'drone').map((r) => r.name)).toEqual(['ドローン 1', 'ドローン 2', 'ドローン 3', 'ドローン 4']);
    expect(buyAmr(w).ok).toBe(true); // 地上の搬送ロボは別に数える
  });
});

describe('ダブルデッカー棚ロボ（2 段持ち）', () => {
  function setupDig(seed: number, depth: 1 | 2, variant: 'standard' | 'double') {
    const w = quiet(seed);
    const rt = createRuntime();
    // 既存の棚ロボを消し、変種を 1 台だけ置く
    w.robots = w.robots.filter((r) => r.kind !== 'shelf');
    w.levels = 4;
    const stack = w.stacks[0];
    while (stack.bins.length < depth + 1) stack.bins.push(createBin(w, 'banana', 10).id);
    const target = stack.bins[stack.bins.length - 1 - depth];
    const above = stack.bins.slice(stack.bins.length - depth);
    const other = w.stacks.find((s) => s !== stack)!;
    const shelf = addRobot(w, 'shelf', other.x, other.z, variant);
    const port = w.ports[0];
    expect(commandRetrieve(w, rt, shelf.id, stack.id, target)).toEqual({ ok: true });
    const ticks = until(w, rt, () => port.outbound.includes(target), 3000);
    return { w, stack, target, above, ticks, shelf };
  }

  it('目的ビンの上が 1 個なら、退避先を使わずに取り出し、上のビンは元のスタックに残る', () => {
    const std = setupDig(11, 1, 'standard');
    const dd = setupDig(11, 1, 'double');
    expect(dd.ticks).toBeLessThan(3000);
    // ダブルデッカー: 上のビンは元のスタックの頂上に戻っている
    expect(dd.stack.bins[dd.stack.bins.length - 1]).toBe(dd.above[0]);
    expect(dd.stack.bins).not.toContain(dd.target);
    // 標準: 上のビンは別のスタックへ退避したまま
    expect(std.stack.bins).not.toContain(std.above[0]);
    expect(std.w.stacks.some((s) => s !== std.stack && s.bins.includes(std.above[0]))).toBe(true);
    expect(dd.ticks).toBeLessThan(std.ticks);
    expect(dd.shelf.carrying).toHaveLength(0);
  });

  it('上が 2 個なら 2 個まとめて退避して 1 往復で済ませる', () => {
    const std = setupDig(12, 2, 'standard');
    const dd = setupDig(12, 2, 'double');
    expect(dd.ticks).toBeLessThan(3000);
    expect(dd.stack.bins).not.toContain(dd.target);
    // 2 個とも同じ退避先に並んでいる（1 往復）
    const temp = dd.w.stacks.find((s) => s !== dd.stack && s.bins.includes(dd.above[0]))!;
    expect(temp.bins).toContain(dd.above[1]);
    expect(dd.ticks).toBeLessThan(std.ticks);
    expect(dd.shelf.carrying).toHaveLength(0);
  });

  it('購入: 棚ロボの上限に含まれ、名前はダブルデッカー', () => {
    const w = quiet(13);
    expect(buyDoubleDecker(w).ok).toBe(true);
    const dd = w.robots.find((r) => r.variant === 'double')!;
    expect(dd.kind).toBe('shelf');
    expect(dd.name).toBe('ダブルデッカー 1');
    expect(layerOf(dd)).toBe('rail');
  });
});
