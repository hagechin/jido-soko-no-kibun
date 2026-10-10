/**
 * 3D 倉庫ビュー（Three.js）。
 * 静的な部分（床・壁・棚フレーム・設備）はレイアウト変更時だけ作り直し、
 * 動く部分（ロボ・ビン）は毎フレーム更新する。
 */
import {
  AmbientLight,
  Color,
  DirectionalLight,
  Fog,
  Group,
  HemisphereLight,
  Mesh,
  MeshLambertMaterial,
  PerspectiveCamera,
  PlaneGeometry,
  Plane,
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
  BufferGeometry,
  Float32BufferAttribute,
  LineBasicMaterial,
  LineSegments,
} from 'three';
import { RENDER, BIN, INBOUND_WORKER, ROBOT } from '../data/balance';
import { itemDef } from '../data/items';
import { ICONS, ICON_SIZE, PALETTE } from '../data/icons';
import { Effects, groundColorForMonth } from './effects';
import type { Robot, WorldState } from '../sim/types';
import { BoxBatch, shade } from './voxel';
import { shapeFor } from '../sim/footprint';
import { PhotoRig, captionLines, captureFov, drawCaption, fovForFocal, photoSize, shutterFrames, type PhotoAdvance, type PhotoParams } from './photo';
import { rankName } from '../sim/rank';
import { isDoubleDecker, isDrone } from '../sim/layers';
import { CameraController } from './camera';
import type { QualitySettings } from './quality';

export interface PickResult {
  kind: 'robot' | 'stack' | 'port' | 'station' | 'cell';
  id: number; // robot/stack/port/station の id。cell のときは 0
  x: number;
  z: number;
}

const COLORS = {
  floor: '#c9cfd6',
  floorAlt: '#bfc6cd',
  waitSpot: '#a8c6e6',
  port: '#f2c94c',
  portClosed: '#8c8c8c',
  stackTile: '#9aa3ad',
  stationTile: '#d7b899',
  inboundTile: '#b7d7a8',
  dockIn: '#8fa3b8',
  dockOut: '#b88f8f',
  wall: '#e9ecef',
  wallTop: '#d0d5db',
  frame: '#6c7a89',
  rail: '#55606c',
  shelfRobot: '#e04b4b',
  doubleDecker: '#e08a2b',
  amr: '#3a7bd5',
  amrDark: '#2b5aa0',
  drone: '#5fc9f8',
  droneDark: '#2c6f8f',
  rotor: '#2a2f36',
  /** 金色スキン（サポーターパック）: 全ロボを金色に。種類の見分けは明るさで */
  goldShelf: '#e2b53a',
  goldDouble: '#c9931c',
  goldAmr: '#d4a62a',
  goldAmrDark: '#9c7514',
  goldDrone: '#f0cc5c',
  goldDroneDark: '#a67f1a',
  person: '#f6c6a8',
  shirtPick: '#2e8b57',
  shirtInbound: '#d2691e',
  desk: '#8b6b4a',
  ground: '#7fa66b',
  emptyBin: '#d9dde2',
  lowBin: '#f0c000',
  critBin: '#d64545',
};

export class WarehouseRenderer {
  readonly renderer: WebGLRenderer;
  readonly scene = new Scene();
  readonly camera: PerspectiveCamera;
  readonly controls: CameraController;
  private readonly raycaster = new Raycaster();
  private readonly staticGroup = new Group();
  private readonly dynamicGroup = new Group();
  private floorBatch = new BoxBatch(1);
  private frameBatch = new BoxBatch(1);
  private miscBatch = new BoxBatch(1);
  private binBatch = new BoxBatch(1);
  private robotBatch = new BoxBatch(1);
  /** フォトモードの後処理（null = 通常描画） */
  private photoRig: PhotoRig | null = null;
  private baseFov = 45;

  /** フォトモードの開始／終了。開始中は後処理（ボケ・色調）付きで描き、画角は焦点距離から決める */
  setPhotoMode(on: boolean): void {
    if (on && !this.photoRig) {
      this.photoRig = new PhotoRig(this.renderer, this.scene, this.camera);
      this.baseFov = this.camera.fov;
      this.resize();
    } else if (!on && this.photoRig) {
      this.photoRig.dispose();
      this.photoRig = null;
      this.camera.fov = this.baseFov;
      this.camera.updateProjectionMatrix();
    }
  }

  get photoParams(): PhotoParams | null {
    return this.photoRig?.params ?? null;
  }

  setPhotoParams(p: PhotoParams): void {
    if (!this.photoRig) return;
    this.photoRig.params = p;
    this.photoRig.apply();
    this.camera.fov = fovForFocal(p.focalMm);
    this.camera.updateProjectionMatrix();
  }

  /** 画面上の点までの距離（ピント合わせ用）。何にも当たらなければ null */
  distanceAt(w: WorldState, clientX: number, clientY: number, alpha: number): number | null {
    const hit = this.pick(w, clientX, clientY, alpha, false);
    if (hit) {
      const y = hit.kind === 'stack' ? this.railHeight(w) * 0.6 : hit.kind === 'robot' ? 0.4 : 0.2;
      return this.camera.position.distanceTo(new Vector3(hit.x + 0.5, y, hit.z + 0.5));
    }
    // 何にも当たらなければ床（y = 0）との交点までの距離（ウォークスルーで床を見ているときなど）
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    const ray = new Raycaster();
    ray.setFromCamera(ndc, this.camera);
    const p = new Vector3();
    if (!ray.ray.intersectPlane(new Plane(new Vector3(0, 1, 0), 0), p)) return null;
    return this.camera.position.distanceTo(p);
  }

