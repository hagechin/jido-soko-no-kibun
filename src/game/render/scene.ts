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
  Raycaster,
  RingGeometry,
  Scene,
  Vector2,
  Vector3,
  WebGLRenderer,
  BoxGeometry,
} from 'three';
import { RENDER, BIN } from '../data/balance';
import { itemDef } from '../data/items';
import type { Robot, WorldState } from '../sim/types';
import { BoxBatch, shade } from './voxel';
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
  amr: '#3a7bd5',
  amrDark: '#2b5aa0',
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
  private highlightBatch = new BoxBatch(64);
  private selectionRing: Mesh;
  private ground: Mesh;
  private sun: DirectionalLight;
  private layoutKey = '';
  private lastTick = -1;
  private quality: QualitySettings;
  private groundPlane: Mesh;
  /** 強調表示するセル（オーダーの商品タップなど） */
  highlightCells: { x: number; z: number; color: string }[] = [];
  selectedRobotId: number | null = null;

  constructor(
    readonly canvas: HTMLCanvasElement,
    quality: QualitySettings,
  ) {
    this.quality = quality;
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
  }

  // ---------------------------------------------------------------- static
  private layoutKeyOf(w: WorldState): string {
    return `${w.width}x${w.height}:${w.levels}:${w.cells.join('')}:${w.stations.map((s) => s.id + s.kind).join(',')}:${this.quality.level}`;
  }

  railHeight(w: WorldState): number {
    return RENDER.railBaseHeight + w.levels * RENDER.binHeight + 0.15;
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
        else if (k === 'port') color = COLORS.port;
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
    const maxBins = w.stacks.length * Math.max(w.levels, 1) + 64;
    this.binBatch = new BoxBatch(maxBins, { castShadow: sh });
    this.robotBatch = new BoxBatch(w.robots.length * 12 + 64, { castShadow: sh });
    this.dynamicGroup.clear();
    this.dynamicGroup.add(this.binBatch.mesh, this.robotBatch.mesh, this.highlightBatch.mesh);
  }

  // ---------------------------------------------------------------- dynamic
  /** alpha: 現在 tick 内の補間係数 0..1 */
  render(w: WorldState, alpha: number): void {
    const key = this.layoutKeyOf(w);
    if (key !== this.layoutKey) {
      this.layoutKey = key;
      this.rebuildStatic(w);
      this.controls.setWarehouse(w.width, w.height);
      this.controls.fitForAspect(this.camera.aspect);
      this.lastTick = -1;
    }
    if (w.tick !== this.lastTick || this.robotBatch.mesh.count === 0) {
      this.lastTick = w.tick;
      this.drawBins(w);
    }
    this.drawRobots(w, alpha);
    this.drawHighlights(w);
    this.renderer.render(this.scene, this.camera);
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

  private drawBins(w: WorldState): void {
    const bh = RENDER.binHeight;
    const bs = RENDER.binSize;
    this.binBatch.begin();
    for (const s of w.stacks) {
      s.bins.forEach((id, level) => {
        this.binBatch.add(s.x + 0.5, RENDER.railBaseHeight + level * bh + bh / 2, s.z + 0.5, bs, bh * 0.92, bs, this.binColor(w, id));
      });
    }
    for (const p of w.ports) {
      // ポートのビンは床面近くに並べる（出庫側は前、返却側は後ろ）
      p.outbound.forEach((id, i) => this.binBatch.add(p.x + 0.5, 0.15 + i * bh * 0.5, p.z + 0.5, bs * 0.8, bh * 0.5, bs * 0.8, this.binColor(w, id)));
      p.returns.forEach((id, i) => this.binBatch.add(p.x + 0.5, 0.15 + (i + p.outbound.length) * bh * 0.5, p.z + 0.5, bs * 0.7, bh * 0.5, bs * 0.7, this.binColor(w, id)));
    }
    this.binBatch.end();
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
      const rot = (r.pose.dir * Math.PI) / 2;
      if (r.kind === 'shelf') {
        const y = rh + 0.25;
        this.robotBatch.add(x, y, z, 0.78, 0.36, 0.78, COLORS.shelfRobot, rot);
        this.robotBatch.add(x, y + 0.24, z, 0.5, 0.12, 0.5, shade(COLORS.shelfRobot, -0.15), rot);
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
        const cargo = r.cargoLevel;
        const fw = cargo >= 2 ? 1.8 : 0.8;
        const fl = cargo >= 1 ? 1.8 : 0.8;
        const y = 0.17;
        // 1×2 は向きに沿って長い。アンカー基準で後ろへ伸ばす
        let cx = x;
        let cz = z;
        if (cargo === 1) {
          const back = [
            [-0.5, 0],
            [0, -0.5],
            [0.5, 0],
            [0, 0.5],
          ][r.pose.dir];
          cx += back[0];
          cz += back[1];
        } else if (cargo === 2) {
          cx += 0.5;
          cz += 0.5;
        }
        const long = cargo === 1 && (r.pose.dir === 1 || r.pose.dir === 3);
        const w2 = cargo === 1 ? (long ? 0.8 : fl) : fw;
        const d2 = cargo === 1 ? (long ? fl : 0.8) : cargo === 2 ? 1.8 : 0.8;
        this.robotBatch.add(cx, y, cz, w2, 0.3, d2, COLORS.amr);
        this.robotBatch.add(cx, y + 0.17, cz, w2 * 0.9, 0.06, d2 * 0.9, COLORS.amrDark);
        // ライト（進行方向）
        const f = [
          [0.5, 0],
          [0, 0.5],
          [-0.5, 0],
          [0, -0.5],
        ][r.pose.dir];
        this.robotBatch.add(x + f[0] * 0.8, 0.2, z + f[1] * 0.8, 0.12, 0.08, 0.12, '#ffe066');
        r.carrying.forEach((id, i) => {
          const col = i % 2;
          const row = Math.floor(i / 2);
          const ox = cargo === 2 ? (col - 0.5) * 0.9 : 0;
          const oz = cargo >= 1 ? (row - (cargo === 1 ? 0.5 : 0.5)) * 0.9 : 0;
          const yy = 0.4 + bh / 2 + (cargo === 0 ? i * bh : 0);
          this.robotBatch.add(cx + ox, yy, cz + oz, RENDER.binSize * 0.85, bh * 0.9, RENDER.binSize * 0.85, this.binColor(w, id));
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
  pick(w: WorldState, clientX: number, clientY: number, alpha: number): PickResult | null {
    const rect = this.canvas.getBoundingClientRect();
    const ndc = new Vector2(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
    this.raycaster.setFromCamera(ndc, this.camera);
    // ロボは高さがあるので、レール高さの平面と地面の両方で交点を取り、近いほうを採用
    const ray = this.raycaster.ray;
    const hitAt = (y: number): Vector3 | null => {
      if (Math.abs(ray.direction.y) < 1e-6) return null;
      const t = (y - ray.origin.y) / ray.direction.y;
      if (t < 0) return null;
      return ray.origin.clone().addScaledVector(ray.direction, t);
    };
    const ground = hitAt(0);
    const rail = hitAt(this.railHeight(w) + 0.2);
    let best: { res: PickResult; d: number } | null = null;
    const consider = (res: PickResult, px: number, pz: number, pt: Vector3 | null, bonus = 0) => {
      if (!pt) return;
      const d = Math.hypot(pt.x - px, pt.z - pz) - bonus;
      if (!best || d < best.d) best = { res, d };
    };
    for (const r of w.robots) {
      this.robotWorldPos(r, alpha, this.tmpPos);
      consider({ kind: 'robot', id: r.id, x: r.pose.x, z: r.pose.z }, this.tmpPos.x, this.tmpPos.z, r.kind === 'shelf' ? rail : ground, 0.25);
    }
    for (const s of w.stacks) consider({ kind: 'stack', id: s.id, x: s.x, z: s.z }, s.x + 0.5, s.z + 0.5, rail);
    for (const p of w.ports) consider({ kind: 'port', id: p.id, x: p.x, z: p.z }, p.x + 0.5, p.z + 0.5, ground);
    for (const s of w.stations) consider({ kind: 'station', id: s.id, x: s.x, z: s.z }, s.x + 0.5, s.z + 0.5, ground);
    const b = best as { res: PickResult; d: number } | null;
    if (b && b.d < 1.1) return b.res;
    if (ground) {
      const x = Math.floor(ground.x);
      const z = Math.floor(ground.z);
      if (x >= 0 && z >= 0 && x < w.width && z < w.height) return { kind: 'cell', id: 0, x, z };
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
