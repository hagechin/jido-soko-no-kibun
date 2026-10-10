/**
 * ロボ紹介のミニ倉庫（/embed/mini-warehouse.html?demo=shelf|double|amr|drone）。
 * 出荷までつなげず、「離れたスタックや場所まで運んで戻す」を無限に繰り返して、役割と強化の違いを見せる。
 * 速度・リフトの秒数はゲームの定数（ROBOT.moveTicksByLevel / liftTicksByLevel）から取る。
 */
import { Vector3 } from 'three';
import { RENDER, ROBOT } from '../data/balance';
import {
  BH,
  Bin,
  COLORS,
  Label,
  Stack,
  Stage,
  buildFloor,
  buildRails,
  cellsPerSec,
  drive,
  fly,
  liftSec,
  makeAmr,
  makeDrone,
  makeShelfRobot,
  makeStation,
  moveTo,
  railHeightFor,
  wait,
} from './engine';
import type { Object3D } from 'three';
import { tr } from '../i18n';

export type RobotDemo = 'shelf' | 'double' | 'amr' | 'drone';

const ITEMS = ['apple', 'book', 'mug', 'plant', 'ball', 'plush', 'cake', 'lamp'];

function runLoop(stage: Stage, fn: () => Promise<void>, delay = 0.6): void {
  void (async () => {
    await wait(delay);
    while (stage.running) await fn();
  })();
}

/** 棚ロボの上げ下ろし。slot は本体の下の段（0 = すぐ下、1 = その下） */
function shelfLift(robot: Object3D, bin: Bin, slot: number, sec: number): Promise<void> {
  robot.attach(bin);
  return moveTo(bin, 0, -BH * (slot + 1), 0, sec);
}
async function shelfLower(scene: Object3D, robot: Object3D, bin: Bin, worldY: number, sec: number, x: number, z: number): Promise<void> {
  await moveTo(bin, 0, worldY - robot.position.y, 0, sec);
  scene.attach(bin);
  bin.position.set(x + 0.5, worldY, z + 0.5);
  bin.rotation.set(0, 0, 0);
}

// ---- 棚ロボ: 速度とリフトの強化 ----
function shelfDemo(stage: Stage): void {
  const W = 10;
  const H = 6;
  const ROWS = [
    { z: 1, speed: 0, lift: 0, label: tr('速度 Lv1・リフト Lv1') },
    { z: 4, speed: 3, lift: 3, label: tr('速度 Lv4・リフト Lv4（最大強化）') },
  ];
  const PORT_X = 1;
  const STACK_XS = [3, 4, 5, 6, 7, 8];
  const LEVELS = 3;
  const railH = railHeightFor(LEVELS);
  const tiles = new Map<string, string>();
  const stackCells: { x: number; z: number }[] = [];
  const railCells: { x: number; z: number }[] = [];
  for (const r of ROWS) {
    tiles.set(`${PORT_X},${r.z}`, COLORS.port);
    railCells.push({ x: PORT_X, z: r.z }, { x: 2, z: r.z });
    for (const x of STACK_XS) {
      tiles.set(`${x},${r.z}`, COLORS.stackTile);
      stackCells.push({ x, z: r.z });
      railCells.push({ x, z: r.z });
    }
  }
  buildFloor(stage.scene, { W, H, tiles, stacks: stackCells });
  buildRails(stage.scene, railCells, railH);

  ROWS.forEach((r, ri) => {
    const stacks = STACK_XS.map((x) => new Stack(x, r.z));
    stacks.forEach((s, i) => {
      for (let k = 0; k < 2; k++) {
        const b = new Bin(ITEMS[(i + k * 3) % ITEMS.length]);
        b.position.set(s.x + 0.5, s.levelY(k), s.z + 0.5);
        stage.scene.add(b);
        s.bins.push(b);
      }
    });
    const robot = makeShelfRobot(COLORS.shelfRobot, false, railH);
    robot.position.x = PORT_X + 0.5;
    robot.position.z = r.z + 0.5;
    stage.scene.add(robot);
    const label = new Label(tr('{0} ｜ 運んだ 0', r.label), 4.2);
    label.position.set(ri === 0 ? 3.5 : 6.5, railH + 1.2 + ri * 1.0, r.z + 0.5);
    stage.scene.add(label);
    let carried = 0;
    const speed = cellsPerSec(r.speed);
    const lift = liftSec(r.lift);
    let k = 0;
    runLoop(
      stage,
      async () => {
        const s = stacks[(stacks.length - 1 - k) % stacks.length];
        k++;
        await drive(robot, s.x, s.z, speed);
        const bin = s.bins.pop()!;
        await shelfLift(robot, bin, 0, lift);
        await drive(robot, PORT_X, s.z, speed);
        await shelfLower(stage.scene, robot, bin, 0, lift, PORT_X, s.z);
        carried++;
        label.setText(tr('{0} ｜ 運んだ {1}', r.label, carried));
        await wait(0.5);
        await shelfLift(robot, bin, 0, lift);
        await drive(robot, s.x, s.z, speed);
        await shelfLower(stage.scene, robot, bin, s.levelY(s.bins.length), lift, s.x, s.z);
        s.bins.push(bin);
      },
      0.6 + ri * 0.3,
    );
  });
}

