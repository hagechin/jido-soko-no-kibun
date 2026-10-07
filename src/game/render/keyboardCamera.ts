/**
 * キーボードでの視点操作（眺めモードの MANUAL）。
 *  W/A/S/D・矢印: カメラの向き基準で前後左右に移動 / Q・E: 回転 / R・F: 見下ろし角 / Z・X（または +/−）: ズーム
 * 押している間だけ動き、速さは距離に比例する（遠いほど速い）。入力欄にフォーカスがあるときは何もしない
 */
import { CAMERA } from '../data/balance';
import type { CameraController } from './camera';

const PAN_KEYS: Record<string, [number, number]> = {
  KeyW: [0, 1],
  ArrowUp: [0, 1],
  KeyS: [0, -1],
  ArrowDown: [0, -1],
  KeyA: [-1, 0],
  ArrowLeft: [-1, 0],
  KeyD: [1, 0],
  ArrowRight: [1, 0],
};

export class KeyboardCamera {
  enabled = false;
  private down = new Set<string>();
  private readonly onKeyDown = (e: KeyboardEvent) => {
    if (!this.enabled || e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable)) return;
    if (this.handles(e.code)) {
      this.down.add(e.code);
      e.preventDefault();
    }
  };
  private readonly onKeyUp = (e: KeyboardEvent) => {
    this.down.delete(e.code);
  };
  private readonly onBlur = () => this.down.clear();

  constructor(private readonly controls: CameraController) {
    window.addEventListener('keydown', this.onKeyDown);
    window.addEventListener('keyup', this.onKeyUp);
    window.addEventListener('blur', this.onBlur);
  }

  dispose(): void {
    window.removeEventListener('keydown', this.onKeyDown);
    window.removeEventListener('keyup', this.onKeyUp);
    window.removeEventListener('blur', this.onBlur);
  }

  /** このキーを使うか（他の UI のショートカットと衝突しないよう、使うものだけ preventDefault する） */
  handles(code: string): boolean {
    return code in PAN_KEYS || ['KeyQ', 'KeyE', 'KeyR', 'KeyF', 'KeyZ', 'KeyX', 'Equal', 'Minus', 'NumpadAdd', 'NumpadSubtract'].includes(code);
  }

  /** いま何かキーを押しているか */
  get active(): boolean {
    return this.enabled && this.down.size > 0;
  }

  /** dt: 秒 */
  update(dt: number): void {
    if (!this.enabled || !this.down.size) return;
    const c = this.controls;
    let px = 0;
    let pz = 0;
    for (const k of this.down) {
      const v = PAN_KEYS[k];
      if (v) {
        px += v[0];
        pz += v[1];
      }
    }
    if (px || pz) {
      const len = Math.hypot(px, pz);
      const speed = CAMERA.keyPanSpeed * c.distance * dt;
      // カメラから見た前（ターゲット方向）と右
      const fx = -Math.sin(c.azimuth);
      const fz = -Math.cos(c.azimuth);
      const rx = Math.cos(c.azimuth);
      const rz = -Math.sin(c.azimuth);
      c.target.x += ((fx * pz + rx * px) / len) * speed;
      c.target.z += ((fz * pz + rz * px) / len) * speed;
    }
    if (this.down.has('KeyQ')) c.azimuth += CAMERA.keyRotateSpeed * dt;
    if (this.down.has('KeyE')) c.azimuth -= CAMERA.keyRotateSpeed * dt;
    if (this.down.has('KeyR')) c.polar -= CAMERA.keyTiltSpeed * dt;
    if (this.down.has('KeyF')) c.polar += CAMERA.keyTiltSpeed * dt;
    const zoomIn = this.down.has('KeyZ') || this.down.has('Equal') || this.down.has('NumpadAdd');
    const zoomOut = this.down.has('KeyX') || this.down.has('Minus') || this.down.has('NumpadSubtract');
    if (zoomIn !== zoomOut) c.distance *= Math.exp((zoomIn ? -1 : 1) * CAMERA.keyZoomSpeed * dt);
    c.update();
  }
}