  /**
   * 撮影: 指定サイズで描いて JPEG のデータ URL にする。シャッター（モーションブラー）は、動作中のロボの補間 alpha を
   * 少しずつ進めた複数コマを重ねて作る（シミュレーションは進めない）。描画サイズは終わったら元に戻す
   */
  /**
   * 撮影 → JPEG データ URL。
   * 画角はプレビューの枠（黒帯の内側）と同じ範囲になるよう合わせる。
   * シャッターが 0 より長いときは advance でシミュレーションの写しを少しずつ進めながらコマを重ねる（本物は動かさない）
   */
  capturePhoto(w: WorldState, alpha: number, longEdge: number, advance?: () => PhotoAdvance, quality = 0.92): string {
    const p = this.photoRig?.params;
    const rect = this.canvas.getBoundingClientRect();
    const screenRatio = rect.width / Math.max(1, rect.height);
    const size = photoSize(p?.aspect ?? 'screen', screenRatio, longEdge);
    const span = p?.shutterTicks ?? 0;
    const frames = shutterFrames(span);
    const prevRatio = this.renderer.getPixelRatio();
    const prevFov = this.camera.fov;
    this.renderer.setPixelRatio(1);
    this.renderer.setSize(size.width, size.height, false);
    this.camera.aspect = size.width / size.height;
    this.camera.fov = captureFov(prevFov, screenRatio, size.width / size.height);
    this.camera.updateProjectionMatrix();
    this.photoRig?.setSize(size.width, size.height);
    const out = document.createElement('canvas');
    out.width = size.width;
    out.height = size.height;
    const ctx = out.getContext('2d')!;
    const adv = frames > 1 && advance ? advance() : null;
    const src = adv?.world ?? w;
    let stepped = 0;
    this.drawBins(src); // 記録した瞬間（写し）の棚を描く
    for (let i = 0; i < frames; i++) {
      // コマ i の時刻（tick 単位、今の補間位置から数える）。整数部ぶん写しを進め、小数部を補間に使う
      const t = frames === 1 ? alpha : alpha + (span * i) / (frames - 1);
      let a = t;
      if (adv) {
        const whole = Math.floor(t);
        if (stepped < whole) {
          while (stepped < whole) {
            adv.step();
            stepped++;
          }
          this.drawBins(src);
        }
        a = t - whole;
      } else a = Math.min(1, t);
      this.drawFrame(src, a, i / Math.max(1, frames - 1));
      ctx.globalAlpha = 1 / (i + 1); // 累積平均
      ctx.drawImage(this.canvas, 0, 0);
    }
    ctx.globalAlpha = 1;
    drawCaption(ctx, size.width, size.height, captionLines(p?.logo ?? 'none', { rank: rankName(w), year: w.calendar.year, month: w.calendar.month, shipped: w.stats.totalShipped }));
    const url = out.toDataURL('image/jpeg', quality);
    this.renderer.setPixelRatio(prevRatio);
    this.camera.fov = prevFov;
    this.lastTick = -1; // 写しを描いたので、次のフレームで本物を描き直す
    this.resize();
    return url;
  }

  /** ロボの色（スキン）。setSkin で差し替える */
  private robotColors = { shelf: COLORS.shelfRobot, double: COLORS.doubleDecker, amr: COLORS.amr, amrDark: COLORS.amrDark, drone: COLORS.drone, droneDark: COLORS.droneDark };

  /** ロボのスキン（サポーターパックの金色） */
  setSkin(skin: 'standard' | 'gold'): void {
    this.robotColors =
      skin === 'gold'
        ? { shelf: COLORS.goldShelf, double: COLORS.goldDouble, amr: COLORS.goldAmr, amrDark: COLORS.goldAmrDark, drone: COLORS.goldDrone, droneDark: COLORS.goldDroneDark }
        : { shelf: COLORS.shelfRobot, double: COLORS.doubleDecker, amr: COLORS.amr, amrDark: COLORS.amrDark, drone: COLORS.drone, droneDark: COLORS.droneDark };
  }