// ---- ダブルデッカー: 退避なしで掘り出す ----
function doubleDemo(stage: Stage): void {
  const W = 9;
  const H = 6;
  const ROWS = [
    { z: 1, double: false, label: tr('標準の棚ロボ（上のビンを隣へ退避してから）') },
    { z: 4, double: true, label: tr('ダブルデッカー（2 段持ち。退避なし）') },
  ];
  const PORT_X = 1;
  const STACK_XS = [3, 4, 5, 6];
  const railH = railHeightFor(4);
  const tiles = new Map<string, string>();
  const stackCells: { x: number; z: number }[] = [];
  const railCells: { x: number; z: number }[] = [];
  for (const r of ROWS) {
    tiles.set(`${PORT_X},${r.z}`, COLORS.port);
    railCells.push({ x: PORT_X, z: r.z }, { x: 2, z: r.z });
    for (const x of STACK_XS) {
      tiles.set(`${x},${r.z}`, COLORS.stackTile);
      stackCells.push({ x, z: r.z });
      railCells.push({ x, z: r.z });
    }
  }
  buildFloor(stage.scene, { W, H, tiles, stacks: stackCells });
  buildRails(stage.scene, railCells, railH);

  ROWS.forEach((r, ri) => {
    const [s3, s4, s5, s6] = STACK_XS.map((x) => new Stack(x, r.z));
    const put = (s: Stack, item: string): void => {
      const b = new Bin(item);
      b.position.set(s.x + 0.5, s.levelY(s.bins.length), s.z + 0.5);
      stage.scene.add(b);
      s.bins.push(b);
    };
    put(s3, 'mug');
    put(s4, 'plant');
    put(s5, 'apple'); // 目的のビン（下）
    put(s5, 'book'); // 上に載っているビン
    put(s6, 'ball');
    put(s6, 'lamp');
    const robot = makeShelfRobot(r.double ? COLORS.doubleDecker : COLORS.shelfRobot, r.double, railH);
    robot.position.x = PORT_X + 0.5;
    robot.position.z = r.z + 0.5;
    stage.scene.add(robot);
    const label = new Label(tr('{0} ｜ 取り出した 0', r.label), 4.6);
    label.position.set(ri === 0 ? 3 : 5.5, railH + 1.2 + ri * 1.0, r.z + 0.5);
    stage.scene.add(label);
    const speed = cellsPerSec(1);
    const lift = liftSec(1);
    let n = 0;
    const z = r.z;
    runLoop(
      stage,
      async () => {
        const top = s5.bins[1];
        const target = s5.bins[0];
        await drive(robot, s5.x, z, speed);
        if (!r.double) {
          // 退避: 上のビンを隣のスタックへ
          s5.bins.pop();
          await shelfLift(robot, top, 0, lift);
          await drive(robot, s4.x, z, speed);
          await shelfLower(stage.scene, robot, top, s4.levelY(s4.bins.length), lift, s4.x, z);
          s4.bins.push(top);
          await drive(robot, s5.x, z, speed);
          s5.bins.pop();
          await shelfLift(robot, target, 0, lift);
          await drive(robot, PORT_X, z, speed);
          await shelfLower(stage.scene, robot, target, 0, lift, PORT_X, z);
          n++;
          label.setText(tr('{0} ｜ 取り出した {1}', r.label, n));
          await wait(0.6);
          // 戻す: 目的のビンを戻し、退避したビンを上に
          await shelfLift(robot, target, 0, lift);
          await drive(robot, s5.x, z, speed);
          await shelfLower(stage.scene, robot, target, s5.levelY(0), lift, s5.x, z);
          s5.bins.push(target);
          await drive(robot, s4.x, z, speed);
          s4.bins.pop();
          await shelfLift(robot, top, 0, lift);
          await drive(robot, s5.x, z, speed);
          await shelfLower(stage.scene, robot, top, s5.levelY(1), lift, s5.x, z);
          s5.bins.push(top);
        } else {
          // 2 段持ち: 上のビンを持ったまま目的のビンも持ち上げる
          s5.bins.length = 0;
          await shelfLift(robot, top, 0, lift);
          await shelfLift(robot, target, 1, lift);
          await drive(robot, PORT_X, z, speed);
          await shelfLower(stage.scene, robot, target, 0, lift, PORT_X, z);
          n++;
          label.setText(tr('{0} ｜ 取り出した {1}', r.label, n));
          await wait(0.6);
          await shelfLift(robot, target, 1, lift);
          await drive(robot, s5.x, z, speed);
          await shelfLower(stage.scene, robot, target, s5.levelY(0), lift, s5.x, z);
          await shelfLower(stage.scene, robot, top, s5.levelY(1), lift, s5.x, z);
          s5.bins.push(target, top);
        }
      },
      0.6 + ri * 0.3,
    );
  });
}

