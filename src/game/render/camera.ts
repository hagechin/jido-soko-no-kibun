/**
 * カメラ操作（§2.3）。
 *  マウス: 左ドラッグ回転 / 右ドラッグパン / ホイールズーム
 *  タッチ: 1本指回転 / 2本指パン / ピンチズーム
 *  タップ（移動量 < 8px）は onTap で通知する。
 * 倉庫の外・地面の下には出られない。
 */
import { PerspectiveCamera, Vector3 } from 'three';
import { CAMERA } from '../data/balance';

interface PointerInfo {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  button: number;
  type: string;
  startTime: number;
  moved: boolean;
}

export interface CameraBounds {
  minX: number;
  maxX: number;
  minZ: number;
  maxZ: number;
  maxDistance: number;
}

export class CameraController {
  readonly target = new Vector3();
  azimuth = CAMERA.initialAzimuth;
  polar = CAMERA.initialPolar;
  distance = 18;
  bounds: CameraBounds = { minX: 0, maxX: 16, minZ: 0, maxZ: 12, maxDistance: 60 };
  onTap: ((clientX: number, clientY: number, ev: PointerEvent) => void) | null = null;
  onInteract: (() => void) | null = null;
  /** 自動カメラ中は入力で解除する用 */
  enabled = true;

  private pointers = new Map<number, PointerInfo>();
  private lastPinchDist = 0;
  private lastCentroid = { x: 0, y: 0 };
  private home = { distance: 18, azimuth: CAMERA.initialAzimuth, polar: CAMERA.initialPolar, target: new Vector3() };
  private readonly tmpForward = new Vector3();
  private readonly tmpRight = new Vector3();
  private disposers: (() => void)[] = [];

  constructor(
    readonly camera: PerspectiveCamera,
    readonly dom: HTMLElement,
  ) {
    const on = <K extends keyof HTMLElementEventMap>(
      el: HTMLElement | Window,
      type: K,
      fn: (ev: HTMLElementEventMap[K]) => void,
      opts?: AddEventListenerOptions,
    ) => {
      el.addEventListener(type, fn as EventListener, opts);
      this.disposers.push(() => el.removeEventListener(type, fn as EventListener, opts));
    };
    on(dom, 'pointerdown', (e) => this.onPointerDown(e));
    on(dom, 'pointermove', (e) => this.onPointerMove(e));
    on(dom, 'pointerup', (e) => this.onPointerUp(e));
    on(dom, 'pointercancel', (e) => this.onPointerUp(e));
    on(dom, 'lostpointercapture', (e) => this.onPointerUp(e));
    on(dom, 'wheel', (e) => this.onWheel(e), { passive: false });
    on(dom, 'contextmenu', (e) => e.preventDefault());
    dom.style.touchAction = 'none';
  }

  dispose(): void {
    for (const d of this.disposers) d();
    this.disposers = [];
  }

  /** 倉庫の大きさに合わせて可動範囲と初期位置を決める */
  setWarehouse(width: number, height: number): void {
    const diag = Math.hypot(width, height);
    this.bounds = { minX: 0, maxX: width, minZ: 0, maxZ: height, maxDistance: diag * CAMERA.maxDistanceFactor };
    this.home.target.set(width / 2, 0, height / 2);
    this.home.distance = diag * 1.05;
    this.reset();
  }

  reset(): void {
    this.target.copy(this.home.target);
    this.distance = this.home.distance;
    this.azimuth = this.home.azimuth;
    this.polar = this.home.polar;
    this.update();
  }

