/**
 * LP 用のミニ倉庫（/embed/mini-warehouse）。
 * ゲーム本体の sim は使わず、定型の流れをスクリプトで無限に再生する:
 *   入荷（トラック → 入荷口）→ 搬送ロボがポートへ → 棚ロボが収納 → 棚ロボが別の商品をポートへ
 *   → 搬送ロボがピッカーへ → ピッカーが梱包して出荷 → 空ビンを入荷口へ戻す（次の入荷に使う）
 * 商品 4 種・スタック 6・ポート 1。4 回の出荷で一巡し、各スタックは「その商品の置き場」なので在庫が偏らない。
 * 描画の色・寸法はゲーム（render/scene.ts）に合わせる。背景は透明（LP の背景が透ける）。
 */
import {
  AmbientLight,
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  HemisphereLight,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshLambertMaterial,
  Object3D,
  PCFShadowMap,
  PerspectiveCamera,
  PlaneGeometry,
  Scene,
  ShadowMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ICONS, ICON_SIZE, PALETTE } from '../data/icons';
import { RENDER } from '../data/balance';
import { itemDef } from '../data/items';
import { BoxBatch, shade } from '../render/voxel';

const COLORS = {
  floor: '#c9cfd6',
  floorAlt: '#bfc6cd',
  waitSpot: '#a8c6e6',
  port: '#f2c94c',
  stackTile: '#9aa3ad',
  stationTile: '#d7b899',
  dockIn: '#8fa3b8',
  wall: '#e9ecef',
  frame: '#6c7a89',
  rail: '#55606c',
  shelfRobot: '#e04b4b',
  amr: '#3a7bd5',
  amrDark: '#2b5aa0',
  person: '#f6c6a8',
  shirtPick: '#2e8b57',
  desk: '#8b6b4a',
  emptyBin: '#d9dde2',
  parcel: '#c9a06a',
  truck: '#f4f6f8',
  truckCab: '#3f8ad8',
  tire: '#222',
};

// ---- レイアウト（セル座標。1 セル = 1 ワールド単位）----
// スタックは 1 列（x=3..8, z=1）にして、どの向きから見てもポートや搬送ロボが棚の陰に隠れにくくする
const W = 9;
const H = 5;
const ITEM_IDS = ['apple', 'book', 'mug', 'plant'] as const;
const DOCK = { x: 0, z: 1 };
const PORT = { x: 2, z: 1 };
const WAIT = { x: 1, z: 2 };
const STATION = { x: 2, z: 3 };
const AMR_HOME = WAIT;
const STACKS = [
  { x: 3, z: 1 },
  { x: 4, z: 1 },
  { x: 5, z: 1 },
  { x: 6, z: 1 },
  { x: 7, z: 1 },
  { x: 8, z: 1 },
];
/** レールが通るセル（スタック + ポート） */
const RAIL_CELLS = [...STACKS, PORT];
const LEVELS = 3;
const BH = RENDER.binHeight;
const BS = RENDER.binSize;
// 運搬中のビン（本体の下）が 3 段のスタックに当たらない高さ
const RAIL_H = RENDER.railBaseHeight + LEVELS * BH + 0.5;
const AMR_SPEED = 1.6; // セル/秒
const SHELF_SPEED = 1.8;
const TRUCK_SPEED = 3;

// ---- 小さなアニメーション基盤 ----
type Tween = { obj: Object3D; from: Vector3; to: Vector3; t: number; dur: number; ease: (k: number) => number; done: () => void; scale?: boolean };
const tweens: Tween[] = [];
const easeInOut = (k: number) => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
const linear = (k: number) => k;
const timers: { t: number; done: () => void }[] = [];

function moveTo(obj: Object3D, x: number, y: number, z: number, dur: number, ease = easeInOut, scale = false): Promise<void> {
  return new Promise((done) => {
    const from = scale ? obj.scale.clone() : obj.position.clone();
    if (dur <= 0) {
      (scale ? obj.scale : obj.position).set(x, y, z);
      done();
      return;
    }
    tweens.push({ obj, from, to: new Vector3(x, y, z), t: 0, dur, ease, done, scale });
  });
}
const wait = (sec: number) => new Promise<void>((done) => timers.push({ t: sec, done }));