  /** 3D ビューの背景と霧の色（UI テーマに合わせる） */
  setBackdrop(color: string): void {
    (this.scene.background as Color).set(color);
    (this.scene.fog as Fog).color.set(color);
  }
  private highlightBatch = new BoxBatch(64);
  private selectionRing: Mesh;
  private ground: Mesh;
  private sun: DirectionalLight;
  private layoutKey = '';
  private sizeKey = '';
  private lastTick = -1;
  private quality: QualitySettings;
  private groundPlane: Mesh;
  /** 強調表示するセル（オーダーの商品タップなど） */
  highlightCells: { x: number; z: number; color: string }[] = [];
  selectedRobotId: number | null = null;
  private gridLines: LineSegments | null = null;
  /** 建設モード: グリッド表示 */
  showGrid = false;
  private iconBatch = new BoxBatch(1);
  private groundMonth = 0;
  readonly effects: Effects;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: QualitySettings,
    fxOverlay: HTMLElement,
  ) {
    this.quality = quality;
    this.effects = new Effects(canvas, fxOverlay);
    this.renderer = new WebGLRenderer({ canvas, antialias: quality.antialias, powerPreference: 'high-performance' });
    this.renderer.setPixelRatio(quality.pixelRatio);
    this.renderer.shadowMap.enabled = quality.shadows;
    this.scene.background = new Color('#dfe9f3');
    this.scene.fog = new Fog('#dfe9f3', 60, 140);

    this.camera = new PerspectiveCamera(45, 1, 0.1, 300);
    this.controls = new CameraController(this.camera, canvas);

    const hemi = new HemisphereLight('#ffffff', '#8899aa', 0.9);
    this.scene.add(hemi);
    this.scene.add(new AmbientLight('#ffffff', 0.25));
    this.sun = new DirectionalLight('#fff4e0', 1.4);
    this.sun.castShadow = quality.shadows;
    this.sun.shadow.mapSize.set(2048, 2048);
    this.scene.add(this.sun);

    this.ground = new Mesh(new PlaneGeometry(400, 400), new MeshLambertMaterial({ color: COLORS.ground }));
    this.ground.rotation.x = -Math.PI / 2;
    this.ground.position.y = -RENDER.floorThickness - 0.01;
    this.ground.receiveShadow = quality.shadows;
    this.scene.add(this.ground);

    this.groundPlane = new Mesh(new PlaneGeometry(1, 1), new MeshLambertMaterial({ visible: false }));
    this.groundPlane.rotation.x = -Math.PI / 2;
    this.scene.add(this.groundPlane);

    this.selectionRing = new Mesh(
      new RingGeometry(0.45, 0.6, 24),
      new MeshLambertMaterial({ color: '#ffd400', emissive: '#ffb000', transparent: true, opacity: 0.9 }),
    );
    this.selectionRing.rotation.x = -Math.PI / 2;
    this.selectionRing.visible = false;
    this.scene.add(this.selectionRing);

    this.scene.add(this.staticGroup, this.dynamicGroup);
    this.dynamicGroup.add(this.highlightBatch.mesh);
    for (const o of this.effects.objects) this.scene.add(o);
    this.resize();
  }

  setQuality(q: QualitySettings): void {
    this.quality = q;
    this.renderer.setPixelRatio(q.pixelRatio);
    this.renderer.shadowMap.enabled = q.shadows;
    this.sun.castShadow = q.shadows;
    this.ground.receiveShadow = q.shadows;
    this.layoutKey = ''; // 影設定を反映するため作り直す
  }

  resize(): void {
    const w = this.canvas.clientWidth || 1;
    const h = this.canvas.clientHeight || 1;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
    this.photoRig?.setSize(w, h);
  }

  /** 倉庫全体が収まる初期構図に合わせ直す（起動直後に画面サイズが変わったとき用） */
  refit(): void {
    if (!this.layoutKey) return;
    this.controls.fitForAspect(this.camera.aspect);
  }

  // ---------------------------------------------------------------- static
  private layoutKeyOf(w: WorldState): string {
    return `${w.width}x${w.height}:${w.levels}:${w.cells.join('')}:${w.stations.map((s) => s.id + s.kind).join(',')}:${w.ports.map((p) => (p.closed ? 'c' : 'o')).join('')}:${this.quality.level}`;
  }

  railHeight(w: WorldState): number {
    return RENDER.railBaseHeight + w.levels * RENDER.binHeight + 0.15;
  }

  /**
   * ドローンの飛行高さ（★ 棚の高さ + 棚ロボの背丈 + ドローンがぶら下げる荷物の最大の高さ + 余裕）。
   * 段数を上げれば上がり、ドローンの積載を上げれば（持てるビンが増えれば）さらに上がる。全ドローン同じ高度。
   * 荷物は本体の下に吊るので、棚ロボの天面と荷物の底がぶつからない高さにする（棚の中を飛んで見えないように）
   */
  droneHeight(w: WorldState): number {
    let bins = 1;
    for (const r of w.robots) if (isDrone(r)) bins = Math.max(bins, ROBOT.cargo[Math.min(r.cargoLevel, ROBOT.cargo.length - 1)].bins);
    return this.railHeight(w) + RENDER.shelfRobotHeight + RENDER.droneClearance + RENDER.droneHangerLength + bins * RENDER.binHeight;
  }

  private rebuildStatic(w: WorldState): void {
    this.staticGroup.clear();
    this.floorBatch.dispose();
    this.frameBatch.dispose();
    this.miscBatch.dispose();
    const cells = w.width * w.height;
    const sh = this.quality.shadows;
    this.floorBatch = new BoxBatch(cells + 8, { receiveShadow: sh });
    this.frameBatch = new BoxBatch(w.stacks.length * 8 + w.ports.length * 8 + 64, { castShadow: sh });
    this.miscBatch = new BoxBatch(w.stations.length * 12 + w.inboundDock.length * 4 + w.outboundDock.length * 4 + 64, { castShadow: sh });
    const ft = RENDER.floorThickness;

    this.floorBatch.begin();
    for (let z = 0; z < w.height; z++) {
      for (let x = 0; x < w.width; x++) {
        const k = w.cells[z * w.width + x];
        let color = (x + z) % 2 === 0 ? COLORS.floor : COLORS.floorAlt;
        if (k === 'waitSpot') color = COLORS.waitSpot;
        else if (k === 'port') color = w.ports.find((p) => p.x === x && p.z === z)?.closed ? COLORS.portClosed : COLORS.port;
        else if (k === 'stack') color = COLORS.stackTile;
        else if (k === 'pickStation') color = COLORS.stationTile;
        else if (k === 'inboundStation') color = COLORS.inboundTile;
        else if (k === 'inboundDock') color = COLORS.dockIn;
        else if (k === 'outboundDock') color = COLORS.dockOut;
        this.floorBatch.add(x + 0.5, -ft / 2, z + 0.5, 0.98, ft, 0.98, color);
      }
    }
    // 外壁（低い壁。カメラの邪魔にならないよう高さは控えめ）
    const wh = RENDER.wallHeight;
    const t = 0.25;
    this.floorBatch.add(w.width / 2, wh / 2, -t / 2, w.width + 2 * t, wh, t, COLORS.wall);
    this.floorBatch.add(w.width / 2, wh / 2, w.height + t / 2, w.width + 2 * t, wh, t, COLORS.wall);
    this.floorBatch.add(-t / 2, wh / 2, w.height / 2, t, wh, w.height, COLORS.wall);
    this.floorBatch.add(w.width + t / 2, wh / 2, w.height / 2, t, wh, w.height, COLORS.wall);
    this.floorBatch.end();

    // 棚フレーム: スタックとポートの四隅に柱、上部にレール
    const rh = this.railHeight(w);
    this.frameBatch.begin();
    const posts = new Set<string>();
    const railCells = [...w.stacks.map((s) => ({ x: s.x, z: s.z })), ...w.ports.map((p) => ({ x: p.x, z: p.z }))];
    for (const c of railCells) {
      for (const [dx, dz] of [
        [0, 0],
        [1, 0],
        [0, 1],
        [1, 1],
      ]) {
        const key = `${c.x + dx},${c.z + dz}`;
        if (posts.has(key)) continue;
        posts.add(key);
        this.frameBatch.add(c.x + dx, rh / 2, c.z + dz, 0.07, rh, 0.07, COLORS.frame);
      }
      // レール（セルの縁 4辺）
      this.frameBatch.add(c.x + 0.5, rh, c.z, 1, 0.06, 0.08, COLORS.rail);
      this.frameBatch.add(c.x + 0.5, rh, c.z + 1, 1, 0.06, 0.08, COLORS.rail);
      this.frameBatch.add(c.x, rh, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
      this.frameBatch.add(c.x + 1, rh, c.z + 0.5, 0.08, 0.06, 1, COLORS.rail);
    }
    this.frameBatch.end();

    // ステーション・入出荷口
    this.miscBatch.begin();
    for (const s of w.stations) {
      const cx = s.x + 0.5;
      const cz = s.z + 0.5;
      this.miscBatch.add(cx, 0.35, cz, 0.9, 0.7, 0.5, COLORS.desk); // 机
      const shirt = s.kind === 'pick' ? COLORS.shirtPick : COLORS.shirtInbound;
      this.miscBatch.add(cx, 0.55, cz + 0.3, 0.36, 0.5, 0.22, shirt); // 体
      this.miscBatch.add(cx, 0.95, cz + 0.3, 0.28, 0.28, 0.28, COLORS.person); // 頭
      this.miscBatch.add(cx - 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
      this.miscBatch.add(cx + 0.22, 0.6, cz + 0.3, 0.1, 0.4, 0.12, COLORS.person);
      // 看板
      this.miscBatch.add(cx, 1.5, cz, 0.6, 0.3, 0.06, s.kind === 'pick' ? '#2e8b57' : '#d2691e');
    }
    for (const d of w.inboundDock) {
      this.miscBatch.add(d.x + 0.5, 0.02, d.z + 0.5, 0.9, 0.04, 0.9, '#5f7389');
      this.miscBatch.add(d.x + 0.5, 0.1, d.z + 0.5, 0.15, 0.2, 0.9, '#ffd400');
    }
    for (const d of w.outboundDock) {
      this.miscBatch.add(d.x + 0.5, 0.02, d.z + 0.5, 0.9, 0.04, 0.9, '#8a5f5f');
      this.miscBatch.add(d.x + 0.5, 0.1, d.z + 0.5, 0.15, 0.2, 0.9, '#ffd400');
    }
    this.miscBatch.end();

    this.staticGroup.add(this.floorBatch.mesh, this.frameBatch.mesh, this.miscBatch.mesh);

    // 建設モード用グリッド線
    const pts: number[] = [];
    const gy = 0.02;
    for (let x = 0; x <= w.width; x++) pts.push(x, gy, 0, x, gy, w.height);
    for (let z = 0; z <= w.height; z++) pts.push(0, gy, z, w.width, gy, z);
    const geo = new BufferGeometry();
    geo.setAttribute('position', new Float32BufferAttribute(pts, 3));
    this.gridLines = new LineSegments(geo, new LineBasicMaterial({ color: '#1d2733', transparent: true, opacity: 0.35 }));
    this.gridLines.visible = this.showGrid;
    this.staticGroup.add(this.gridLines);

    // 光・地面・ピック用平面
    this.sun.position.set(w.width * 0.6, 30, w.height * 1.2);
    this.sun.target.position.set(w.width / 2, 0, w.height / 2);
    this.staticGroup.add(this.sun.target);
    const cam = this.sun.shadow.camera;
    const r = Math.max(w.width, w.height) * 0.8;
    cam.left = -r;
    cam.right = r;
    cam.top = r;
    cam.bottom = -r;
    cam.near = 1;
    cam.far = 100;
    cam.updateProjectionMatrix();
    this.ground.position.x = w.width / 2;
    this.ground.position.z = w.height / 2;
    this.groundPlane.scale.set(w.width, w.height, 1);
    this.groundPlane.position.set(w.width / 2, 0, w.height / 2);

    // 動的バッチの容量を確保
    this.binBatch.dispose();
    this.robotBatch.dispose();
    this.iconBatch.dispose();
    const maxBins = w.stacks.length * Math.max(w.levels, 1) + 64 + INBOUND_WORKER.dockDisplayMax * w.inboundDock.length * 2;
    this.binBatch = new BoxBatch(maxBins, { castShadow: sh });
    this.robotBatch = new BoxBatch(w.robots.length * 24 + 64, { castShadow: sh }); // ドローンは箱が多い（腕・ローター）
    this.iconBatch = new BoxBatch((w.stacks.length + w.ports.length * 8 + w.robots.length * 4) * ICON_VOXELS_MAX);
    this.dynamicGroup.clear();
    this.dynamicGroup.add(this.binBatch.mesh, this.robotBatch.mesh, this.iconBatch.mesh, this.highlightBatch.mesh);
    this.effects.placeFixtures(w);
  }

  // ---------------------------------------------------------------- dynamic
  /** alpha: 現在 tick 内の補間係数 0..1 */
  render(w: WorldState, alpha: number): void {
    const key = this.layoutKeyOf(w);
    if (key !== this.layoutKey) {
      const sizeChanged = !this.layoutKey || this.sizeKey !== `${w.width}x${w.height}`;
      this.layoutKey = key;
      this.sizeKey = `${w.width}x${w.height}`;
      this.rebuildStatic(w);
      // 倉庫の大きさが変わったときだけカメラを合わせ直す（建設でスタックを置いただけなら視点はそのまま）
      if (sizeChanged) {
        this.controls.setWarehouse(w.width, w.height);
        this.controls.fitForAspect(this.camera.aspect);
        // 霧と描画距離は倉庫の大きさに合わせる（64×48 で床が霧に隠れないように）
        const diag = Math.hypot(w.width, w.height);
        const fog = this.scene.fog as Fog;
        fog.near = Math.max(60, diag * 2.5);
        fog.far = Math.max(140, diag * 5);
        this.camera.far = Math.max(300, diag * 6);
        this.camera.updateProjectionMatrix();
      }
      this.lastTick = -1;
    }
    if (w.tick !== this.lastTick || this.robotBatch.mesh.count === 0) {
      this.lastTick = w.tick;
      this.drawBins(w);
    }
    if (this.groundMonth !== w.calendar.month) {
      this.groundMonth = w.calendar.month;
      (this.ground.material as MeshLambertMaterial).color.set(groundColorForMonth(w.calendar.month));
    }
    if (this.gridLines) this.gridLines.visible = this.showGrid;
    this.drawFrame(w, alpha, 0);
  }

  /** 動く物（ロボ・ハイライト）を描いて 1 コマ出す。t はシャッター合成のコマ位置（ローターの回転ずらし用） */
  private drawFrame(w: WorldState, alpha: number, t: number): void {
    void t;
    this.drawRobots(w, alpha);
    this.drawHighlights(w);
    if (this.photoRig) this.photoRig.render();
    else this.renderer.render(this.scene, this.camera);
  }

  private binColor(w: WorldState, binId: number): Color | string {
    const b = w.bins[binId];
    if (!b || b.item === null) return COLORS.emptyBin;
    const ratio = b.qty / Math.max(1, w.binCapacity);
    if (b.qty <= 0) return COLORS.emptyBin;
    if (ratio < BIN.criticalStockRatio) return COLORS.critBin;
    if (ratio < BIN.lowStockRatio) return COLORS.lowBin;
    return itemDef(b.item).color;
  }

  /** ビンの上に商品アイコンを押し出したボクセルを載せる（§10）。見える（頂上の）ビンだけ */
  private drawIcon(w: WorldState, binId: number, cx: number, topY: number, cz: number, scale = 1): void {
    const b = w.bins[binId];
    if (!b?.item || b.qty <= 0) return;
    const vox = iconVoxels(b.item);
    const cell = (RENDER.binSize * 0.7 * scale) / ICON_RES;
    const h = 0.06;
    for (const v of vox) {
      this.iconBatch.add(cx + (v.x - ICON_RES / 2 + 0.5) * cell, topY + h / 2, cz + (v.z - ICON_RES / 2 + 0.5) * cell, cell, h, cell, v.color);
    }
  }

  private drawBins(w: WorldState): void {
    const bh = RENDER.binHeight;
    const bs = RENDER.binSize;
    this.binBatch.begin();
    this.iconBatch.begin();
    for (const s of w.stacks) {
      s.bins.forEach((id, level) => {
        const b = w.bins[id];
        const empty = !b || b.item === null || b.qty <= 0;
        // 空ビンは小さく描いて、下の在庫が見えるようにする
        const size = empty ? bs * 0.55 : bs;
        const h = empty ? bh * 0.5 : bh * 0.92;
        this.binBatch.add(s.x + 0.5, RENDER.railBaseHeight + level * bh + (empty ? bh * 0.25 : bh / 2), s.z + 0.5, size, h, size, this.binColor(w, id));
      });
      if (s.bins.length) {
        const top = s.bins[s.bins.length - 1];
        const topBin = w.bins[top];
        if (topBin?.item && topBin.qty > 0) this.drawIcon(w, top, s.x + 0.5, RENDER.railBaseHeight + s.bins.length * bh - bh * 0.04, s.z + 0.5);
        else {
          // 頂上が空ビンなら、その下にある一番上の在庫のアイコンを小さく出す（見た目と在庫の差を減らす）
          const stocked = [...s.bins].reverse().find((id) => w.bins[id]?.item && w.bins[id].qty > 0);
          if (stocked !== undefined) this.drawIcon(w, stocked, s.x + 0.5, RENDER.railBaseHeight + s.bins.length * bh - bh * 0.45, s.z + 0.5, 0.6);
        }
      }
    }
    // 入荷口のパレット（商品の山）。表示は dockDisplayMax 個まで
    const docks = w.inboundDock;
    if (docks.length) {
      w.pallets.slice(0, INBOUND_WORKER.dockDisplayMax * docks.length).forEach((p, i) => {
        const d = docks[i % docks.length];
        const layer = Math.floor(i / docks.length);
        const h = Math.min(0.9, 0.2 + p.qty / 40);
        this.binBatch.add(d.x + 0.5, 0.05 + layer * 0.5 + h / 2, d.z + 0.5, 0.7, h, 0.7, itemDef(p.item).color);
        this.binBatch.add(d.x + 0.5, 0.05 + layer * 0.5 + 0.02, d.z + 0.5, 0.86, 0.06, 0.86, '#a0783c');
      });
    }
    for (const p of w.ports) {
      // ポートのビンは床面近くに並べる（出庫側は前、返却側は後ろ）
      p.outbound.forEach((id, i) => this.binBatch.add(p.x + 0.5, 0.15 + i * bh * 0.5, p.z + 0.5, bs * 0.8, bh * 0.5, bs * 0.8, this.binColor(w, id)));
      p.returns.forEach((id, i) => this.binBatch.add(p.x + 0.5, 0.15 + (i + p.outbound.length) * bh * 0.5, p.z + 0.5, bs * 0.7, bh * 0.5, bs * 0.7, this.binColor(w, id)));
      const top = p.returns.length ? p.returns[p.returns.length - 1] : p.outbound[p.outbound.length - 1];
      if (top !== undefined) this.drawIcon(w, top, p.x + 0.5, 0.15 + (p.outbound.length + p.returns.length) * bh * 0.5 - bh * 0.25, p.z + 0.5, 0.8);
    }
    this.binBatch.end();
    this.iconBatch.end();
  }

  private robotWorldPos(r: Robot, alpha: number, out: Vector3): void {
    let x = r.pose.x + 0.5;
    let z = r.pose.z + 0.5;
    if (r.moveTo && r.actTotal > 0) {
      const done = r.actTotal - r.actRemaining;
      const t = Math.min(1, Math.max(0, (done + alpha) / r.actTotal));
      x += (r.moveTo.x - r.pose.x) * t;
      z += (r.moveTo.z - r.pose.z) * t;
    }
    out.set(x, 0, z);
  }

  private readonly tmpPos = new Vector3();

  private drawRobots(w: WorldState, alpha: number): void {
    const rh = this.railHeight(w);
    const bh = RENDER.binHeight;
    this.robotBatch.begin();
    this.selectionRing.visible = false;
    for (const r of w.robots) {
      this.robotWorldPos(r, alpha, this.tmpPos);
      const x = this.tmpPos.x;
      const z = this.tmpPos.z;
      let dirF = r.pose.dir as number;
      if (r.phase === 'turning' && r.moveTo && r.actTotal > 0) {
        const t = Math.min(1, (r.actTotal - r.actRemaining + alpha) / r.actTotal);
        let d = r.moveTo.dir - r.pose.dir;
        if (d > 2) d -= 4;
        if (d < -2) d += 4;
        dirF = r.pose.dir + d * t;
      }
      const rot = (dirF * Math.PI) / 2;
      if (isDrone(r)) {
        // ドローン: 棚ロボより上の空中レイヤー。本体＋4 本の腕とローター、ビンは下にぶら下げる
        const y = this.droneHeight(w);
        this.robotBatch.add(x, y, z, 0.5, 0.16, 0.5, this.robotColors.drone, rot);
        this.robotBatch.add(x, y + 0.1, z, 0.3, 0.06, 0.3, this.robotColors.droneDark, rot);
        // ローターは実機どおり、隣り合うものが逆回転（対角どうしが同じ向き）。トルクを打ち消す配置
        const spin = ((w.tick + alpha) * 0.9) % (Math.PI * 2);
        for (const [dx, dz] of [
          [-0.42, -0.42],
          [0.42, -0.42],
          [-0.42, 0.42],
          [0.42, 0.42],
        ]) {
          const dir = dx * dz > 0 ? 1 : -1; // 左前・右後ろが時計回り、右前・左後ろが反時計回り
          this.robotBatch.add(x + dx * 0.55, y, z + dz * 0.55, 0.5, 0.05, 0.08, this.robotColors.droneDark, Math.atan2(dz, dx));
          this.robotBatch.add(x + dx, y + 0.06, z + dz, 0.34, 0.03, 0.08, COLORS.rotor, spin * dir);
          this.robotBatch.add(x + dx, y + 0.06, z + dz, 0.08, 0.03, 0.34, COLORS.rotor, spin * dir);
        }
        r.carrying.forEach((id, i) => {
          this.robotBatch.add(x, y - RENDER.droneHangerLength - bh / 2 - i * bh, z, RENDER.binSize * 0.8, bh * 0.9, RENDER.binSize * 0.8, this.binColor(w, id));
        });
        if (r.id === this.selectedRobotId) {
          this.selectionRing.visible = true;
          this.selectionRing.position.set(x, y - 0.15, z);
        }
      } else if (r.kind === 'shelf') {
        const y = rh + 0.25;
        const body = isDoubleDecker(r) ? this.robotColors.double : this.robotColors.shelf;
        this.robotBatch.add(x, y, z, 0.78, 0.36, 0.78, body, rot);
        this.robotBatch.add(x, y + 0.24, z, 0.5, 0.12, 0.5, shade(body, -0.15), rot);
        if (isDoubleDecker(r)) {
          // 2 段持ちの目印: 四隅の支柱とレールの下の第 2 デッキ
          for (const [dx, dz] of [
            [-0.34, -0.34],
            [0.34, -0.34],
            [-0.34, 0.34],
            [0.34, 0.34],
          ]) {
            this.robotBatch.add(x + dx, rh - bh, z + dz, 0.06, bh * 2, 0.06, shade(body, -0.3));
          }
        }
        // 車輪
        for (const [dx, dz] of [
          [-0.32, -0.32],
          [0.32, -0.32],
          [-0.32, 0.32],
          [0.32, 0.32],
        ]) {
          this.robotBatch.add(x + dx, rh + 0.07, z + dz, 0.14, 0.14, 0.14, '#222');
        }
        // 運搬中のビン（本体の下にぶら下げる）
        r.carrying.forEach((id, i) => {
          this.robotBatch.add(x, rh - bh / 2 - i * bh, z, RENDER.binSize * 0.9, bh * 0.9, RENDER.binSize * 0.9, this.binColor(w, id));
        });
        if (r.id === this.selectedRobotId) {
          this.selectionRing.visible = true;
          this.selectionRing.position.set(x, rh + 0.08, z);
        }
      } else {
        const shape = shapeFor(r.cargoLevel);
        const y = 0.17;
        // 向きベクトル（補間した角度）。1×2 はアンカー（前）から後ろへ伸びる
        const fx = Math.cos(rot);
        const fz = Math.sin(rot);
        let cx = x;
        let cz = z;
        let bw = 0.8;
        let bl = 0.8;
        let bodyRot = -rot;
        if (shape.w === 1 && shape.l === 2) {
          cx -= fx * 0.5;
          cz -= fz * 0.5;
          bw = 1.8; // 長辺が進行方向
          bl = 0.8;
        } else if (shape.w === 2) {
          cx += 0.5;
          cz += 0.5;
          bw = 1.8;
          bl = 1.8;
          bodyRot = 0;
        }
        this.robotBatch.add(cx, y, cz, bw, 0.3, bl, this.robotColors.amr, bodyRot);
        this.robotBatch.add(cx, y + 0.17, cz, bw * 0.9, 0.06, bl * 0.9, this.robotColors.amrDark, bodyRot);
        // ライト（進行方向）
        const lx = shape.w === 2 ? cx + fx * 0.85 : x + fx * 0.4;
        const lz = shape.w === 2 ? cz + fz * 0.85 : z + fz * 0.4;
        this.robotBatch.add(lx, 0.2, lz, 0.12, 0.08, 0.12, '#ffe066');
        r.carrying.forEach((id, i) => {
          // 積み重ねて運ぶ（底面積が広い設定なら横にも並べる）
          const perLayer = Math.max(1, Math.round(bw / 0.8) * Math.round(bl / 0.8));
          const layer = Math.floor(i / perLayer);
          const slot = i % perLayer;
          let ox = 0;
          let oz = 0;
          if (perLayer === 2) {
            const k = slot === 0 ? 0.45 : -0.45;
            ox = fx * k;
            oz = fz * k;
          } else if (perLayer >= 4) {
            ox = ((slot % 2) - 0.5) * 0.9;
            oz = (Math.floor(slot / 2) - 0.5) * 0.9;
          }
          const yy = 0.4 + bh / 2 + layer * bh * 0.95;
          this.robotBatch.add(cx + ox, yy, cz + oz, RENDER.binSize * 0.85, bh * 0.9, RENDER.binSize * 0.85, this.binColor(w, id), bodyRot);
        });
        if (r.id === this.selectedRobotId) {
          this.selectionRing.visible = true;
          this.selectionRing.position.set(cx, 0.03, cz);
        }
      }
    }
    this.robotBatch.end();
  }

  private drawHighlights(w: WorldState): void {
    this.highlightBatch.begin();
    const rh = this.railHeight(w);
    const t = (Math.sin(performance.now() / 180) + 1) / 2;
    for (const h of this.highlightCells) {
      const k = w.cells[h.z * w.width + h.x];
      const y = k === 'stack' ? rh + 0.35 : 0.05;
      this.highlightBatch.add(h.x + 0.5, y + t * 0.1, h.z + 0.5, 1.02, 0.06, 1.02, h.color);
    }
    this.highlightBatch.end();
  }

  // ---------------------------------------------------------------- picking
  /**
   * タップ位置から対象を拾う（§2.2: 一番近い対象）。
   * 地面との交点を求め、そのセル周辺の設備・ロボを距離で選ぶ。
   */
  pick(w: WorldState, clientX: number, clientY: number, alpha: number, preferStatic = false): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // ★ 視線と「箱」の交差で選ぶ（以前は高さごとの平面との距離で、背の高い棚や寄った視点で外れていた）。一番手前に当たったものを採用
    const ray = this.raycaster.ray;
    const o = ray.origin;
    const d = ray.direction;
    const hitBox = (minX: number, minY: number, minZ: number, maxX: number, maxY: number, maxZ: number): number | null => {
      let tmin = 0;
      let tmax = Infinity;
      const axes: [number, number, number, number][] = [
        [o.x, d.x, minX, maxX],
        [o.y, d.y, minY, maxY],
        [o.z, d.z, minZ, maxZ],
      ];
      for (const [oo, dd, lo, hi] of axes) {
        if (Math.abs(dd) < 1e-9) {
          if (oo < lo || oo > hi) return null;
          continue;
        }
        let t1 = (lo - oo) / dd;
        let t2 = (hi - oo) / dd;
        if (t1 > t2) [t1, t2] = [t2, t1];
        tmin = Math.max(tmin, t1);
        tmax = Math.min(tmax, t2);
        if (tmin > tmax) return null;
      }
      return tmin;
    };
    const rh = this.railHeight(w);
    const dh = this.droneHeight(w);
    const bh = RENDER.binHeight;
    let best: { res: PickResult; t: number } | null = null;
    const consider = (res: PickResult, t: number | null, priority = 0) => {
      if (t === null) return;
      const tt = t - priority;
      if (!best || tt < best.t) best = { res, t: tt };
    };
    for (const r of w.robots) {
      // 指示中（preferStatic）は、通りかかった動いているロボにタップを横取りされないようにする
      if (preferStatic && r.moveTo) continue;
      this.robotWorldPos(r, alpha, this.tmpPos);
      const x = this.tmpPos.x;
      const z = this.tmpPos.z;
      let t: number | null;
      if (isDrone(r)) t = hitBox(x - 0.6, dh - 0.3 - r.carrying.length * bh, z - 0.6, x + 0.6, dh + 0.25, z + 0.6);
      else if (r.kind === 'shelf') t = hitBox(x - 0.5, rh - 0.1, z - 0.5, x + 0.5, rh + 0.7, z + 0.5);
      else t = hitBox(x - 0.5, 0, z - 0.5, x + 0.5, 0.55 + Math.ceil(r.carrying.length / 4) * bh, z + 0.5);
      consider({ kind: 'robot', id: r.id, x: r.pose.x, z: r.pose.z }, t, 0.3); // ロボは少し優先（棚の上に居ても選べる）
    }
    for (const s of w.stacks) consider({ kind: 'stack', id: s.id, x: s.x, z: s.z }, hitBox(s.x, 0, s.z, s.x + 1, rh + 0.1, s.z + 1));
    for (const pt of w.ports) consider({ kind: 'port', id: pt.id, x: pt.x, z: pt.z }, hitBox(pt.x, 0, pt.z, pt.x + 1, 0.4, pt.z + 1));
    for (const st of w.stations) consider({ kind: 'station', id: st.id, x: st.x, z: st.z }, hitBox(st.x, 0, st.z, st.x + 1, 1.7, st.z + 1));
    const b = best as { res: PickResult; t: number } | null;
    if (b) return b.res;
    if (Math.abs(d.y) > 1e-6) {
      const t = (0 - o.y) / d.y;
      if (t >= 0) {
        const x = Math.floor(o.x + d.x * t);
        const z = Math.floor(o.z + d.z * t);
        if (x >= 0 && z >= 0 && x < w.width && z < w.height) return { kind: 'cell', id: 0, x, z };
      }
    }
    return null;
  }

  dispose(): void {
    this.controls.dispose();
    this.renderer.dispose();
  }
}

// 参照を保つ（tree-shaking で消えないように）
void BoxGeometry;

/** アイコンを 8×8 に落としたボクセル（商品ごとにキャッシュ） */
const ICON_RES = 8;
const ICON_VOXELS_MAX = ICON_RES * ICON_RES;
const iconCache = new Map<string, { x: number; z: number; color: Color }[]>();
function iconVoxels(item: string): { x: number; z: number; color: Color }[] {
  const hit = iconCache.get(item);
  if (hit) return hit;
  const rows = ICONS[item];
  const out: { x: number; z: number; color: Color }[] = [];
  const step = ICON_SIZE / ICON_RES;
  if (rows) {
    for (let z = 0; z < ICON_RES; z++) {
      for (let x = 0; x < ICON_RES; x++) {
        // 2×2 ブロックの中で一番多い色（透明は数えない）
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
