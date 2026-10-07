/**
 * 演出（§10）: 出荷の段ボールとコイン、ボーナスの文字ポップ、入荷トラック、季節のパーティクル、サイバーウィークの回転灯。
 * パーティクルはすべて小さな箱の InstancedMesh。文字は DOM。
 */
import { Color, Group, Mesh, BoxGeometry, MeshLambertMaterial, PointLight, Vector3, type PerspectiveCamera } from 'three';
import { RENDER } from '../data/balance';
import type { WorldState } from '../sim/types';
import { BoxBatch } from './voxel';

interface Particle {
  x: number;
  y: number;
  z: number;
  vx: number;
  vy: number;
  vz: number;
  life: number;
  maxLife: number;
  size: number;
  color: Color;
  gravity: number;
  kind: 'coin' | 'box' | 'weather';
}

interface TextPop {
  el: HTMLElement;
  x: number;
  y: number;
  z: number;
  life: number;
}

export type Weather = 'none' | 'snow' | 'rain' | 'petal' | 'leaf';

export function weatherForMonth(month: number): Weather {
  if (month === 12 || month === 1 || month === 2) return 'snow';
  if (month === 3 || month === 4) return 'petal';
  if (month === 6) return 'rain';
  if (month === 10 || month === 11) return 'leaf';
  return 'none';
}

export function groundColorForMonth(month: number): string {
  if (month === 12 || month === 1 || month === 2) return '#e8edf2';
  if (month === 3 || month === 4) return '#8fb573';
  if (month >= 5 && month <= 8) return '#6f9e58';
  if (month === 9) return '#9aa65e';
  return '#b08a4f';
}

const WEATHER_COLOR: Record<Weather, string> = { none: '#fff', snow: '#ffffff', rain: '#8fc1e8', petal: '#ffc6d9', leaf: '#d98a3a' };

export class Effects {
  private particles: Particle[] = [];
  private batch = new BoxBatch(600);
  private pops: TextPop[] = [];
  private truck: Group;
  private truckT = -1;
  private truckFrom = new Vector3();
  private truckTo = new Vector3();
  private beacon: Group;
  private beaconLight: PointLight;
  private weather: Weather = 'none';
  private weatherTimer = 0;
  private readonly tmp = new Vector3();

  constructor(
    private readonly host: HTMLElement,
    private readonly overlay: HTMLElement,
  ) {
    this.batch.mesh.castShadow = false;
    // トラック（荷台＋運転席＋車輪）
    this.truck = new Group();
    const body = new Mesh(new BoxGeometry(2.6, 1.2, 1.3), new MeshLambertMaterial({ color: '#e9eef2' }));
    body.position.set(-0.5, 0.9, 0);
    const cab = new Mesh(new BoxGeometry(0.9, 0.9, 1.2), new MeshLambertMaterial({ color: '#3b6fd6' }));
    cab.position.set(1.25, 0.75, 0);
    this.truck.add(body, cab);
    for (const [x, z] of [
      [-1.2, -0.6],
      [-1.2, 0.6],
      [0.9, -0.6],
      [0.9, 0.6],
    ]) {
      const wheel = new Mesh(new BoxGeometry(0.4, 0.4, 0.2), new MeshLambertMaterial({ color: '#222' }));
      wheel.position.set(x, 0.2, z);
      this.truck.add(wheel);
    }
    this.truck.visible = false;
    // 回転灯
    this.beacon = new Group();
    const base = new Mesh(new BoxGeometry(0.4, 0.2, 0.4), new MeshLambertMaterial({ color: '#333' }));
    const lamp = new Mesh(new BoxGeometry(0.3, 0.3, 0.3), new MeshLambertMaterial({ color: '#ff2020', emissive: '#ff0000' }));
    lamp.position.y = 0.25;
    const arm = new Mesh(new BoxGeometry(0.1, 0.1, 0.8), new MeshLambertMaterial({ color: '#ffaaaa', emissive: '#ff3030' }));
    arm.position.y = 0.25;
    this.beacon.add(base, lamp, arm);
    this.beaconLight = new PointLight('#ff2020', 0, 14);
    this.beaconLight.position.y = 0.6;
    this.beacon.add(this.beaconLight);
    this.beacon.visible = false;
  }

  get objects() {
    return [this.batch.mesh, this.truck, this.beacon];
  }

  placeFixtures(w: WorldState): void {
    // 回転灯は倉庫の中央上空
    this.beacon.position.set(w.width / 2, RENDER.railBaseHeight + w.levels * RENDER.binHeight + 2.2, w.height / 2);
  }

  // ------------------------------------------------------------- triggers
  /** 出荷: ステーションから出荷口へ段ボールが流れ、コインが飛ぶ */
  ship(w: WorldState, stationId: number, coins: number, bonus: number): void {
    const st = w.stations.find((s) => s.id === stationId);
    const dock = w.outboundDock[0];
    if (!st) return;
    const sx = st.x + 0.5;
    const sz = st.z + 0.5;
    const tx = dock ? dock.x + 0.5 : w.width;
    const tz = dock ? dock.z + 0.5 : sz;
    const dist = Math.hypot(tx - sx, tz - sz);
    const life = Math.max(1.2, dist / 6);
    this.particles.push({ x: sx, y: 1.0, z: sz, vx: (tx - sx) / life, vy: 1.2, vz: (tz - sz) / life, life, maxLife: life, size: 0.5, color: new Color('#c99a5b'), gravity: 1.0, kind: 'box' });
    const n = Math.min(12, 3 + Math.floor(coins / 40));
    for (let i = 0; i < n; i++) {
      this.particles.push({ x: sx, y: 1.2, z: sz, vx: (Math.random() - 0.5) * 2.5, vy: 3 + Math.random() * 2, vz: (Math.random() - 0.5) * 2.5, life: 1.1, maxLife: 1.1, size: 0.18, color: new Color('#ffd700'), gravity: 6, kind: 'coin' });
    }
    this.pop(sx, 1.6, sz, `+${coins}`, '#ffd700');
    if (bonus > 1) this.pop(sx, 2.2, sz, `×${bonus} ボーナス!`, '#ff8c42');
  }

