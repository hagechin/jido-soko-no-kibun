/**
 * エントリポイント。固定タイムステップのシミュレーションと描画ループを束ねる。
 */
import { SPEED_OPTIONS, TICKS_PER_SECOND } from './data/balance';
import { itemDef } from './data/items';
import { createWorld } from './sim/world';
import { createRuntime, stepSim, type Runtime } from './sim/sim';
import type { Robot, SimEvent, WorldState } from './sim/types';
import { commandCancel, commandFetch, commandGoStation, commandRetrieve } from './sim/commands';
import { WarehouseRenderer, type PickResult } from './render/scene';
import { detectQuality, settingsFor } from './render/quality';
import { Hud } from './ui/hud';
import { BottomBar } from './ui/bottomBar';
import { OrderSheet } from './ui/orderSheet';
import { Popup } from './ui/popup';
import { binLabel, selectedInfoNode } from './ui/selection';
import { iconImg } from './ui/icons';
import { $, el, showToast } from './ui/layout';
import { renderUpgrades } from './ui/upgrades';
import { renderInventory } from './ui/inventory';
import { renderSettings } from './ui/settings';
import { renderBuild, type BuildUiState } from './ui/buildMode';
import { renderPortPanel, renderStationPanel } from './ui/stationPanel';
import { EventBanner, Modal, cyberReportNode } from './ui/eventBanner';
import { expand, move as moveObject, place, remove } from './sim/build';
import { buyAutomation, freeBinSlots, reservedSlots } from './sim/shop';
import { rankName, unlockSummary } from './sim/rank';
import { clearStorage, loadFromStorage, saveToStorage } from './ui/storage';
import { OFFLINE, SAVE } from './data/balance';
import { applyOffline } from './sim/offline';
import { offlineReportNode } from './ui/offlineReport';
import { CalmMode } from './ui/calmMode';
import { AutoCamera } from './render/autoCamera';
import { registerServiceWorker } from './ui/pwa';
import { Sound } from './audio/sound';
import { renderDebug } from './ui/debugPanel';
import { renderRobotList } from './ui/robotList';
import { isCyberWeek } from './sim/events';
import { visibleOrders } from './sim/orders';
import { exportSaveFile, importSaveFile } from './ui/storage';
import type { QualityLevel } from './render/quality';

const TICK_MS = 1000 / TICKS_PER_SECOND;

class Game {
  world: WorldState;
  rt: Runtime;
  renderer: WarehouseRenderer;
  hud: Hud;
  bar: BottomBar;
  orders: OrderSheet;
  popup: Popup;
  banner = new EventBanner();
  modal = new Modal();
  private acc = 0;
  private last = performance.now();
  private raf = 0;
  private alpha = 0;
  private selectedRobotId: number | null = null;
  /** オーダーの商品タップで選ばれた商品（スタックタップ時に直接そのビンを選ぶ） */
  private focusItem: string | null = null;
  private highlightTimer = 0;
  private infoSig = '';
  private lastStockoutHint = 0;
  /** デバッグ: 計測 */
  private debug = { enabled: false, showStats: false, simMs: 0, fps: 0, frames: 0, fpsAt: 0 };
  private statsEl: HTMLElement | null = null;
  private lastSavedAt: number | null = null;
  private quality: QualityLevel;
  private build: BuildUiState = { tool: 'stack', held: null };
  calm = new CalmMode();
  sound = new Sound();
  private autoCam: AutoCamera;
  private lastRender = 0;
  private hiddenAt: number | null = null;
  private catchUp = 0;
  private stationPanelId: number | null = null;
  private portPanelId: number | null = null;

