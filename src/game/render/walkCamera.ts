/**
 * ウォークスルーのカメラ（★ フォトモード）: 倉庫の中を歩いたり、空を飛んで撮影位置を探す。
 *  キーボード: W/A/S/D・矢印で前後左右、Q/E で下降・上昇、Shift で速く。マウスの左ドラッグで見回す、ホイールで前後
 *  タッチ: 画面の左半分をドラッグで移動（上下 = 前後、左右 = 横歩き）、右半分をドラッグで見回す、2 本指の上下で上昇・下降
 *  タップ（移動量 < 8px）は onTap で通知する（ピント合わせに使う）
 * 床の下には潜れない。倉庫の外へは少しだけ出られる
 */
import { Euler, PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../data/balance';

export interface WalkPose {
  x: number;
  y: number;
  z: number;
  yaw: number;
  pitch: number;
}

const MOVE_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};
/** 目の高さの下限（床面から） */
const MIN_Y = 0.35;
/** 歩く速さ（ワールド単位/秒）。Shift で FAST 倍、タッチは始点から遠くへ引くほど速く（最大 STICK_MAX 倍） */
const WALK_SPEED = 5;
const FAST = 3;
const STICK_MAX = 2;
/** 2 本指の上下: 1px あたりの上昇・下降（ワールド単位） */
const LIFT_PER_PX = 0.008;
/** 見回す感度: 画面の高さいっぱいのドラッグで縦の画角 × LOOK_GAIN だけ回る（指の下の景色がついてくる感じ。望遠ほど細かく） */
const LOOK_GAIN = 1.2;
/** タッチの移動: ドラッグ量（px）→ 速さの倍率（画面の 1/4 で最大） */
const STICK_PX = 90;

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  startTime: number;
  moved: boolean;
  type: string;
  button: number;
  side: 'move' | 'look';
}

export class WalkCamera {
  enabled = false;
  readonly position = new Vector3(8, 1.4, 6);
  yaw = 0;
  pitch = 0;
  bounds = { minX: -4, maxX: 20, minZ: -4, maxZ: 16, maxY: 40 };
  onTap: ((clientX: number, clientY: number, ev: PointerEvent) => void) | null = null;
  private pointers = new Map<number, Pointer>();
  private stick = { x: 0, z: 0 };
  private lastTwoY = 0;
  private down = new Set<string>();
  private wheelMove = 0;
  private disposers: (() => void)[] = [];

