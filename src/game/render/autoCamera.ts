/**
 * 眺めモードの自動カメラ（§10.1）。
 * 「倉庫全体をぐるっと回る」「忙しいロボを追いかける」「ピッキングステーションに寄る」をゆるく切り替える。
 */
import { Vector3 } from 'three';
import type { WorldState } from '../sim/types';
import type { CameraController } from './camera';

type Mode = 'orbit' | 'follow' | 'station';

const MODE_SECONDS: Record<Mode, number> = { orbit: 24, follow: 14, station: 12 };

export class AutoCamera {
  private mode: Mode = 'orbit';
  private modeTime = 0;
  private followId: number | null = null;
  private stationIdx = 0;
  private readonly want = { target: new Vector3(), azimuth: 0, polar: 0.9, distance: 20 };
  private azimuthDrift = 0;

  constructor(private readonly controls: CameraController) {}

  start(w: WorldState): void {
    this.mode = 'orbit';
    this.modeTime = 0;
    this.azimuthDrift = this.controls.azimuth;
    this.pickTargets(w);
  }

  private pickTargets(w: WorldState): void {
    const cx = w.width / 2;
    const cz = w.height / 2;
    const diag = Math.hypot(w.width, w.height);
    if (this.mode === 'orbit') {
      this.want.target.set(cx, 0, cz);
      this.want.distance = diag * 0.95;
      this.want.polar = 0.95;
    } else if (this.mode === 'follow') {
      const busy = w.robots.filter((r) => r.job && r.job.type !== 'park');
      const pick = busy.length ? busy[Math.floor(Math.random() * busy.length)] : w.robots[0];
      this.followId = pick?.id ?? null;
      this.want.distance = Math.max(7, diag * 0.35);
      this.want.polar = 0.8;
    } else {
      const sts = w.stations.filter((s) => s.kind === 'pick');
      const st = sts[this.stationIdx++ % Math.max(1, sts.length)];
      if (st) this.want.target.set(st.x + 0.5, 0, st.z + 0.5);
      this.want.distance = Math.max(6, diag * 0.3);
      this.want.polar = 0.7;
    }
  }

  /** dt: 秒 */
  update(w: WorldState, dt: number): void {
    this.modeTime += dt;
    if (this.modeTime > MODE_SECONDS[this.mode]) {
      this.modeTime = 0;
      const order: Mode[] = ['orbit', 'follow', 'station', 'orbit', 'follow'];
      this.mode = order[(order.indexOf(this.mode) + 1) % order.length];
      this.pickTargets(w);
    }
    if (this.mode === 'follow' && this.followId !== null) {
      const r = w.robots.find((r) => r.id === this.followId);
      if (r) {
        let x = r.pose.x + 0.5;
        let z = r.pose.z + 0.5;
        if (r.moveTo && r.actTotal > 0) {
          const t = (r.actTotal - r.actRemaining) / r.actTotal;
          x += (r.moveTo.x - r.pose.x) * t;
          z += (r.moveTo.z - r.pose.z) * t;
        }
        this.want.target.set(x, 0, z);
      }
    }
    this.azimuthDrift += dt * (this.mode === 'orbit' ? 0.12 : 0.05);
    const c = this.controls;
    const k = Math.min(1, dt * 1.2);
    c.target.lerp(this.want.target, k);
    c.distance += (this.want.distance - c.distance) * k;
    c.polar += (this.want.polar - c.polar) * k;
    c.azimuth = this.azimuthDrift;
    c.update();
  }
}