function tick(dt: number): void {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = tw.ease(k);
    const target = tw.scale ? tw.obj.scale : tw.obj.position;
    target.lerpVectors(tw.from, tw.to, e);
    if (k >= 1) {
      tweens.splice(i, 1);
      tw.done();
    }
  }
  for (let i = timers.length - 1; i >= 0; i--) {
    timers[i].t -= dt;
    if (timers[i].t <= 0) {
      const d = timers[i].done;
      timers.splice(i, 1);
      d();
    }
  }
}

/** 地上をマンハッタン移動（x → z の順）。向きは進行方向に回す */
async function drive(obj: Object3D, x: number, z: number, speed: number, y = obj.position.y, zFirst = false): Promise<void> {
  const legs: [number, number][] = zFirst
    ? [
        [obj.position.x, z],
        [x, z],
      ]
    : [
        [x, obj.position.z],
        [x, z],
      ];
  for (const [lx, lz] of legs) {
    const dx = lx - obj.position.x;
    const dz = lz - obj.position.z;
    const d = Math.abs(dx) + Math.abs(dz);
    if (d < 1e-6) continue;
    obj.rotation.y = Math.atan2(dx, dz);
    await moveTo(obj, lx, y, lz, d / speed, linear);
  }
}

// ---- 部品 ----
const BOX = new BoxGeometry(1, 1, 1);
const MATS = new Map<string, MeshLambertMaterial>();
function mat(color: string | Color): MeshLambertMaterial {
  const key = typeof color === 'string' ? color : '#' + color.getHexString();
  let m = MATS.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color });
    MATS.set(key, m);
  }
  return m;
}
function box(parent: Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string | Color): Mesh {
  const m = new Mesh(BOX, mat(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const ICON_RES = 8;
function iconVoxels(item: string): { x: number; z: number; color: Color }[] {
  const rows = ICONS[item];
  const out: { x: number; z: number; color: Color }[] = [];
  if (!rows) return out;
  const step = ICON_SIZE / ICON_RES;
  for (let z = 0; z < ICON_RES; z++) {
    for (let x = 0; x < ICON_RES; x++) {
      const counts = new Map<string, number>();
      for (let dz = 0; dz < step; dz++) for (let dx = 0; dx < step; dx++) {
        const ch = rows[z * step + dz][x * step + dx];
        if (ch !== '.') counts.set(ch, (counts.get(ch) ?? 0) + 1);
      }
      let best: string | null = null;
      let bn = 0;
      for (const [ch, n] of counts) if (n > bn) { bn = n; best = ch; }
      if (best && bn >= 2) out.push({ x, z, color: new Color(PALETTE[best] ?? '#f0f') });
    }
  }
  return out;
}

/** ビン: 箱 + 上面のボクセルアイコン。原点は底面の中心 */
class Bin extends Group {
  readonly body: Mesh;
  private icon: InstancedMesh;
  item: string | null = null;

  constructor() {
    super();
    this.body = box(this, 0, (BH * 0.92) / 2, 0, BS, BH * 0.92, BS, COLORS.emptyBin);
    this.icon = new InstancedMesh(BOX, new MeshLambertMaterial({ color: 0xffffff }), ICON_RES * ICON_RES);
    this.icon.castShadow = true;
    this.icon.count = 0;
    this.add(this.icon);
  }

  setItem(item: string | null): void {
    this.item = item;
    this.body.material = mat(item ? itemDef(item).color : COLORS.emptyBin);
    const vox = item ? iconVoxels(item) : [];
    const cell = (BS * 0.7) / ICON_RES;
    const h = 0.06;
    const m = new Matrix4();
    vox.forEach((v, i) => {
      m.makeScale(cell, h, cell);
      m.setPosition((v.x - ICON_RES / 2 + 0.5) * cell, BH * 0.92 + h / 2, (v.z - ICON_RES / 2 + 0.5) * cell);
      this.icon.setMatrixAt(i, m);
      this.icon.setColorAt(i, v.color);
    });
    this.icon.count = vox.length;
    this.icon.instanceMatrix.needsUpdate = true;
    if (this.icon.instanceColor) this.icon.instanceColor.needsUpdate = true;
  }
}

class Stack {
  readonly bins: Bin[] = [];
  constructor(readonly x: number, readonly z: number) {}
  /** n 段目（0 始まり）のビンの底の高さ */
  levelY(n: number): number {
    return RENDER.railBaseHeight + n * BH;
  }
}

/** 棚ロボ: レールの上を走り、ビンを本体の下にぶら下げる。原点はレール面の高さ */
function makeShelfRobot(): Group {
  const g = new Group();
  const body = COLORS.shelfRobot;
  box(g, 0, 0.25, 0, 0.78, 0.36, 0.78, body);
  box(g, 0, 0.49, 0, 0.5, 0.12, 0.5, shade(body, -0.15));
  for (const [dx, dz] of [
    [-0.32, -0.32],
    [0.32, -0.32],
    [-0.32, 0.32],
    [0.32, 0.32],
  ]) box(g, dx, 0.07, dz, 0.14, 0.14, 0.14, '#222');
  return g;
}

/** 搬送ロボ: 原点は床面の中心。ビンは天面に載せる */
function makeAmr(): Group {
  const g = new Group();
  box(g, 0, 0.17, 0, 0.8, 0.3, 0.8, COLORS.amr);
  box(g, 0, 0.34, 0, 0.72, 0.06, 0.72, COLORS.amrDark);
  box(g, 0, 0.2, 0.4, 0.12, 0.08, 0.12, '#ffe066'); // ライト（+z が前）
  return g;
}

function makeTruck(): Group {
  const g = new Group();
  box(g, 0, 0.75, -0.3, 1.1, 1.0, 2.2, COLORS.truck); // 荷台（+z が前）
  box(g, 0, 0.6, 1.25, 1.0, 0.7, 0.9, COLORS.truckCab);
  box(g, 0, 0.85, 1.6, 0.9, 0.3, 0.1, '#bfe3ff');
  for (const [dx, dz] of [
    [-0.5, 1.1],
    [0.5, 1.1],
    [-0.5, -0.9],
    [0.5, -0.9],
  ]) box(g, dx, 0.25, dz, 0.18, 0.5, 0.5, COLORS.tire);
  return g;
}

// ---- シーン ----
export function startMiniWarehouse(canvas: HTMLCanvasElement, opts: { background?: string | null } = {}): () => void {
  const renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = PCFShadowMap;
  renderer.setClearColor(0x000000, 0);

  const scene = new Scene();
  if (opts.background) scene.background = new Color(opts.background);
  scene.add(new HemisphereLight('#ffffff', '#8899aa', 0.9));
  scene.add(new AmbientLight('#ffffff', 0.25));
  const sun = new DirectionalLight('#fff4e0', 1.4);
  sun.position.set(W * 0.6, 14, H * 1.2);
  sun.target.position.set(W / 2, 0, H / 2);
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  const r = Math.max(W, H) * 0.9;
  sun.shadow.camera.left = -r;
  sun.shadow.camera.right = r;
  sun.shadow.camera.top = r;
  sun.shadow.camera.bottom = -r;
  sun.shadow.camera.near = 1;
  sun.shadow.camera.far = 60;
  sun.shadow.bias = -0.0005;
  scene.add(sun, sun.target);

  // 透明背景に影だけ落とす地面（トラックの影用）
  const ground = new Mesh(new PlaneGeometry(60, 60), new ShadowMaterial({ opacity: 0.18 }));
  ground.rotation.x = -Math.PI / 2;
  ground.position.y = -RENDER.floorThickness - 0.005;
  ground.receiveShadow = true;
  scene.add(ground);

  // 床・壁・棚フレーム（静的。InstancedMesh にまとめる）
  const floor = new BoxBatch(W * H + 64, { receiveShadow: true, castShadow: true });
  floor.begin();
  const t = RENDER.floorThickness;
  const stationCells = new Set([`${STATION.x},${STATION.z}`]);
  const stackCells = new Set(STACKS.map((s) => `${s.x},${s.z}`));
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < H; z++) {
      let color = (x + z) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
      const key = `${x},${z}`;
      if (stackCells.has(key)) color = COLORS.stackTile;
      else if (x === PORT.x && z === PORT.z) color = COLORS.port;
      else if (x === WAIT.x && z === WAIT.z) color = COLORS.waitSpot;
      else if (stationCells.has(key)) color = COLORS.stationTile;
      else if (x === DOCK.x && z === DOCK.z) color = COLORS.dockIn;
      floor.add(x + 0.5, -t / 2, z + 0.5, 1, t, 1, color);
    }
  }
  // 低い壁（入荷口の前は開けておく）
  const wh = 0.35;
  const wt = 0.12;
  for (let x = 0; x < W; x++) {
    floor.add(x + 0.5, wh / 2, -wt / 2, 1, wh, wt, COLORS.wall);
    floor.add(x + 0.5, wh / 2, H + wt / 2, 1, wh, wt, COLORS.wall);
  }
  for (let z = 0; z < H; z++) {
    if (z !== DOCK.z && z !== STATION.z) floor.add(-wt / 2, wh / 2, z + 0.5, wt, wh, 1, COLORS.wall);
    floor.add(W + wt / 2, wh / 2, z + 0.5, wt, wh, 1, COLORS.wall);
  }
  // スタックの土台
  for (const s of STACKS) floor.add(s.x + 0.5, RENDER.railBaseHeight / 2, s.z + 0.5, 0.9, RENDER.railBaseHeight, 0.9, shade(COLORS.stackTile, -0.08));
  floor.end();
  scene.add(floor.mesh);

  const frameBatch = new BoxBatch(RAIL_CELLS.length * 8);
  frameBatch.begin();
  const posts = new Set<string>();
  for (const c of RAIL_CELLS) {
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const key = `${c.x + dx},${c.z + dz}`;
      if (posts.has(key)) continue;
      posts.add(key);
      frameBatch.add(c.x + dx, RAIL_H / 2, c.z + dz, 0.07, RAIL_H, 0.07, COLORS.frame);
    }
    frameBatch.add(c.x + 0.5, RAIL_H, c.z, 1, 0.06, 0.08, COLORS.rail);
    frameBatch.add(c.x + 0.5, RAIL_H, c.z + 1, 1, 0.06, 0.08, COLORS.rail);
    frameBatch.add(c.x, RAIL_H, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
    frameBatch.add(c.x + 1, RAIL_H, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
  }
  frameBatch.end();
  scene.add(frameBatch.mesh);

  // ピックステーション（机 + ピッカー + 看板）と出荷コンベア
  {
    const cx = STATION.x + 0.5;
    const cz = STATION.z + 0.5;
    box(scene, cx, 0.35, cz, 0.9, 0.7, 0.5, COLORS.desk);
    box(scene, cx, 0.55, cz + 0.3, 0.36, 0.5, 0.22, COLORS.shirtPick);
    box(scene, cx, 0.95, cz + 0.3, 0.28, 0.28, 0.28, COLORS.person);
    box(scene, cx - 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
    box(scene, cx + 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
    box(scene, cx, 1.5, cz, 0.6, 0.3, 0.06, COLORS.shirtPick);
    // コンベア（机の西側から壁の外へ）
    box(scene, (STATION.x + 0.05) / 2, 0.3, cz, STATION.x + 0.05, 0.08, 0.5, '#8a9099');
  }
  // 入荷口の印
  box(scene, DOCK.x + 0.5, 0.02, DOCK.z + 0.5, 0.9, 0.04, 0.9, '#5f7389');

  // 動くもの
  const stacks = STACKS.map((s) => new Stack(s.x, s.z));
  const allBins: Bin[] = [];
  function newBin(item: string | null): Bin {
    const b = new Bin();
    b.setItem(item);
    allBins.push(b);
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
  const initial: (string | null)[][] = [
    [ITEM_IDS[0], ITEM_IDS[0]],
    [ITEM_IDS[1], ITEM_IDS[1]],
    [ITEM_IDS[2], ITEM_IDS[2]],
    [ITEM_IDS[3], ITEM_IDS[3]],
    [ITEM_IDS[1], ITEM_IDS[2], ITEM_IDS[0]],
    [ITEM_IDS[3], ITEM_IDS[1]],
  ];
  initial.forEach((items, i) => items.forEach((it) => placeOnStack(stacks[i], newBin(it))));

  const shelf = makeShelfRobot();
  shelf.position.set(STACKS[2].x + 0.5, RAIL_H, STACKS[2].z + 0.5);
  scene.add(shelf);
  const amr = makeAmr();
  amr.position.set(AMR_HOME.x + 0.5, 0, AMR_HOME.z + 0.5);
  scene.add(amr);
  const truck = makeTruck();
  truck.scale.setScalar(0.8);
  truck.position.set(-1.2, 0, -6);
  scene.add(truck);
  const parcel = box(scene, 0, 0, 0, 0.42, 0.32, 0.42, COLORS.parcel);
  parcel.visible = false;
  const picked = box(scene, 0, 0, 0, 0.22, 0.22, 0.22, '#fff');
  picked.visible = false;

  // ---- 台本 ----
  const shelfDrive = (x: number, z: number, zFirst = false) => drive(shelf, x + 0.5, z + 0.5, SHELF_SPEED, RAIL_H, zFirst);
  const amrDrive = (x: number, z: number, zFirst = false) => drive(amr, x + 0.5, z + 0.5, AMR_SPEED, 0, zFirst);

  async function shelfTake(stack: Stack): Promise<Bin> {
    const bin = stack.bins.pop()!;
    shelf.attach(bin);
    await moveTo(bin, 0, -BH, 0, 0.9);
    return bin;
  }
  async function shelfPut(bin: Bin, stack: Stack): Promise<void> {
    const y = stack.levelY(stack.bins.length) - RAIL_H;
    await moveTo(bin, 0, y, 0, 0.9);
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
    const cz = STATION.z + 0.5;
    // ピッカーが商品を 1 つ取り出して箱に入れる
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
    // 箱をコンベアへ → 壁の外へ流れて消える
    await moveTo(parcel, cx - 0.75, 0.3 + 0.16 + 0.04, cz, 0.5);
    await moveTo(parcel, -0.6, 0.3 + 0.16 + 0.04, cz, 2.2, linear);
    await moveTo(parcel, 0.01, 0.01, 0.01, 0.25, easeInOut, true);
    parcel.visible = false;
  }

  let stopped = false;
  async function shipment(k: number): Promise<void> {
    const inItem = ITEM_IDS[k];
    const inStack = stacks[k];
    const outStack = stacks[(k + 2) % 4];

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
  }
  (async () => {
    await wait(0.6);
    let k = 0;
    while (!stopped) {
      await shipment(k % 4);
      k++;
    }
  })();

  // ---- カメラ（上空からのオービット）と描画ループ ----
  const camera = new PerspectiveCamera(34, 1, 0.1, 100);
  const center = new Vector3(W / 2 - 0.4, 0.4, H / 2 - 0.2);
  const radius = 12.5;
  const elev = (52 * Math.PI) / 180;
  let angle = 0.9;
  function resize(): void {
    const w = canvas.clientWidth || 1;
    const h = canvas.clientHeight || 1;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    // 縦長なら少し引く
    camera.fov = w / h < 1.4 ? 34 * Math.min(1.8, 1.4 / (w / h)) : 34;
    camera.updateProjectionMatrix();
  }
  resize();
  window.addEventListener('resize', resize);

  let visible = true;
  const io = typeof IntersectionObserver !== 'undefined' ? new IntersectionObserver((es) => (visible = es.some((e) => e.isIntersecting))) : null;
  io?.observe(canvas);

  let last = performance.now();
  let raf = 0;
  function frame(now: number): void {
    raf = requestAnimationFrame(frame);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!visible || document.hidden) return;
    tick(dt);
    angle += dt * ((Math.PI * 2) / 70);
    camera.position.set(center.x + radius * Math.cos(elev) * Math.sin(angle), center.y + radius * Math.sin(elev), center.z + radius * Math.cos(elev) * Math.cos(angle));
    camera.lookAt(center);
    renderer.render(scene, camera);
  }
  raf = requestAnimationFrame(frame);
  // 動作確認用（headless のスクリーンショットから位置を読む）
  (window as unknown as { __mini?: unknown }).__mini = { amr, shelf, truck, bins: allBins, camera };

  return () => {
    stopped = true;
    cancelAnimationFrame(raf);
    io?.disconnect();
    window.removeEventListener('resize', resize);
    renderer.dispose();
  };
}