  constructor(
    readonly camera: PerspectiveCamera,
    readonly dom: HTMLElement,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(el: HTMLElement | Window, type: K, fn: (ev: HTMLElementEventMap[K]) => void, opts?: AddEventListenerOptions) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(dom, 'pointerdown', (e) => this.onPointerDown(e));
    on(dom, 'pointermove', (e) => this.onPointerMove(e));
    on(dom, 'pointerup', (e) => this.onPointerUp(e));
    on(dom, 'pointercancel', (e) => this.onPointerUp(e));
    on(dom, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(window, 'keydown', (e) => this.onKey(e, true));
    on(window, 'keyup', (e) => this.onKey(e, false));
    on(window, 'blur', () => this.down.clear());
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  setWarehouse(width: number, height: number): void {
    // 倉庫の外にも出られる（オービットのカメラは外側にあることが多い）
    const m = Math.max(8, Math.hypot(width, height));
    this.bounds = { minX: -m, maxX: width + m, minZ: -m, maxZ: height + m, maxY: Math.max(20, m * 2) };
  }

  /** 今のカメラ（オービット）の位置と向きから始める（切り替えで視点が飛ばない） */
  enterFrom(camera: PerspectiveCamera): void {
    this.position.copy(camera.position);
    const dir = new Vector3();
    camera.getWorldDirection(dir);
    this.yaw = Math.atan2(-dir.x, -dir.z);
    this.pitch = Math.asin(Math.max(-1, Math.min(1, dir.y)));
    this.stick = { x: 0, z: 0 };
    this.down.clear();
    this.apply();
  }

  get pose(): WalkPose {
    return { x: this.position.x, y: this.position.y, z: this.position.z, yaw: this.yaw, pitch: this.pitch };
  }

  setPose(p: WalkPose): void {
    this.position.set(p.x, p.y, p.z);
    this.yaw = p.yaw;
    this.pitch = p.pitch;
    this.apply();
  }

  /** 向いている方向（単位ベクトル） */
  forward(out = new Vector3()): Vector3 {
    return out.set(-Math.sin(this.yaw) * Math.cos(this.pitch), Math.sin(this.pitch), -Math.cos(this.yaw) * Math.cos(this.pitch));
  }

  /** いまの画面に、オービットのカメラで同じ構図を作るときの注視点までの距離の目安 */
  suggestedDistance(): number {
    // 地面との交点までの距離（下を向いていなければ 12）
    const f = this.forward();
    if (f.y >= -0.05) return 12;
    return Math.min(60, Math.max(3, -this.position.y / f.y));
  }

  /** dt: 秒 */
  update(dt: number): void {
    if (!this.enabled) return;
    let mx = this.stick.x;
    let mz = this.stick.z;
    let my = 0;
    for (const k of this.down) {
      const v = MOVE_KEYS[k];
      if (v) {
        mx += v[0];
        mz += v[1];
      }
    }
    if (this.down.has('KeyQ')) my -= 1;
    if (this.down.has('KeyE')) my += 1;
    mz += this.wheelMove;
    this.wheelMove *= Math.pow(0.001, dt); // ホイールは減衰
    if (Math.abs(this.wheelMove) < 0.01) this.wheelMove = 0;
    if (!mx && !mz && !my) return;
    const fast = this.down.has('ShiftLeft') || this.down.has('ShiftRight') ? FAST : 1;
    const speed = WALK_SPEED * fast * dt;
    // 前後は向いている方向（水平成分）、左右は右方向
    const fx = -Math.sin(this.yaw);
    const fz = -Math.cos(this.yaw);
    const rx = Math.cos(this.yaw);
    const rz = -Math.sin(this.yaw);
    // 方向は正規化し、タッチの引き具合（最大 STICK_MAX）だけ速くする
    const mag = Math.hypot(mx, mz);
    const len = mag > 0 ? mag / Math.min(STICK_MAX, Math.max(1, mag)) : 1;
    this.position.x += ((fx * mz + rx * mx) / len) * speed;
    this.position.z += ((fz * mz + rz * mx) / len) * speed;
    // 上を向いて前進すると上がる（飛ぶ感じ）
    this.position.y += (Math.sin(this.pitch) * (mz / len) + my) * speed;
    this.apply();
  }

  /** rad/px */
  private lookSpeed(): number {
    const h = Math.max(200, this.dom.clientHeight || 0);
    return ((this.camera.fov * Math.PI) / 180 / h) * LOOK_GAIN;
  }

  private apply(): void {
    const b = this.bounds;
    this.position.x = Math.min(b.maxX, Math.max(b.minX, this.position.x));
    this.position.z = Math.min(b.maxZ, Math.max(b.minZ, this.position.z));
    this.position.y = Math.min(b.maxY, Math.max(MIN_Y, this.position.y));
    this.pitch = Math.max(-1.45, Math.min(1.45, this.pitch));
    this.camera.position.copy(this.position);
    this.camera.setRotationFromEuler(new Euler(this.pitch, this.yaw, 0, 'YXZ'));
  }

  private onKey(e: KeyboardEvent, down: boolean): void {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    const handled = e.code in MOVE_KEYS || ['KeyQ', 'KeyE', 'ShiftLeft', 'ShiftRight'].includes(e.code);
    if (!handled) return;
    if (down) this.down.add(e.code);
    else this.down.delete(e.code);
    if (e.code !== 'ShiftLeft' && e.code !== 'ShiftRight') e.preventDefault();
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) return;
    if (e.isPrimary) this.pointers.clear();
    try {
      this.dom.setPointerCapture?.(e.pointerId);
    } catch {
      /* 合成イベントなど、捕まえられないポインタ */
    }
    const rect = this.dom.getBoundingClientRect();
    // マウスは左ドラッグで見回す。タッチは左半分で移動、右半分で見回す
    const side: Pointer['side'] = e.pointerType === 'mouse' ? 'look' : e.clientX - rect.left < rect.width / 2 ? 'move' : 'look';
    this.pointers.set(e.pointerId, { id: e.pointerId, x: e.clientX, y: e.clientY, startX: e.clientX, startY: e.clientY, startTime: performance.now(), moved: false, type: e.pointerType, button: e.button, side });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      a.moved = b.moved = true;
      this.lastTwoY = (a.y + b.y) / 2;
      this.stick = { x: 0, z: 0 };
    }
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > CAMERA.tapThresholdPx) p.moved = true;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const cy = (a.y + b.y) / 2;
      this.position.y -= (cy - this.lastTwoY) * LIFT_PER_PX;
      this.lastTwoY = cy;
      this.apply();
      return;
    }
    if (p.side === 'move') {
      // 仮想スティック: 始点からのずれで速さ（上下 = 前後、左右 = 横）
      this.stick.x = Math.max(-STICK_MAX, Math.min(STICK_MAX, (p.x - p.startX) / STICK_PX));
      this.stick.z = Math.max(-STICK_MAX, Math.min(STICK_MAX, -(p.y - p.startY) / STICK_PX));
    } else {
      // 指の下の景色がついてくる向き（オービットのドラッグと同じ。指を右へ → 景色も右へ）
      const k = this.lookSpeed();
      this.yaw += dx * k;
      this.pitch += dy * k;
      this.apply();
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    try {
      this.dom.releasePointerCapture?.(e.pointerId);
    } catch {
      /* 捕まえていないポインタ */
    }
    if (p.side === 'move') this.stick = { x: 0, z: 0 };
    const quick = performance.now() - p.startTime < 600;
    if (!p.moved && quick && p.button === 0 && e.type === 'pointerup') this.onTap?.(e.clientX, e.clientY, e);
  }

  private onWheel(e: WheelEvent): void {
    if (!this.enabled) return;
    e.preventDefault();
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.wheelMove = Math.max(-3, Math.min(3, this.wheelMove - delta * 0.01));
  }
}