// ---- 搬送ロボ: 積載と速度の強化 ----
function amrDemo(stage: Stage): void {
  const W = 11;
  const H = 7;
  const LANES = [
    { z: 1, speed: 0, cargo: 0, label: tr('積載 Lv1（1 ビン）・速度 Lv1'), lx: 2.5, ly: 2.0 },
    { z: 3, speed: 2, cargo: 2, label: tr('積載 Lv3（4 ビン）・速度 Lv3'), lx: 5.5, ly: 2.8 },
    { z: 5, speed: 3, cargo: 3, label: tr('積載 Lv4（8 ビン・上限突破）・速度 Lv4'), lx: 8.5, ly: 4.4 },
  ];
  const PILE_XS = [0, 1, 2, 3];
  const STOP_X = 8;
  const STATION_X = 9;
  const DROP_XS = [8, 9];
  const tiles = new Map<string, string>();
  for (const l of LANES) {
    for (const x of PILE_XS) tiles.set(`${x},${l.z}`, COLORS.port);
    tiles.set(`${STATION_X},${l.z}`, COLORS.stationTile);
    tiles.set(`${STOP_X},${l.z}`, COLORS.waitSpot);
    for (const x of DROP_XS) tiles.set(`${x},${l.z - 1}`, COLORS.stationTile);
  }
  buildFloor(stage.scene, { W, H, tiles });

  LANES.forEach((l, li) => {
    makeStation(stage.scene, STATION_X, l.z);
    // 入荷口側の山: 4 か所 × 2 段 = 8 ビン。ステーション側の置き場: 2 か所 × 4 段
    const piles: Bin[][] = PILE_XS.map(() => []);
    const drops: Bin[][] = DROP_XS.map(() => []);
    PILE_XS.forEach((x, i) => {
      for (let k = 0; k < 2; k++) {
        const b = new Bin(ITEMS[(i * 2 + k) % ITEMS.length]);
        b.position.set(x + 0.5, k * BH, l.z + 0.5);
        stage.scene.add(b);
        piles[i].push(b);
      }
    });
    const robot = makeAmr();
    robot.position.set(4.5, 0, l.z + 0.5);
    stage.scene.add(robot);
    const label = new Label(tr('{0} ｜ 届けた 0', l.label), 4.2);
    label.position.set(l.lx, l.ly, l.z + 0.5);
    stage.scene.add(label);
    const speed = cellsPerSec(l.speed);
    const cap = ROBOT.cargo[l.cargo].bins;
    const loadSec = ROBOT.loadTicksPerBin / 10;
    let delivered = 0;
    const carried: Bin[] = [];
    const load = async (from: Bin[]): Promise<void> => {
      const b = from.pop()!;
      robot.attach(b);
      carried.push(b);
      await moveTo(b, 0, 0.4 + (carried.length - 1) * BH * 0.95, 0, loadSec);
    };
    const unload = async (to: Bin[], x: number, z: number): Promise<void> => {
      const b = carried.pop()!;
      stage.scene.attach(b);
      await moveTo(b, x + 0.5, to.length * BH, z + 0.5, loadSec);
      b.rotation.set(0, 0, 0);
      to.push(b);
    };
    /** from の山から積めるだけ積み、to の置き場へ運んで下ろす。from が空になるまで往復 */
    const haul = async (from: Bin[][], fromCells: [number, number][], to: Bin[][], toCells: [number, number][], toCap: number, stopCell: [number, number] | null, count: boolean): Promise<void> => {
      while (from.some((p) => p.length)) {
        for (let i = 0; i < from.length; i++) {
          if (carried.length >= cap || !from[i].length) continue;
          await drive(robot, fromCells[i][0], fromCells[i][1], speed);
          while (carried.length < cap && from[i].length) await load(from[i]);
        }
        const n = carried.length;
        if (stopCell) await drive(robot, stopCell[0], stopCell[1], speed);
        for (let i = 0; i < to.length; i++) {
          if (!carried.length || to[i].length >= toCap) continue;
          if (!stopCell) await drive(robot, toCells[i][0], toCells[i][1], speed);
          while (carried.length && to[i].length < toCap) await unload(to[i], toCells[i][0], toCells[i][1]);
        }
        if (count) {
          delivered += n;
          label.setText(tr('{0} ｜ 届けた {1}', l.label, delivered));
        }
        await wait(0.4);
      }
    };
    const pileCells: [number, number][] = PILE_XS.map((x) => [x, l.z]);
    const dropCells: [number, number][] = DROP_XS.map((x) => [x, l.z - 1]);
    runLoop(
      stage,
      async () => {
        await haul(piles, pileCells, drops, dropCells, 4, [STOP_X, l.z], true);
        await haul(drops, dropCells, piles, pileCells, 2, null, false);
      },
      0.6 + li * 0.3,
    );
  });
}

