/**
 * ボクセル描画の小道具。箱をまとめて InstancedMesh で描く。
 */
import { BoxGeometry, Color, InstancedMesh, Matrix4, MeshLambertMaterial, Object3D, Quaternion, Vector3 } from 'three';

const _m = new Matrix4();
const _p = new Vector3();
const _q = new Quaternion();
const _s = new Vector3();
const _c = new Color();

export class BoxBatch {
  readonly mesh: InstancedMesh;
  private count = 0;

  constructor(capacity: number, opts: { castShadow?: boolean; receiveShadow?: boolean; geometry?: BoxGeometry } = {}) {
    const geo = opts.geometry ?? new BoxGeometry(1, 1, 1);
    const mat = new MeshLambertMaterial({ color: 0xffffff });
    this.mesh = new InstancedMesh(geo, mat, Math.max(1, capacity));
    this.mesh.count = 0;
    this.mesh.castShadow = opts.castShadow ?? false;
    this.mesh.receiveShadow = opts.receiveShadow ?? false;
    this.mesh.frustumCulled = false;
  }

  get capacity(): number {
    return this.mesh.instanceMatrix.count;
  }

  begin(): void {
    this.count = 0;
  }

  /** 中心座標 (x,y,z)、大きさ (w,h,d)、色 */
  add(x: number, y: number, z: number, w: number, h: number, d: number, color: Color | number | string, rotY = 0): void {
    if (this.count >= this.capacity) return;
    _p.set(x, y, z);
    _q.setFromAxisAngle(UP, rotY);
    _s.set(w, h, d);
    _m.compose(_p, _q, _s);
    this.mesh.setMatrixAt(this.count, _m);
    this.mesh.setColorAt(this.count, color instanceof Color ? color : _c.set(color));
    this.count++;
  }

  end(): void {
    this.mesh.count = this.count;
    this.mesh.instanceMatrix.needsUpdate = true;
    if (this.mesh.instanceColor) this.mesh.instanceColor.needsUpdate = true;
  }

  dispose(): void {
    this.mesh.geometry.dispose();
    (this.mesh.material as MeshLambertMaterial).dispose();
  }
}

const UP = new Vector3(0, 1, 0);

export function addTo(parent: Object3D, ...batches: BoxBatch[]): void {
  for (const b of batches) parent.add(b.mesh);
}

/** 色を少し明るく／暗く */
export function shade(hex: string | number, amount: number): Color {
  const c = new Color(hex);
  c.offsetHSL(0, 0, amount);
  return c;
}
