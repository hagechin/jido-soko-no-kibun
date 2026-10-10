/**
 * LP 用のミニ倉庫（/embed/mini-warehouse.html）。
 * 定型の流れを無限に再生する:
 *   入荷（トラック → 入荷口）→ 搬送ロボがポートへ → 棚ロボが収納 → 棚ロボが別の商品をポートへ
 *   → 搬送ロボがピッカーへ → ピッカーが梱包して出荷 → 空ビンを入荷口へ戻す（次の入荷に使う）
 * 商品 4 種・スタック 6（1 列）・ポート 1。各スタックは「その商品の置き場」で、4 回の出荷で在庫の高さが元に戻る。
 * ?demo=shelf|double|amr|drone はロボ紹介（robots.ts）。
 */
import { Vector3 } from 'three';
import { RENDER } from '../data/balance';
import { itemDef } from '../data/items';
import { BH, Bin, COLORS, Stack, Stage, box, buildFloor, buildRails, drive, easeInOut, linear, makeAmr, makeShelfRobot, makeStation, makeTruck, mat, moveTo, railHeightFor, wait } from './engine';
import { startRobotDemo, type RobotDemo } from './robots';

const W = 9;
const H = 5;
const ITEM_IDS = ['apple', 'book', 'mug', 'plant'] as const;
const DOCK = { x: 0, z: 1 };
const PORT = { x: 2, z: 1 };
const WAIT = { x: 1, z: 2 };
const STATION = { x: 2, z: 3 };
const AMR_HOME = WAIT;
const STACKS = [3, 4, 5, 6, 7, 8].map((x) => ({ x, z: 1 }));
const LEVELS = 3;
const RAIL_H = railHeightFor(LEVELS);
const AMR_SPEED = 1.6;
const SHELF_SPEED = 1.8;
const TRUCK_SPEED = 3;