// ---- ドローン: 棚の上を飛んで渋滞を避ける ----
function droneDemo(stage: Stage): void {
  const W = 12;
  const H = 7;
  const PORT = { x: 1, z: 3 };
  const STATION = { x: 10, z: 3 };
  const STOP = { x: 9, z: 3 };
  const LANE_Z = 6;
  const stackCells: { x: number; z: number }[] = [];
  for (let x = 4; x <= 7; x++) for (let z = 1; z <= 4; z++) stackCells.push({ x, z });
  const LEVELS = 3;
  const railH = railHeightFor(LEVELS);
  const tiles = new Map<string, string>();
  tiles.set(`${PORT.x},${PORT.z}`, COLORS.port);
  tiles.set(`${PORT.x},${PORT.z - 1}`, COLORS.port);
  tiles.set(`${STATION.x},${STATION.z}`, COLORS.stationTile);
  tiles.set(`${STOP.x},${STOP.z}`, COLORS.waitSpot);
  tiles.set(`${STOP.x},${STOP.z + 1}`, COLORS.waitSpot);
  tiles.set(`${STOP.x},${STOP.z + 2}`, COLORS.waitSpot);
  for (const c of stackCells) tiles.set(`${c.x},${c.z}`, COLORS.stackTile);
  buildFloor(stage.scene, { W, H, tiles, stacks: stackCells });
  buildRails(stage.scene, [...stackCells, { x: 3, z: 2 }, { x: 3, z: 3 }], railH);
  makeStation(stage.scene, STATION.x, STATION.z);
  stackCells.forEach((c, i) => {
    const n = 1 + ((i * 7) % 3);
    for (let k = 0; k < n; k++) {
      const b = new Bin(ITEMS[(i + k) % ITEMS.length]);
      b.position.set(c.x + 0.5, RENDER.railBaseHeight + k * BH, c.z + 0.5);
      stage.scene.add(b);
    }
  });
  // 順番待ちの搬送ロボ（飾り）
  for (const z of [STOP.z + 1, STOP.z + 2]) {
    const r = makeAmr();
    r.position.set(STOP.x + 0.5, 0, z + 0.5);
    r.rotation.y = Math.PI;
    stage.scene.add(r);
  }
  // 棚ロボ（飾り: 行ったり来たり）
  const shelf = makeShelfRobot(COLORS.shelfRobot, false, railH);
  shelf.position.set(5.5, railH, 2.5);
  stage.scene.add(shelf);
  runLoop(stage, async () => {
    await drive(shelf, 7, 2, cellsPerSec(1));
    await wait(0.8);
    await drive(shelf, 4, 4, cellsPerSec(1), railH, true);
    await wait(0.8);
  });

  const amr = makeAmr();
  amr.position.set(PORT.x + 0.5, 0, PORT.z + 0.5);
  stage.scene.add(amr);
  const amrBin = new Bin('apple');
  amrBin.position.set(PORT.x + 0.5, 0, PORT.z + 0.5);
  stage.scene.add(amrBin);
  const amrLabel = new Label(tr('搬送ロボ（床を走る）｜ 届けた 0'), 4);
  amrLabel.position.set(PORT.x + 0.5, 2.0, LANE_Z - 0.5);
  stage.scene.add(amrLabel);

  const { group: drone, rotors } = makeDrone();
  const droneY = railH + RENDER.shelfRobotHeight + RENDER.droneClearance + RENDER.droneHangerLength + BH;
  drone.position.set(PORT.x + 0.5, droneY, PORT.z - 0.5);
  stage.scene.add(drone);
  const droneBin = new Bin('book');
  droneBin.position.set(PORT.x + 0.5, 0, PORT.z - 0.5);
  stage.scene.add(droneBin);
  const droneLabel = new Label(tr('ドローン（棚の上を飛ぶ・速度 +1）｜ 届けた 0'), 4.6);
  droneLabel.position.set(5.5, droneY + 1.0, 0.5);
  stage.scene.add(droneLabel);
  stage.onFrame((dt) => {
    for (const h of rotors) h.rotation.y += dt * 40 * (h as unknown as { spinDir: number }).spinDir;
  });

  const amrSpeed = cellsPerSec(0);
  const droneSpeed = cellsPerSec(ROBOT.droneSpeedBonus);
  const loadSec = ROBOT.loadTicksPerBin / 10;
  let amrN = 0;
  let droneN = 0;
  // 搬送ロボ: 南の通路を回って届ける
  runLoop(stage, async () => {
    amr.attach(amrBin);
    await moveTo(amrBin, 0, 0.4, 0, loadSec);
    await drive(amr, PORT.x, LANE_Z, amrSpeed);
    await drive(amr, STOP.x, LANE_Z, amrSpeed);
    await drive(amr, STOP.x, STOP.z, amrSpeed);
    await moveTo(amrBin, 0.9, 0, 0, loadSec);
    stage.scene.attach(amrBin);
    amrN++;
    amrLabel.setText(tr('搬送ロボ（床を走る）｜ 届けた {0}', amrN));
    await wait(0.8);
    amr.attach(amrBin);
    await moveTo(amrBin, 0, 0.4, 0, loadSec);
    await drive(amr, STOP.x, LANE_Z, amrSpeed);
    await drive(amr, PORT.x, LANE_Z, amrSpeed);
    await drive(amr, PORT.x, PORT.z, amrSpeed);
    await moveTo(amrBin, 0, 0, 0, loadSec);
    stage.scene.attach(amrBin);
    await wait(0.8);
  });
  // ドローン: まっすぐ飛ぶ。荷物は本体の下にぶら下げる
  const hang = -(RENDER.droneHangerLength + BH);
  runLoop(stage, async () => {
    drone.attach(droneBin);
    await moveTo(droneBin, 0, hang, 0, 0.8);
    await fly(drone, STATION.x, STATION.z - 1, droneSpeed);
    await moveTo(droneBin, 0, -droneY, 0, 0.8);
    stage.scene.attach(droneBin);
    droneN++;
    droneLabel.setText(tr('ドローン（棚の上を飛ぶ・速度 +1）｜ 届けた {0}', droneN));
    await wait(0.8);
    drone.attach(droneBin);
    await moveTo(droneBin, 0, hang, 0, 0.8);
    await fly(drone, PORT.x, PORT.z - 1, droneSpeed);
    await moveTo(droneBin, 0, -droneY, 0, 0.8);
    stage.scene.attach(droneBin);
    await wait(0.8);
  });
}

const DEMOS: Record<RobotDemo, { W: number; H: number; radius: number; elev: number; build: (s: Stage) => void }> = {
  shelf: { W: 10, H: 6, radius: 13, elev: 50, build: shelfDemo },
  double: { W: 9, H: 6, radius: 12.5, elev: 50, build: doubleDemo },
  amr: { W: 11, H: 7, radius: 14.5, elev: 52, build: amrDemo },
  drone: { W: 12, H: 7, radius: 15.5, elev: 48, build: droneDemo },
};

export function startRobotDemo(canvas: HTMLCanvasElement, demo: RobotDemo, background: string | null): () => void {
  const d = DEMOS[demo];
  const stage = new Stage(canvas, { background, W: d.W, H: d.H, center: new Vector3(d.W / 2, 0.6, d.H / 2), radius: d.radius, elev: d.elev, orbitSec: 80 });
  d.build(stage);
  return () => stage.dispose();
}