  /** 画面の縦横比に応じて、倉庫全体が収まる初期距離を計算する */
  fitForAspect(aspect: number): void {
    const w = this.bounds.maxX;
    const h = this.bounds.maxZ;
    const radius = Math.hypot(w, h) / 2;
    const vFov = (this.camera.fov * Math.PI) / 180;
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * aspect);
    const limiting = Math.min(vFov, hFov);
    this.home.distance = (radius / Math.tan(limiting / 2)) * CAMERA.fitMargin;
    this.reset();
  }

  update(): void {
    this.clamp();
    const sp = Math.sin(this.polar);
    const x = this.target.x + this.distance * sp * Math.sin(this.azimuth);
    const z = this.target.z + this.distance * sp * Math.cos(this.azimuth);
    const y = this.target.y + this.distance * Math.cos(this.polar);
    this.camera.position.set(x, y, z);
    this.camera.lookAt(this.target);
  }

  private clamp(): void {
    const b = this.bounds;
    this.target.x = Math.min(b.maxX, Math.max(b.minX, this.target.x));
    this.target.z = Math.min(b.maxZ, Math.max(b.minZ, this.target.z));
    this.target.y = 0;
    this.distance = Math.min(b.maxDistance, Math.max(CAMERA.minDistance, this.distance));
    this.polar = Math.min(CAMERA.maxPolar, Math.max(CAMERA.minPolar, this.polar));
  }

  rotate(dx: number, dy: number): void {
    this.azimuth -= dx * CAMERA.rotateSpeed;
    this.polar -= dy * CAMERA.rotateSpeed;
    this.update();
  }

  pan(dx: number, dy: number): void {
    const h = this.dom.clientHeight || 1;
    const fovScale = (2 * Math.tan((this.camera.fov * Math.PI) / 360) * this.distance) / h;
    this.tmpForward.set(-Math.sin(this.azimuth), 0, -Math.cos(this.azimuth));
    this.tmpRight.set(Math.cos(this.azimuth), 0, -Math.sin(this.azimuth));
    this.target.addScaledVector(this.tmpRight, -dx * fovScale * CAMERA.panSpeed);
    this.target.addScaledVector(this.tmpForward, dy * fovScale * CAMERA.panSpeed);
    this.update();
  }

  zoomBy(factor: number): void {
    this.distance *= factor;
    this.update();
  }

  private onPointerDown(e: PointerEvent): void {
    if (!this.enabled) {
      this.onInteract?.();
      return;
    }
    // 新しい主ポインタ = 新しいジェスチャ。取りこぼした pointerup があっても引きずらない
    if (e.isPrimary) this.pointers.clear();
    this.dom.setPointerCapture?.(e.pointerId);
    this.pointers.set(e.pointerId, {
      id: e.pointerId,
      x: e.clientX,
      y: e.clientY,
      startX: e.clientX,
      startY: e.clientY,
      button: e.button,
      type: e.pointerType,
      startTime: performance.now(),
      moved: false,
    });
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      this.lastPinchDist = Math.hypot(a.x - b.x, a.y - b.y);
      this.lastCentroid = { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
      a.moved = b.moved = true; // 2本指になったらタップ扱いしない
    }
    this.onInteract?.();
  }

  private onPointerMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dx = e.clientX - p.x;
    const dy = e.clientY - p.y;
    p.x = e.clientX;
    p.y = e.clientY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > CAMERA.tapThresholdPx) p.moved = true;

    if (this.pointers.size === 1) {
      if (p.type === 'mouse' && p.button === 2) this.pan(dx, dy);
      else if (p.type === 'mouse' && p.button === 1) this.pan(dx, dy);
      else this.rotate(dx, dy);
    } else if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const cx = (a.x + b.x) / 2;
      const cy = (a.y + b.y) / 2;
      if (this.lastPinchDist > 0) this.zoomBy(this.lastPinchDist / dist);
      this.pan(cx - this.lastCentroid.x, cy - this.lastCentroid.y);
      this.lastPinchDist = dist;
      this.lastCentroid = { x: cx, y: cy };
    }
  }

  private onPointerUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.dom.releasePointerCapture?.(e.pointerId);
    const quick = performance.now() - p.startTime < 600;
    if (!p.moved && quick && p.button === 0 && e.type === 'pointerup') {
      this.onTap?.(e.clientX, e.clientY, e);
    }
    if (this.pointers.size < 2) this.lastPinchDist = 0;
  }

  private onWheel(e: WheelEvent): void {
    e.preventDefault();
    if (!this.enabled) return;
    const delta = e.deltaMode === 1 ? e.deltaY * 16 : e.deltaY;
    this.zoomBy(Math.exp(delta * CAMERA.zoomWheelFactor));
    this.onInteract?.();
  }
}
