/**
 * エントリポイント。固定タイムステップのシミュレーションと描画ループを束ねる。
 */
import { SPEED_OPTIONS, TICKS_PER_SECOND } from './data/balance';
import { createWorld } from './sim/world';
import { stepWorld } from './sim/step';
import type { WorldState } from './sim/types';
import { WarehouseRenderer } from './render/scene';
import { detectQuality } from './render/quality';
import { Hud } from './ui/hud';
import { BottomBar } from './ui/bottomBar';
import { OrderSheet } from './ui/orderSheet';
import { itemDef } from './data/items';
import { $, showToast } from './ui/layout';

const TICK_MS = 1000 / TICKS_PER_SECOND;

class Game {
  world: WorldState;
  renderer: WarehouseRenderer;
  hud: Hud;
  bar: BottomBar;
  orders: OrderSheet;
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  /** 描画用: 現在 tick 内の補間係数 */
  private alpha = 0;

  constructor() {
    this.world = createWorld({ seed: Date.now() >>> 0 });
    const canvas = $<HTMLCanvasElement>('game-canvas');
    this.renderer = new WarehouseRenderer(canvas, detectQuality());
    this.hud = new Hud((s) => this.setSpeed(s));
    this.bar = new BottomBar();
    this.orders = new OrderSheet();
    this.orders.onItemTap = (itemId) => this.highlightItem(itemId);

    $('btn-camera-reset').addEventListener('click', () => this.renderer.controls.reset());
    $('btn-calm').addEventListener('click', () => showToast('眺めモードは M10 で実装予定'));
    this.renderer.controls.onTap = (x, y) => this.onTap(x, y);

    window.addEventListener('resize', () => this.onResize());
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.last = performance.now();
    });
    this.onResize();
  }

  setSpeed(s: number): void {
    if (!(SPEED_OPTIONS as readonly number[]).includes(s)) return;
    this.world.speed = s;
  }

  private onResize(): void {
    this.renderer.resize();
  }

  /** オーダーの商品タップ → その商品のビンがあるスタックをハイライト（§2.4） */
  private highlightItem(itemId: string): void {
    const w = this.world;
    const cells: { x: number; z: number; color: string }[] = [];
    for (const s of w.stacks) {
      if (s.bins.some((id) => w.bins[id]?.item === itemId && w.bins[id].qty > 0)) cells.push({ x: s.x, z: s.z, color: '#ffd400' });
    }
    this.renderer.highlightCells = cells;
    showToast(cells.length ? `${itemDef(itemId).name} の棚をハイライト` : `${itemDef(itemId).name} は欠品中`);
    clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => (this.renderer.highlightCells = []), 4000);
  }
  private highlightTimer = 0;

  private onTap(x: number, y: number): void {
    const hit = this.renderer.pick(this.world, x, y, this.alpha);
    if (!hit) return;
    if (hit.kind === 'robot') {
      this.renderer.selectedRobotId = hit.id;
      const r = this.world.robots.find((r) => r.id === hit.id);
      if (r) this.bar.setSelectedInfo(`${r.kind === 'shelf' ? '🟥' : '🟦'} ${r.name}（${r.pose.x}, ${r.pose.z}）`);
    } else {
      this.renderer.selectedRobotId = null;
      this.bar.setSelectedInfo(`${hit.kind}（${hit.x}, ${hit.z}）`);
    }
  }

  start(): void {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      if (!document.hidden) {
        this.acc += dt * this.world.speed;
        let guard = 0;
        while (this.acc >= TICK_MS && guard++ < 40) {
          stepWorld(this.world);
          this.acc -= TICK_MS;
        }
        this.alpha = this.world.speed > 0 ? this.acc / TICK_MS : 0;
        this.hud.update(this.world);
        this.orders.update(this.world);
        this.renderer.render(this.world, this.alpha);
      }
    };
    this.raf = requestAnimationFrame(frame);
  }

  stop(): void {
    cancelAnimationFrame(this.raf);
  }
}

const game = new Game();
game.start();
// デバッグ用にグローバルへ（本番でも無害）
(window as unknown as { game: Game }).game = game;