  constructor() {
    const loaded = loadFromStorage();
    let offlineReport: ReturnType<typeof applyOffline> | null = null;
    if (loaded?.ok) {
      this.world = loaded.world;
      this.lastSavedAt = loaded.savedAt;
      const away = Date.now() - loaded.savedAt;
      if (away > OFFLINE.catchUpMaxMs) offlineReport = applyOffline(this.world, away);
      else this.catchUp = Math.min(OFFLINE.catchUpMaxMs, Math.max(0, away)) / TICK_MS;
      setTimeout(() => showToast(loaded.migrated ? 'セーブデータを新しい形式に移行しました' : '続きから再開しました'), 300);
    } else {
      if (loaded && !loaded.ok) setTimeout(() => showToast(`セーブデータを読めませんでした: ${loaded.reason}`), 300);
      this.world = createWorld({ seed: Date.now() >>> 0 });
    }
    this.rt = createRuntime();
    const canvas = $<HTMLCanvasElement>('game-canvas');
    const q = detectQuality();
    this.quality = q.level;
    this.renderer = new WarehouseRenderer(canvas, q, $('fx-overlay'));
    // 初回のタップで音声を有効化（スマホのブラウザ制限 §10）
    const unlock = () => {
      this.sound.unlock();
      document.removeEventListener('pointerdown', unlock);
      document.removeEventListener('keydown', unlock);
    };
    document.addEventListener('pointerdown', unlock);
    document.addEventListener('keydown', unlock);
    this.autoCam = new AutoCamera(this.renderer.controls);
    this.calm.onEnter = () => {
      this.bar.close();
      this.popup.hide();
      this.renderer.controls.enabled = false;
      this.autoCam.start(this.world);
    };
    this.calm.onExit = () => {
      this.renderer.controls.enabled = true;
    };
    this.renderer.controls.onInteract = () => {
      if (this.calm.active) this.calm.exit();
    };
    this.hud = new Hud((s) => this.setSpeed(s));
    this.bar = new BottomBar();
    this.orders = new OrderSheet();
    this.popup = new Popup();
    this.orders.onItemTap = (itemId) => this.onOrderItemTap(itemId);
    this.bar.registerPanel('robots', (body) =>
      renderRobotList(
        body,
        this.world,
        this.selectedRobotId,
        (id) => {
          this.select(id);
          this.bar.refresh();
        },
        (id) => {
          this.select(id);
          this.bar.show('upgrades');
        },
      ),
    );
    this.bar.registerPanel('inventory', (body) => renderInventory(body, this.world, (item) => this.onOrderItemTap(item)));
    this.bar.registerPanel('build', (body) =>
      renderBuild(body, {
        world: this.world,
        state: this.build,
        onToolChange: (tool) => {
          this.build.tool = tool;
          this.build.held = null;
          this.renderer.highlightCells = [];
          this.bar.refresh();
        },
        onExpand: (dir) => {
          const r = expand(this.world, dir);
          showToast(r.ok ? `倉庫を ${this.world.width}×${this.world.height} マスに広げました` : r.reason);
          this.bar.refresh();
        },
        refresh: () => this.bar.refresh(),
      }),
    );
    this.bar.registerPanel('port', (body) => {
      if (this.portPanelId !== null) renderPortPanel(body, this.world, this.portPanelId, () => this.bar.refresh());
    });
    this.bar.registerPanel('station', (body) => {
      if (this.stationPanelId !== null) renderStationPanel(body, this.world, this.stationPanelId, () => this.bar.refresh());
    });
    this.bar.onPanelChange = (panel) => {
      const building = panel === 'build';
      if (this.world.flags.buildMode !== building) {
        this.world.flags.buildMode = building;
        this.renderer.showGrid = building;
        this.build.held = null;
        this.renderer.highlightCells = [];
        if (building) this.select(null);
        else this.rt.dirty = true; // レイアウトが変わったかもしれないので再計画
      }
    };
    // デバッグ画面（?debug）
    this.debug.enabled = /[?&]debug/.test(location.search);
    if (this.debug.enabled) {
      this.bar.addButton('debug', '🐞', 'デバッグ');
      this.bar.registerPanel('debug', (body) =>
        renderDebug(body, {
          world: this.world,
          loadWorld: (w) => this.loadWorld(w),
          refresh: () => this.bar.refresh(),
          stats: { simMs: this.debug.simMs, fps: this.debug.fps, robots: this.world.robots.length },
          showStats: this.debug.showStats,
          setShowStats: (on) => {
            this.debug.showStats = on;
            if (this.statsEl) this.statsEl.hidden = !on;
          },
        }),
      );
      this.statsEl = el('div', { class: 'debug-stats', hidden: true });
      $('view').append(this.statsEl);
    }
    this.bar.registerPanel('settings', (body) =>
      renderSettings(body, {
        quality: this.quality,
        lastSavedAt: this.lastSavedAt,
        exportSave: () => exportSaveFile(this.world),
        importSave: (file) => this.importSave(file),
        extra: (body) => {
          body.append(el('h4', { text: 'サウンド' }));
          const b = el('button', { class: `btn${this.sound.enabled ? ' is-active' : ''}`, type: 'button', text: this.sound.enabled ? '🔊 オン' : '🔇 オフ' });
          b.addEventListener('click', () => {
            this.sound.setEnabled(!this.sound.enabled);
            this.bar.refresh();
          });
          body.append(el('div', { class: 'settings-row' }, b, el('span', { class: 'muted small', text: 'ロボの駆動音・ピック音・出荷音・BGM（すべて合成音）' })));
          this.calm.renderSettings(body);
        },
        saveNow: () => this.save(),
        newGame: () => this.newGame(),
        setQuality: (lv) => {
          this.quality = lv;
          this.renderer.setQuality(settingsFor(lv));
          this.bar.refresh();
        },
      }),
    );
    this.bar.registerPanel('upgrades', (body) => renderUpgrades(body, { world: this.world, selectedRobotId: this.selectedRobotId, refresh: () => this.bar.refresh(), buyAutomation: (id) => buyAutomation(this.world, id) }));

    $('btn-camera-reset').addEventListener('click', () => this.renderer.controls.reset());
    $('btn-calm').addEventListener('click', () => this.calm.enter());
    $('mini-hud').addEventListener('click', () => this.calm.exit());
    this.renderer.controls.onTap = (x, y) => this.onTap(x, y);

    window.addEventListener('resize', () => this.renderer.resize());
    // オートセーブ: 30 秒ごと＋タブを閉じる／隠すとき（§11.2）
    setInterval(() => this.save(), SAVE.autosaveIntervalMs);
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        this.hiddenAt = Date.now();
      } else {
        this.last = performance.now();
        if (this.hiddenAt !== null) this.onResume(Date.now() - this.hiddenAt);
        this.hiddenAt = null;
      }
    });
    if (import.meta.env.PROD) registerServiceWorker();
    this.renderer.resize();
    this.refreshSelectedInfo(true);
    if (offlineReport && offlineReport.elapsedMs > 0) {
      this.modal.show('🏠 お留守番レポート', offlineReportNode(offlineReport));
      this.save();
    }
    if (this.world.season.pendingReport) {
      const rec = this.world.season.pendingReport;
      this.modal.show('サイバーウィーク成績表', cyberReportNode(rec, this.world.stats.cyberWeekRecords));
      this.world.season.pendingReport = null;
    }
  }

  /** 表示中のオーダーが全部欠品待ちで、誰も動いていないときに知らせる（60 秒に 1 回） */
  private checkStockoutHint(now: number): void {
    if (now - this.lastStockoutHint < 60_000 || this.world.speed === 0) return;
    const w = this.world;
    const visible = visibleOrders(w);
    if (!visible.length) return;
    const inStock = new Set<string>();
    for (const b of Object.values(w.bins)) if (b.item && b.qty > 0) inStock.add(b.item);
    const allBlocked = visible.every((o) => o.lines.some((l) => l.picked < l.qty && !inStock.has(l.item)));
    const anyBusy = w.robots.some((r) => r.job && r.job.type !== 'park');
    if (!allBlocked || anyBusy) return;
    this.lastStockoutHint = now;
    const dock = w.pallets.reduce((a, p) => a + p.qty, 0);
    if (dock <= 0) {
      showToast('⚠️ 表示中のオーダーは全部欠品待ち。次の入荷トラック（週 1 回）を待っています', 6000);
      return;
    }
    // 入荷口に山はあるのに詰められるビンが無い（空ビンも、同じ商品の空きのあるビンも無い）→ 補充AIも動けない
    const palletItems = new Set(w.pallets.map((p) => p.item));
    const canStuff = Object.values(w.bins).some((b) => b.item === null || (palletItems.has(b.item) && b.qty < w.binCapacity));
    if (!canStuff) {
      const slot = freeBinSlots(w) > reservedSlots(w);
      showToast(slot ? '⚠️ 欠品の商品は入荷口にありますが、詰められる空きビンがありません。ショップで空ビンを買うと補充が動きます（ビン容量アップも有効）' : '⚠️ 欠品の商品は入荷口にありますが、空きビンも棚の空きもありません。スタックを増やすか段数を上げてから空ビンを買ってください', 8000);
      return;
    }
    showToast('⚠️ 表示中のオーダーは全部欠品待ち。入荷口の山をビンに詰めましょう（棚ロボで空ビンを取り出し → 搬送ロボを入荷ステーションへ。自動補充AIなら自動）', 6000);
  }

  /** タブが戻ったとき: 5 分以内なら追いつき計算、それ以上はまとめて計算（§10.3） */
  private onResume(hiddenMs: number): void {
    if (this.world.flags.buildMode) return;
    if (hiddenMs <= OFFLINE.catchUpMaxMs) {
      this.catchUp += (hiddenMs / TICK_MS) * this.world.speed;
    } else {
      const r = applyOffline(this.world, hiddenMs);
      if (r.elapsedMs > 0) this.modal.show('🏠 お留守番レポート', offlineReportNode(r));
      this.rt.dirty = true;
      this.save();
    }
  }

  private async importSave(file: File): Promise<void> {
    const res = await importSaveFile(file);
    if (!res.ok) {
      showToast(`読み込めませんでした: ${res.reason}`);
      return;
    }
    this.loadWorld(res.world);
    showToast('セーブデータを読み込みました');
  }

  /** 別の倉庫（プリセット・読み込んだセーブ）に差し替える */
  loadWorld(w: WorldState): void {
    this.world = w;
    this.rt = createRuntime();
    this.focusItem = null;
    this.renderer.highlightCells = [];
    this.select(null);
    this.bar.close();
    this.catchUp = 0;
    this.save();
  }

  save(): boolean {
    const ok = saveToStorage(this.world);
    if (ok) this.lastSavedAt = Date.now();
    return ok;
  }

  newGame(): void {
    clearStorage();
    this.world = createWorld({ seed: Date.now() >>> 0 });
    this.rt = createRuntime();
    this.select(null);
    this.bar.close();
    this.save();
    showToast('新しい倉庫を始めました');
  }

  setSpeed(s: number): void {
    if (!(SPEED_OPTIONS as readonly number[]).includes(s)) return;
    this.world.speed = s;
  }

  get selectedRobot(): Robot | null {
    return this.world.robots.find((r) => r.id === this.selectedRobotId) ?? null;
  }

  // ------------------------------------------------------------ 選択と指示
  private select(robotId: number | null): void {
    this.selectedRobotId = robotId;
    this.renderer.selectedRobotId = robotId;
    this.refreshSelectedInfo(true);
  }

  private refreshSelectedInfo(force = false): void {
    const r = this.selectedRobot;
    const sig = r ? `${r.id}:${r.job?.type}:${r.step}:${r.phase}:${r.carrying.join(',')}:${r.queue.length}:${this.focusItem}` : `none:${this.focusItem}`;
    if (!force && sig === this.infoSig) return;
    this.infoSig = sig;
    const hint = this.focusItem && r?.kind === 'shelf' ? `${itemDef(this.focusItem).name} の棚（光っている）をタップ` : null;
    this.bar.setSelectedInfo(selectedInfoNode(this.world, r, hint, () => this.cancelSelected()));
  }

  private cancelSelected(): void {
    if (this.selectedRobotId === null) return;
    commandCancel(this.world, this.rt, this.selectedRobotId);
    showToast('指示を取り消しました');
    this.refreshSelectedInfo(true);
  }

  /** オーダーの商品タップ → 棚をハイライト＋空いている棚ロボを自動選択（§7.2） */
  private onOrderItemTap(itemId: string): void {
    const w = this.world;
    const cells: { x: number; z: number; color: string }[] = [];
    for (const s of w.stacks) {
      if (s.bins.some((id) => w.bins[id]?.item === itemId && w.bins[id].qty > 0)) cells.push({ x: s.x, z: s.z, color: '#ffd400' });
    }
    this.renderer.highlightCells = cells;
    clearTimeout(this.highlightTimer);
    this.highlightTimer = window.setTimeout(() => {
      this.renderer.highlightCells = [];
      if (this.focusItem === itemId) this.focusItem = null;
      this.refreshSelectedInfo(true);
    }, 8000);
    if (!cells.length) {
      showToast(`${itemDef(itemId).name} は欠品中`);
      return;
    }
    this.focusItem = itemId;
    const free = w.robots.find((r) => r.kind === 'shelf' && !r.job && !r.queue.length) ?? w.robots.find((r) => r.kind === 'shelf' && r.queue.length < 3);
    if (free) this.select(free.id);
    else this.refreshSelectedInfo(true);
  }

  private onTap(x: number, y: number): void {
    if (this.popup.visible) {
      this.popup.hide();
      return;
    }
    const hit = this.renderer.pick(this.world, x, y, this.alpha, this.selectedRobotId !== null || this.world.flags.buildMode);
    if (!hit) return;
    if (this.world.flags.buildMode) return this.onBuildTap(hit.x, hit.z);
    const r = this.selectedRobot;
    if (hit.kind === 'robot') {
      // 選択中の棚ロボ自身をタップ → その真下のスタックを指したとみなす
      if (r && hit.id === r.id && r.kind === 'shelf') {
        const under = this.world.stacks.find((s) => s.x === r.pose.x && s.z === r.pose.z);
        if (under && !r.moveTo) return this.onStackTap(r, { kind: 'stack', id: under.id, x: under.x, z: under.z }, x, y);
      }
      this.select(hit.id === this.selectedRobotId ? null : hit.id);
      return;
    }
    if (!r) {
      this.describeTarget(hit);
      return;
    }
    if (r.kind === 'shelf' && hit.kind === 'stack') return this.onStackTap(r, hit, x, y);
    if (r.kind === 'amr' && hit.kind === 'port') {
      const res = commandFetch(this.world, this.rt, r.id, hit.id);
      showToast(res.ok ? `${r.name}: ポートのビンを取りに行きます` : res.reason);
      this.refreshSelectedInfo(true);
      return;
    }
    if (r.kind === 'amr' && hit.kind === 'station') {
      const res = commandGoStation(this.world, this.rt, r.id, hit.id);
      const st = this.world.stations.find((s) => s.id === hit.id);
      showToast(res.ok ? `${r.name}: ${st?.kind === 'pick' ? 'ピッキング' : '入荷'}ステーションへ` : res.reason);
      this.refreshSelectedInfo(true);
      return;
    }
    if (hit.kind === 'cell') {
      this.select(null);
      return;
    }
    this.describeTarget(hit);
  }

  private onBuildTap(x: number, z: number): void {
    const w = this.world;
    const tool = this.build.tool;
    let res: { ok: true } | { ok: false; reason: string };
    if (tool === 'erase') {
      res = remove(w, x, z);
      if (res.ok) showToast('撤去しました');
    } else if (tool === 'move') {
      if (!this.build.held) {
        const kind = w.cells[z * w.width + x];
        if (kind === 'floor' || kind === 'inboundDock' || kind === 'outboundDock') {
          showToast('動かせる設備をタップしてください');
          return;
        }
        this.build.held = { x, z };
        this.renderer.highlightCells = [{ x, z, color: '#4fc3f7' }];
        this.bar.refresh();
        return;
      }
      res = moveObject(w, this.build.held.x, this.build.held.z, x, z);
      if (res.ok) {
        this.build.held = null;
        this.renderer.highlightCells = [];
        showToast('移動しました');
      }
    } else {
      res = place(w, tool, x, z);
      if (res.ok) showToast(`${tool === 'stack' ? 'スタック' : tool === 'port' ? 'ポート' : tool === 'waitSpot' ? '待機スポット' : 'ステーション'} を置きました`);
    }
    if (!res.ok) showToast(res.reason);
    this.bar.refresh();
  }

  private describeTarget(hit: PickResult): void {
    const w = this.world;
    if (hit.kind === 'stack') {
      const s = w.stacks.find((s) => s.id === hit.id)!;
      const names = s.bins.map((id) => binLabel(w, id));
      showToast(names.length ? `スタック: ${names.join(' / ')}` : '空のスタック');
    } else if (hit.kind === 'port') {
      this.portPanelId = hit.id;
      this.bar.show('port');
    } else if (hit.kind === 'station') {
      this.stationPanelId = hit.id;
      this.bar.show('station');
    }
  }

  private onStackTap(r: Robot, hit: PickResult, x: number, y: number): void {
    const w = this.world;
    const stack = w.stacks.find((s) => s.id === hit.id);
    if (!stack) return;
    if (!stack.bins.length) {
      showToast('空のスタックです');
      return;
    }
    const issue = (binId: number) => {
      const res = commandRetrieve(w, this.rt, r.id, stack.id, binId);
      showToast(res.ok ? `${r.name}: ${binLabel(w, binId)} を取り出します` : res.reason);
      if (res.ok && this.focusItem && w.bins[binId]?.item === this.focusItem) {
        this.focusItem = null;
        this.renderer.highlightCells = [];
      }
      this.refreshSelectedInfo(true);
    };
    // ショートカット: 注目中の商品がそのスタックにあれば即指示
    if (this.focusItem) {
      const b = [...stack.bins].reverse().find((id) => w.bins[id]?.item === this.focusItem && w.bins[id].qty > 0);
      if (b !== undefined) return issue(b);
    }
    if (stack.bins.length === 1) return issue(stack.bins[0]);
    // 複数ビン: 上から順に並べて選ばせる
    const items = [...stack.bins].reverse().map((id, i) => {
      const b = w.bins[id];
      const node = el('span', {}, b.item ? iconImg(b.item, 28) : el('span', { text: '▫️' }), el('span', { text: `${i === 0 ? '上 ' : ''}${binLabel(w, id)}` }));
      return { node, onPick: () => issue(id) };
    });
    this.popup.show(x, y, items, 'どのビンを取り出す？');
  }

  // ------------------------------------------------------------ イベント
  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shipped':
          this.renderer.effects.ship(this.world, e.stationId, e.coins, e.bonus);
          this.sound.ship(e.bonus);
          if (!this.calm.active) showToast(`📦 出荷！ +${e.coins} コイン${e.bonus > 1 ? `（×${e.bonus} ボーナス）` : ''}`);
          break;
        case 'pick':
          this.renderer.effects.pickFlash(this.world, e.stationId);
          this.sound.pick();
          break;
        case 'coinChange':
          this.sound.coin();
          break;
        case 'repChange':
          if (e.delta < 0) showToast(`評判が下がった（${e.reason}）`);
          break;
        case 'notice':
          showToast(e.text, 3500);
          break;
        case 'truckArrived':
          this.renderer.effects.truckArrive(this.world);
          this.sound.truck();
          if (this.bar.open === 'inventory') this.bar.refresh();
          break;
        case 'eventStart':
          showToast(e.banner, 4000);
          this.sound.notice();
          break;
        case 'rankUp': {
          const list = el('ul');
          for (const u of unlockSummary(this.world)) list.append(el('li', { text: u }));
          this.modal.show(`🎉 ランクアップ: ${rankName(this.world)}`, el('p', { text: '倉庫が昇格しました。アンロック:' }), list);
          if (this.bar.open) this.bar.refresh();
          break;
        }
        case 'cyberWeekReport':
          this.modal.show('サイバーウィーク成績表', cyberReportNode(e.record, this.world.stats.cyberWeekRecords));
          this.world.season.pendingReport = null;
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------ ループ
  start(): void {
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      if (document.hidden) return;
      this.acc += this.world.flags.buildMode ? 0 : dt * this.world.speed;
      let guard = 0;
      const simStart = performance.now();
      let ticks = 0;
      while (this.acc >= TICK_MS && guard++ < 40) {
        stepSim(this.world, this.rt);
        this.acc -= TICK_MS;
        ticks++;
      }
      if (this.debug.enabled) {
        if (ticks) this.debug.simMs = this.debug.simMs * 0.9 + ((performance.now() - simStart) / ticks) * 0.1;
        this.debug.frames++;
        if (now - this.debug.fpsAt >= 1000) {
          this.debug.fps = (this.debug.frames * 1000) / (now - this.debug.fpsAt);
          this.debug.frames = 0;
          this.debug.fpsAt = now;
          if (this.statsEl && this.debug.showStats) this.statsEl.textContent = `${this.debug.fps.toFixed(0)} fps / sim ${this.debug.simMs.toFixed(2)} ms/tick / ロボ ${this.world.robots.length} / ${this.world.width}×${this.world.height} / tick ${this.world.tick}`;
        }
      }
      // 離席からの追いつき計算（1 フレームに少しずつ）
      if (this.catchUp >= 1 && !this.world.flags.buildMode) {
        const n = Math.min(OFFLINE.catchUpTicksPerFrame, Math.floor(this.catchUp));
        for (let i = 0; i < n; i++) stepSim(this.world, this.rt);
        this.catchUp -= n;
      }
      if (this.world.events.length) {
        this.handleEvents(this.world.events);
        this.world.events = [];
      }
      this.alpha = this.world.speed > 0 ? this.acc / TICK_MS : 0;
      this.calm.update(this.world, now);
      // 演出・サウンドの毎フレーム更新
      const fx = this.renderer.effects;
      fx.setMonth(this.world.calendar.month);
      const cyber = isCyberWeek(this.world);
      fx.setCyber(cyber);
      fx.update(this.world, Math.min(0.1, dt / 1000) * (this.world.speed === 0 ? 0.0001 : 1), this.renderer.camera, now);
      this.sound.setTempo(this.calm.active ? 'calm' : cyber ? 'cyber' : 'normal');
      this.sound.setActivity(this.world.speed === 0 ? 0 : this.world.robots.filter((r) => r.phase === 'moving').length);
      if (this.calm.active) {
        // 眺めモード: 描画を 30/15fps に落とす（§10.1）
        const minInterval = 1000 / this.calm.settings.fps;
        if (now - this.lastRender < minInterval) return;
        this.autoCam.update(this.world, Math.min(0.25, (now - this.lastRender) / 1000));
        this.lastRender = now;
        this.renderer.render(this.world, this.alpha);
        return;
      }
      this.lastRender = now;
      this.checkStockoutHint(now);
      this.hud.update(this.world);
      this.banner.update(this.world);
      this.orders.update(this.world);
      this.refreshSelectedInfo();
      this.renderer.render(this.world, this.alpha);
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
