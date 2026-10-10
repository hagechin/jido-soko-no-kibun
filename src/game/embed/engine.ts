/**
 * LP 用ミニ倉庫の共通部品（/embed/mini-warehouse）。
 * ゲーム本体の sim は使わず、three.js のシーンと「台本」（async の tween）で定型の動きを再生する。
 * 色・寸法・ライトはゲームの描画（render/scene.ts）に合わせる。
 */
import {
  AmbientLight,
  BoxGeometry,
  CanvasTexture,
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
  Sprite,
  SpriteMaterial,
  Vector3,
  WebGLRenderer,
} from 'three';
import { ICONS, ICON_SIZE, PALETTE } from '../data/icons';
import { RENDER, ROBOT } from '../data/balance';
import { itemDef } from '../data/items';
import { BoxBatch, shade } from '../render/voxel';

export const COLORS = {
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
  doubleDecker: '#e08a2b',
  amr: '#3a7bd5',
  amrDark: '#2b5aa0',
  drone: '#5fc9f8',
  droneDark: '#2c6f8f',
  rotor: '#2a2f36',
  person: '#f6c6a8',
  shirtPick: '#2e8b57',
  desk: '#8b6b4a',
  emptyBin: '#d9dde2',
  parcel: '#c9a06a',
  truck: '#f4f6f8',
  truckCab: '#3f8ad8',
  tire: '#222',
};

export const BH = RENDER.binHeight;
export const BS = RENDER.binSize;

/** 速度 Lv（0 始まり）→ セル/秒（ゲームの moveTicksByLevel から） */
export const cellsPerSec = (level: number): number => 10 / ROBOT.moveTicksByLevel[Math.min(level, ROBOT.moveTicksByLevel.length - 1)];
/** リフト Lv（0 始まり）→ 上げ下ろし 1 回の秒数 */
export const liftSec = (level: number): number => ROBOT.liftTicksByLevel[Math.min(level, ROBOT.liftTicksByLevel.length - 1)] / 10;

// ---- アニメーション基盤 ----
type Tween = { obj: Object3D; from: Vector3; to: Vector3; t: number; dur: number; ease: (k: number) => number; done: () => void; scale?: boolean };
const tweens: Tween[] = [];
const timers: { t: number; done: () => void }[] = [];
export const easeInOut = (k: number): number => (k < 0.5 ? 2 * k * k : 1 - Math.pow(-2 * k + 2, 2) / 2);
export const linear = (k: number): number => k;