export function startMiniWarehouse(canvas: HTMLCanvasElement, opts: { background?: string | null; demo?: string | null } = {}): () => void {
  const demo = opts.demo;
  if (demo === 'shelf' || demo === 'double' || demo === 'amr' || demo === 'drone') return startRobotDemo(canvas, demo as RobotDemo, opts.background ?? null);

  const stage = new Stage(canvas, { background: opts.background, W, H, center: new Vector3(W / 2 - 0.4, 0.4, H / 2 - 0.2), radius: 12.5, elev: 52, orbitSec: 70 });
  const scene = stage.scene;

  const tiles = new Map<string, string>();
  for (const s of STACKS) tiles.set(`${s.x},${s.z}`, COLORS.stackTile);
  tiles.set(`${PORT.x},${PORT.z}`, COLORS.port);
  tiles.set(`${WAIT.x},${WAIT.z}`, COLORS.waitSpot);
  tiles.set(`${STATION.x},${STATION.z}`, COLORS.stationTile);
  tiles.set(`${DOCK.x},${DOCK.z}`, COLORS.dockIn);
  buildFloor(scene, { W, H, tiles, stacks: STACKS, gaps: { west: [DOCK.z, STATION.z] } });
  buildRails(scene, [...STACKS, PORT], RAIL_H);
  makeStation(scene, STATION.x, STATION.z);
  const cz = STATION.z + 0.5;
  // コンベア（机の西側から壁の外へ）
  box(scene, (STATION.x + 0.05) / 2, 0.3, cz, STATION.x + 0.05, 0.08, 0.5, '#8a9099');
  // 入荷口の印
  box(scene, DOCK.x + 0.5, 0.02, DOCK.z + 0.5, 0.9, 0.04, 0.9, '#5f7389');

  const stacks = STACKS.map((s) => new Stack(s.x, s.z));
  function newBin(item: string | null): Bin {
    const b = new Bin(item);
    scene.add(b);
    return b;
  }
  function placeOnStack(stack: Stack, bin: Bin): void {
    scene.attach(bin);
    bin.position.set(stack.x + 0.5, stack.levelY(stack.bins.length), stack.z + 0.5);
    bin.rotation.set(0, 0, 0);
    stack.bins.push(bin);
  }
  // 初期在庫: スタック 0〜3 は商品 0〜3 の置き場（2 段）、4・5 は予備の在庫
  const initial: string[][] = [
    [ITEM_IDS[0], ITEM_IDS[0]],
    [ITEM_IDS[1], ITEM_IDS[1]],
    [ITEM_IDS[2], ITEM_IDS[2]],
    [ITEM_IDS[3], ITEM_IDS[3]],
    [ITEM_IDS[1], ITEM_IDS[2], ITEM_IDS[0]],
    [ITEM_IDS[3], ITEM_IDS[1]],
  ];
  initial.forEach((items, i) => items.forEach((it) => placeOnStack(stacks[i], newBin(it))));

  const shelf = makeShelfRobot(COLORS.shelfRobot, false, RAIL_H);
  shelf.position.x = STACKS[2].x + 0.5;
  shelf.position.z = STACKS[2].z + 0.5;
  scene.add(shelf);
  const amr = makeAmr();
  amr.position.set(AMR_HOME.x + 0.5, 0, AMR_HOME.z + 0.5);
  scene.add(amr);
  const truck = makeTruck();
  truck.position.set(-1.2, 0, -6);
  scene.add(truck);
  const parcel = box(scene, 0, 0, 0, 0.42, 0.32, 0.42, COLORS.parcel);
  parcel.visible = false;
  const picked = box(scene, 0, 0, 0, 0.22, 0.22, 0.22, '#fff');
  picked.visible = false;

  const shelfDrive = (x: number, z: number) => drive(shelf, x, z, SHELF_SPEED, RAIL_H);
  const amrDrive = (x: number, z: number, zFirst = false) => drive(amr, x, z, AMR_SPEED, 0, zFirst);

  async function shelfTake(stack: Stack): Promise<Bin> {
    const bin = stack.bins.pop()!;
    shelf.attach(bin);
    await moveTo(bin, 0, -BH, 0, 0.9);
    return bin;
  }
  async function shelfPut(bin: Bin, stack: Stack): Promise<void> {
    await moveTo(bin, 0, stack.levelY(stack.bins.length) - RAIL_H, 0, 0.9);
    placeOnStack(stack, bin);
  }
  async function shelfToPort(bin: Bin): Promise<void> {
    await moveTo(bin, 0, -RAIL_H, 0, 1.1);
    scene.attach(bin);
    bin.position.set(PORT.x + 0.5, 0, PORT.z + 0.5);
    bin.rotation.set(0, 0, 0);
  }
  async function shelfFromPort(bin: Bin): Promise<void> {
    shelf.attach(bin);
    await moveTo(bin, 0, -BH, 0, 1.1);
  }
  async function amrLoad(bin: Bin): Promise<void> {
    amr.attach(bin);
    await moveTo(bin, 0, 0.4, 0, 0.35);
  }
  async function amrUnload(bin: Bin, x: number, z: number): Promise<void> {
    await moveTo(bin, 0, 0, 0, 0.35);
    scene.attach(bin);
    bin.position.set(x + 0.5, 0, z + 0.5);
    bin.rotation.set(0, 0, 0);
  }

  let dockBin: Bin = newBin(null);
  dockBin.position.set(DOCK.x + 0.5, 0, DOCK.z + 0.5);

  async function truckDelivers(item: string): Promise<void> {
    truck.position.set(-1.2, 0, -6);
    truck.rotation.y = 0;
    await moveTo(truck, -1.2, 0, DOCK.z + 0.8, (DOCK.z + 6.8) / TRUCK_SPEED, easeInOut);
    await wait(0.3);
    // 荷下ろし: 空ビンに商品が入る（少し弾む）
    dockBin.setItem(item);
    dockBin.scale.set(0.6, 0.6, 0.6);
    await moveTo(dockBin, 1, 1, 1, 0.35, easeInOut, true);
    await wait(0.4);
    void moveTo(truck, -1.2, 0, H + 6, (H + 6 - DOCK.z) / TRUCK_SPEED, easeInOut);
  }

  async function pickAndShip(bin: Bin): Promise<void> {
    const cx = STATION.x + 0.5;
    picked.material = mat(itemDef(bin.item!).color);
    picked.visible = true;
    picked.position.set(cx, 0.75, cz - 0.55);
    parcel.visible = true;
    parcel.position.set(cx, 0.7 + 0.16, cz);
    parcel.scale.set(0.42, 0.32, 0.42);
    await moveTo(picked, cx, 1.25, cz - 0.3, 0.4);
    await moveTo(picked, cx, 0.9, cz, 0.4);
    picked.visible = false;
    bin.setItem(null);
    await wait(0.3);
    await moveTo(parcel, cx - 0.75, 0.3 + 0.16 + 0.04, cz, 0.5);
    await moveTo(parcel, -0.6, 0.3 + 0.16 + 0.04, cz, 2.2, linear);
    await moveTo(parcel, 0.01, 0.01, 0.01, 0.25, easeInOut, true);
    parcel.visible = false;
  }

  let k = 0;
  stage.loop(async () => {
    const i = k % 4;
    k++;
    const inItem = ITEM_IDS[i];
    const inStack = stacks[i];
    const outStack = stacks[(i + 2) % 4];

    // 1. 入荷
    await truckDelivers(inItem);
    // 2. 搬送ロボ: 入荷口 → ポート
    await amrDrive(DOCK.x, DOCK.z);
    await amrLoad(dockBin);
    const inbound = dockBin;
    await amrDrive(PORT.x, PORT.z);
    await amrUnload(inbound, PORT.x, PORT.z);
    // 3. 棚ロボ: ポートのビンを収納 → 出荷するビンをポートへ。搬送ロボは待機場所へ
    const shelfWork = (async () => {
      await shelfDrive(PORT.x, PORT.z);
      await shelfFromPort(inbound);
      await shelfDrive(inStack.x, inStack.z);
      await shelfPut(inbound, inStack);
      await shelfDrive(outStack.x, outStack.z);
      const out = await shelfTake(outStack);
      await shelfDrive(PORT.x, PORT.z);
      await shelfToPort(out);
      return out;
    })();
    await amrDrive(WAIT.x, WAIT.z, true);
    const outbound = await shelfWork;
    // 4. 搬送ロボ: ポート → ピッカー。梱包して出荷
    await amrDrive(PORT.x, PORT.z);
    await amrLoad(outbound);
    await amrDrive(STATION.x, STATION.z - 1, true);
    amr.rotation.y = 0;
    await pickAndShip(outbound);
    // 5. 空ビンを入荷口へ戻す（次の入荷に使う）
    await amrDrive(DOCK.x, DOCK.z);
    await amrUnload(outbound, DOCK.x, DOCK.z);
    dockBin = outbound;
    await amrDrive(AMR_HOME.x, AMR_HOME.z, true);
  });

  // 動作確認用（headless のスクリーンショットから位置を読む）
  (window as unknown as { __mini?: unknown }).__mini = { amr, shelf, truck, camera: stage.camera };
  return () => stage.dispose();
}