  pickFlash(w: WorldState, stationId: number): void {
    const st = w.stations.find((s) => s.id === stationId);
    if (!st) return;
    for (let i = 0; i < 3; i++) this.particles.push({ x: st.x + 0.5, y: 0.9, z: st.z + 0.5, vx: (Math.random() - 0.5) * 1.5, vy: 1.5 + Math.random(), vz: (Math.random() - 0.5) * 1.5, life: 0.5, maxLife: 0.5, size: 0.1, color: new Color('#ffffff'), gravity: 4, kind: 'coin' });
  }

  /** 入荷トラックが入荷口にバックで着く */
  truckArrive(w: WorldState): void {
    const dock = w.inboundDock[0];
    if (!dock) return;
    // 西壁の外側から、入荷口の外に横付け
    this.truckTo.set(dock.x - 1.8, 0, dock.z + 0.5 + (w.inboundDock.length > 1 ? 0.5 : 0));
    this.truckFrom.set(dock.x - 1.8, 0, -6);
    this.truckT = 0;
    this.truck.visible = true;
    this.truck.rotation.y = Math.PI / 2;
  }

  setCyber(on: boolean): void {
    this.beacon.visible = on;
  }

  setMonth(month: number): void {
    this.weather = weatherForMonth(month);
  }

  pop(x: number, y: number, z: number, text: string, color: string): void {
    const el = document.createElement('div');
    el.className = 'fx-pop';
    el.textContent = text;
    el.style.color = color;
    this.overlay.append(el);
    this.pops.push({ el, x, y, z, life: 1.4 });
    while (this.pops.length > 12) this.pops.shift()!.el.remove();
  }

  // ------------------------------------------------------------- update
  update(w: WorldState, dt: number, camera: PerspectiveCamera, now: number): void {
    // 季節パーティクル
    if (this.weather !== 'none') {
      this.weatherTimer += dt;
      const rate = this.weather === 'rain' ? 60 : 14;
      while (this.weatherTimer > 1 / rate && this.particles.length < 500) {
        this.weatherTimer -= 1 / rate;
        const x = -3 + Math.random() * (w.width + 6);
        const z = -3 + Math.random() * (w.height + 6);
        const rain = this.weather === 'rain';
        this.particles.push({ x, y: 7 + Math.random() * 2, z, vx: rain ? 0 : (Math.random() - 0.5) * 0.6, vy: rain ? -9 : -0.8 - Math.random() * 0.5, vz: rain ? 0 : (Math.random() - 0.5) * 0.6, life: rain ? 1.2 : 9, maxLife: rain ? 1.2 : 9, size: rain ? 0.05 : 0.12, color: new Color(WEATHER_COLOR[this.weather]), gravity: 0, kind: 'weather' });
      }
    }
    // パーティクル更新
    this.batch.begin();
    for (let i = this.particles.length - 1; i >= 0; i--) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0 || (p.kind === 'weather' && p.y < -0.2)) {
        this.particles.splice(i, 1);
        continue;
      }
      p.vy -= p.gravity * dt;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      if (p.kind === 'coin' && p.y < 0.1) {
        p.y = 0.1;
        p.vy = Math.abs(p.vy) * 0.4;
      }
      const rot = p.kind === 'weather' ? now / 400 + i : p.kind === 'coin' ? now / 80 : 0;
      const h = p.kind === 'weather' && this.weather === 'rain' ? p.size * 8 : p.size;
      this.batch.add(p.x, p.y, p.z, p.size, h, p.size, p.color, rot);
    }
    this.batch.end();

    // トラック
    if (this.truckT >= 0) {
      this.truckT += dt / 2.5;
      const t = Math.min(1, this.truckT);
      const ease = 1 - Math.pow(1 - t, 3);
      this.truck.position.lerpVectors(this.truckFrom, this.truckTo, ease);
      if (this.truckT > 4.5) {
        // 荷降ろし後に去る
        const back = Math.min(1, (this.truckT - 4.5) / 1.2);
        this.truck.position.lerpVectors(this.truckTo, this.truckFrom, back);
        if (back >= 1) {
          this.truckT = -1;
          this.truck.visible = false;
        }
      }
    }
    // 回転灯
    if (this.beacon.visible) {
      this.beacon.rotation.y = now / 150;
      this.beaconLight.intensity = 6 + 4 * Math.sin(now / 150);
    }
    // 文字ポップ（DOM）
    const rect = this.host.getBoundingClientRect();
    for (let i = this.pops.length - 1; i >= 0; i--) {
      const p = this.pops[i];
      p.life -= dt;
      if (p.life <= 0) {
        p.el.remove();
        this.pops.splice(i, 1);
        continue;
      }
      p.y += dt * 0.8;
      this.tmp.set(p.x, p.y, p.z).project(camera);
      const sx = ((this.tmp.x + 1) / 2) * rect.width;
      const sy = ((1 - this.tmp.y) / 2) * rect.height;
      p.el.style.transform = `translate(${sx}px, ${sy}px) translate(-50%, -50%)`;
      p.el.style.opacity = String(Math.min(1, p.life));
    }
  }
}