export function moveTo(obj: Object3D, x: number, y: number, z: number, dur: number, ease: (k: number) => number = easeInOut, scale = false): Promise<void> {
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
export const wait = (sec: number): Promise<void> => new Promise((done) => timers.push({ t: sec, done }));

export function tick(dt: number): void {
  for (let i = tweens.length - 1; i >= 0; i--) {
    const tw = tweens[i];
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    const e = tw.ease(k);
    (tw.scale ? tw.obj.scale : tw.obj.position).lerpVectors(tw.from, tw.to, e);
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

/** マンハッタン移動（x → z の順。zFirst で逆）。向きは進行方向に回す。座標はセルの中心 */
export async function drive(obj: Object3D, x: number, z: number, speed: number, y = obj.position.y, zFirst = false): Promise<void> {
  const tx = x + 0.5;
  const tz = z + 0.5;
  const legs: [number, number][] = zFirst
    ? [
        [obj.position.x, tz],
        [tx, tz],
      ]
    : [
        [tx, obj.position.z],
        [tx, tz],
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

/** 直線移動（ドローン用: 向きも直線に合わせる） */
export async function fly(obj: Object3D, x: number, z: number, speed: number, y = obj.position.y): Promise<void> {
  const tx = x + 0.5;
  const tz = z + 0.5;
  const dx = tx - obj.position.x;
  const dz = tz - obj.position.z;
  const d = Math.hypot(dx, dz);
  if (d < 1e-6) return;
  obj.rotation.y = Math.atan2(dx, dz);
  await moveTo(obj, tx, y, tz, d / speed, easeInOut);
}

// ---- 部品 ----
export const BOX = new BoxGeometry(1, 1, 1);
const MATS = new Map<string, MeshLambertMaterial>();
export function mat(color: string | Color): MeshLambertMaterial {
  const key = typeof color === 'string' ? color : '#' + color.getHexString();
  let m = MATS.get(key);
  if (!m) {
    m = new MeshLambertMaterial({ color });
    MATS.set(key, m);
  }
  return m;
}
export function box(parent: Object3D, x: number, y: number, z: number, w: number, h: number, d: number, color: string | Color): Mesh {
  const m = new Mesh(BOX, mat(color));
  m.position.set(x, y, z);
  m.scale.set(w, h, d);
  m.castShadow = true;
  m.receiveShadow = true;
  parent.add(m);
  return m;
}

const ICON_RES = 8;
const iconCache = new Map<string, { x: number; z: number; color: Color }[]>();
function iconVoxels(item: string): { x: number; z: number; color: Color }[] {
  const hit = iconCache.get(item);
  if (hit) return hit;
  const rows = ICONS[item];
  const out: { x: number; z: number; color: Color }[] = [];
  if (rows) {
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
  }
  iconCache.set(item, out);
  return out;
}

/** ビン: 箱 + 上面のボクセルアイコン。原点は底面の中心 */
export class Bin extends Group {
  readonly body: Mesh;
  private icon: InstancedMesh;
  item: string | null = null;

  constructor(item: string | null = null) {
    super();
    this.body = box(this, 0, (BH * 0.92) / 2, 0, BS, BH * 0.92, BS, COLORS.emptyBin);
    this.icon = new InstancedMesh(BOX, new MeshLambertMaterial({ color: 0xffffff }), ICON_RES * ICON_RES);
    this.icon.castShadow = true;
    this.icon.count = 0;
    this.add(this.icon);
    this.setItem(item);
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

export class Stack {
  readonly bins: Bin[] = [];
  constructor(readonly x: number, readonly z: number) {}
  /** n 段目（0 始まり）のビンの底の高さ */
  levelY(n: number): number {
    return RENDER.railBaseHeight + n * BH;
  }
  get top(): Bin | undefined {
    return this.bins[this.bins.length - 1];
  }
}

/** 棚ロボ: レールの上を走り、ビンを本体の下にぶら下げる。原点はレール面の高さ */
export function makeShelfRobot(color = COLORS.shelfRobot, double = false, railH = 0): Group {
  const g = new Group();
  box(g, 0, 0.25, 0, 0.78, 0.36, 0.78, color);
  box(g, 0, 0.49, 0, 0.5, 0.12, 0.5, shade(color, -0.15));
  if (double) {
    // 2 段持ちの目印: 四隅の支柱
    for (const [dx, dz] of [
      [-0.34, -0.34],
      [0.34, -0.34],
      [-0.34, 0.34],
      [0.34, 0.34],
    ]) box(g, dx, -BH, dz, 0.06, BH * 2, 0.06, shade(color, -0.3));
  }
  for (const [dx, dz] of [
    [-0.32, -0.32],
    [0.32, -0.32],
    [-0.32, 0.32],
    [0.32, 0.32],
  ]) box(g, dx, 0.07, dz, 0.14, 0.14, 0.14, '#222');
  g.position.y = railH;
  return g;
}

/** 搬送ロボ: 原点は床面の中心。ビンは天面に載せる（+z が前） */
export function makeAmr(color = COLORS.amr, dark = COLORS.amrDark): Group {
  const g = new Group();
  box(g, 0, 0.17, 0, 0.8, 0.3, 0.8, color);
  box(g, 0, 0.34, 0, 0.72, 0.06, 0.72, dark);
  box(g, 0, 0.2, 0.4, 0.12, 0.08, 0.12, '#ffe066');
  return g;
}

/** ドローン: 本体 + 4 本の腕とローター。rotors を毎フレーム回す。原点は本体の中心 */
export function makeDrone(): { group: Group; rotors: Mesh[] } {
  const g = new Group();
  box(g, 0, 0, 0, 0.5, 0.16, 0.5, COLORS.drone);
  box(g, 0, 0.1, 0, 0.3, 0.06, 0.3, COLORS.droneDark);
  const rotors: Mesh[] = [];
  for (const [dx, dz] of [
    [-0.42, -0.42],
    [0.42, -0.42],
    [-0.42, 0.42],
    [0.42, 0.42],
  ]) {
    const arm = box(g, dx * 0.55, 0, dz * 0.55, 0.5, 0.05, 0.08, COLORS.droneDark);
    arm.rotation.y = Math.atan2(dz, dx);
    const hub = new Group();
    hub.position.set(dx, 0.06, dz);
    box(hub, 0, 0, 0, 0.34, 0.03, 0.08, COLORS.rotor);
    box(hub, 0, 0, 0, 0.08, 0.03, 0.34, COLORS.rotor);
    (hub as unknown as { spinDir: number }).spinDir = dx * dz > 0 ? 1 : -1;
    g.add(hub);
    rotors.push(hub as unknown as Mesh);
  }
  return { group: g, rotors };
}

export function makeTruck(): Group {
  const g = new Group();
  box(g, 0, 0.75, -0.3, 1.1, 1.0, 2.2, COLORS.truck);
  box(g, 0, 0.6, 1.25, 1.0, 0.7, 0.9, COLORS.truckCab);
  box(g, 0, 0.85, 1.6, 0.9, 0.3, 0.1, '#bfe3ff');
  for (const [dx, dz] of [
    [-0.5, 1.1],
    [0.5, 1.1],
    [-0.5, -0.9],
    [0.5, -0.9],
  ]) box(g, dx, 0.25, dz, 0.18, 0.5, 0.5, COLORS.tire);
  g.scale.setScalar(0.8);
  return g;
}

/** ピックステーション（机 + ピッカー + 看板）。セル (x, z) に置く。ピッカーは机の南側 */
export function makeStation(parent: Object3D, x: number, z: number): void {
  const cx = x + 0.5;
  const cz = z + 0.5;
  box(parent, cx, 0.35, cz, 0.9, 0.7, 0.5, COLORS.desk);
  box(parent, cx, 0.55, cz + 0.3, 0.36, 0.5, 0.22, COLORS.shirtPick);
  box(parent, cx, 0.95, cz + 0.3, 0.28, 0.28, 0.28, COLORS.person);
  box(parent, cx - 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
  box(parent, cx + 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
  box(parent, cx, 1.5, cz, 0.6, 0.3, 0.06, COLORS.shirtPick);
}

/** 文字のラベル（スプライト）。setText で差し替え */
export class Label extends Sprite {
  private canvas = document.createElement('canvas');
  private tex: CanvasTexture;
  constructor(text: string, readonly widthUnits = 3) {
    super();
    this.tex = new CanvasTexture(this.canvas);
    this.material = new SpriteMaterial({ map: this.tex, transparent: true, depthTest: false });
    this.renderOrder = 10;
    this.setText(text);
  }
  setText(text: string): void {
    const c = this.canvas;
    const dpr = 2;
    const font = `700 ${22 * dpr}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
    const ctx = c.getContext('2d')!;
    ctx.font = font;
    const tw = ctx.measureText(text).width;
    const padX = 16 * dpr;
    const h = 40 * dpr;
    c.width = Math.ceil(tw + padX * 2);
    c.height = h;
    ctx.font = font;
    ctx.fillStyle = 'rgba(29, 39, 51, 0.88)';
    const r = 12 * dpr;
    ctx.beginPath();
    ctx.roundRect(0, 0, c.width, c.height, r);
    ctx.fill();
    ctx.fillStyle = '#fff';
    ctx.textBaseline = 'middle';
    ctx.fillText(text, padX, h / 2);
    this.tex.image = c;
    this.tex.needsUpdate = true;
    const aspect = c.width / c.height;
    const hUnits = this.widthUnits / aspect;
    this.scale.set(this.widthUnits, hUnits, 1);
  }
}

// ---- 床・壁・レール ----
export interface FloorSpec {
  W: number;
  H: number;
  /** "x,z" → 色（スタック・ポート・待機・ステーション・入荷口など） */
  tiles: Map<string, string>;
  /** 壁を開けておくセル（西壁の z、東壁の z、北壁の x、南壁の x） */
  gaps?: { west?: number[]; east?: number[]; north?: number[]; south?: number[] };
  /** スタックの土台を描くセル */
  stacks?: { x: number; z: number }[];
  /** 壁の高さ（ゲームは 1.0 だが、俯瞰で中が見えるよう低く） */
  wallHeight?: number;
}
export function buildFloor(scene: Scene, spec: FloorSpec): void {
  const { W, H } = spec;
  const batch = new BoxBatch(W * H + 2 * (W + H) + (spec.stacks?.length ?? 0) + 8, { receiveShadow: true, castShadow: true });
  batch.begin();
  const t = RENDER.floorThickness;
  for (let x = 0; x < W; x++) {
    for (let z = 0; z < H; z++) {
      const color = spec.tiles.get(`${x},${z}`) ?? ((x + z) % 2 === 0 ? COLORS.floor : COLORS.floorAlt);
      batch.add(x + 0.5, -t / 2, z + 0.5, 1, t, 1, color);
    }
  }
  const wh = spec.wallHeight ?? 0.35;
  const wt = 0.12;
  const g = spec.gaps ?? {};
  for (let x = 0; x < W; x++) {
    if (!g.north?.includes(x)) batch.add(x + 0.5, wh / 2, -wt / 2, 1, wh, wt, COLORS.wall);
    if (!g.south?.includes(x)) batch.add(x + 0.5, wh / 2, H + wt / 2, 1, wh, wt, COLORS.wall);
  }
  for (let z = 0; z < H; z++) {
    if (!g.west?.includes(z)) batch.add(-wt / 2, wh / 2, z + 0.5, wt, wh, 1, COLORS.wall);
    if (!g.east?.includes(z)) batch.add(W + wt / 2, wh / 2, z + 0.5, wt, wh, 1, COLORS.wall);
  }
  for (const s of spec.stacks ?? []) batch.add(s.x + 0.5, RENDER.railBaseHeight / 2, s.z + 0.5, 0.9, RENDER.railBaseHeight, 0.9, shade(COLORS.stackTile, -0.08));
  batch.end();
  scene.add(batch.mesh);
}

/** 棚フレーム: セルの四隅に柱、上部にレール（ゲームと同じ） */
export function buildRails(scene: Scene, cells: { x: number; z: number }[], railH: number): void {
  const batch = new BoxBatch(cells.length * 8);
  batch.begin();
  const posts = new Set<string>();
  for (const c of cells) {
    for (const [dx, dz] of [
      [0, 0],
      [1, 0],
      [0, 1],
      [1, 1],
    ]) {
      const key = `${c.x + dx},${c.z + dz}`;
      if (posts.has(key)) continue;
      posts.add(key);
      batch.add(c.x + dx, railH / 2, c.z + dz, 0.07, railH, 0.07, COLORS.frame);
    }
    batch.add(c.x + 0.5, railH, c.z, 1, 0.06, 0.08, COLORS.rail);
    batch.add(c.x + 0.5, railH, c.z + 1, 1, 0.06, 0.08, COLORS.rail);
    batch.add(c.x, railH, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
    batch.add(c.x + 1, railH, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
  }
  batch.end();
  scene.add(batch.mesh);
}

/** レールの高さ（運搬中のビンが levels 段のスタックに当たらない） */
export const railHeightFor = (levels: number): number => RENDER.railBaseHeight + levels * BH + 0.5;

// ---- ステージ（レンダラ・ライト・カメラのオービット・ループ） ----
export interface StageOpts {
  background?: string | null;
  W: number;
  H: number;
  /** オービットの中心・半径・仰角（度）・1 周の秒数 */
  center?: Vector3;
  radius?: number;
  elev?: number;
  orbitSec?: number;
  fov?: number;
  /** 開始角（rad） */
  angle?: number;
}

export class Stage {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  private stopped = false;
  private raf = 0;
  private visible = true;
  private io: IntersectionObserver | null = null;
  private frameHooks: ((dt: number, t: number) => void)[] = [];
  private angle: number;
  private readonly center: Vector3;
  private readonly radius: number;
  private readonly elev: number;
  private readonly orbitSec: number;
  private readonly fov: number;
  private time = 0;

  constructor(readonly canvas: HTMLCanvasElement, opts: StageOpts) {
    this.renderer = new WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = PCFShadowMap;
    this.renderer.setClearColor(0x000000, 0);
    if (opts.background) this.scene.background = new Color(opts.background);

    const { W, H } = opts;
    this.scene.add(new HemisphereLight('#ffffff', '#8899aa', 0.9));
    this.scene.add(new AmbientLight('#ffffff', 0.25));
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
    this.scene.add(sun, sun.target);

    const ground = new Mesh(new PlaneGeometry(80, 80), new ShadowMaterial({ opacity: 0.18 }));
    ground.rotation.x = -Math.PI / 2;
    ground.position.y = -RENDER.floorThickness - 0.005;
    ground.receiveShadow = true;
    this.scene.add(ground);

    this.fov = opts.fov ?? 34;
    this.camera = new PerspectiveCamera(this.fov, 1, 0.1, 100);
    this.center = opts.center ?? new Vector3(W / 2, 0.4, H / 2);
    this.radius = opts.radius ?? Math.max(W, H) * 1.4;
    this.elev = ((opts.elev ?? 52) * Math.PI) / 180;
    this.orbitSec = opts.orbitSec ?? 70;
    this.angle = opts.angle ?? 0.9;
    this.resize = this.resize.bind(this);
    this.resize();
    window.addEventListener('resize', this.resize);
    if (typeof IntersectionObserver !== 'undefined') {
      this.io = new IntersectionObserver((es) => (this.visible = es.some((e) => e.isIntersecting)));
      this.io.observe(canvas);
    }
    let last = performance.now();
    const frame = (now: number): void => {
      if (this.stopped) return;
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(0.1, (now - last) / 1000);
      last = now;
      if (!this.visible || document.hidden) return;
      this.time += dt;
      tick(dt);
      for (const h of this.frameHooks) h(dt, this.time);
      this.angle += dt * ((Math.PI * 2) / this.orbitSec);
      this.camera.position.set(
        this.center.x + this.radius * Math.cos(this.elev) * Math.sin(this.angle),
        this.center.y + this.radius * Math.sin(this.elev),
        this.center.z + this.radius * Math.cos(this.elev) * Math.cos(this.angle),
      );
      this.camera.lookAt(this.center);
      this.renderer.render(this.scene, this.camera);
    };
    this.raf = requestAnimationFrame(frame);
  }

  private resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.fov = w / h < 1.4 ? this.fov * Math.min(1.8, 1.4 / (w / h)) : this.fov;
    this.camera.updateProjectionMatrix();
  }

  onFrame(fn: (dt: number, t: number) => void): void {
    this.frameHooks.push(fn);
  }

  get running(): boolean {
    return !this.stopped;
  }

  /** 台本を無限に繰り返す */
  loop(script: () => Promise<void>): void {
    void (async () => {
      await wait(0.6);
      while (!this.stopped) await script();
    })();
  }

  dispose(): void {
    this.stopped = true;
    cancelAnimationFrame(this.raf);
    this.io?.disconnect();
    window.removeEventListener('resize', this.resize);
    this.renderer.dispose();
  }
}
