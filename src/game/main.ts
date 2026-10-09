/**
 * エントリポイント。固定タイムステップのシミュレーションと描画ループを束ねる。
 */
import { Vector3 } from 'three';
import { INBOUND_FREQ, SPEED_OPTIONS, TICKS_PER_SECOND } from './data/balance';
import { inboundSettings, restockStockCap, setInbound } from './sim/inbound';
import { itemDef } from './data/items';
import { createWorld } from './sim/world';
import { createRuntime, stepSim, type Runtime } from './sim/sim';
import { adviseNext, createAdvisorStats, sampleAdvisor, type AdvisorStats, type Hint } from './sim/advisor';
import { ADVISOR } from './data/balance';
import { iconText, type IconName } from './ui/icon';
import type { NoticeIcon } from './sim/types';

/** sim のお知らせ種別 → アイコン */
const NOTICE_ICON: Record<NoticeIcon, IconName> = { truck: 'truck', party: 'party-popper', alert: 'triangle-alert', megaphone: 'megaphone', bulb: 'lightbulb', package: 'package', info: 'info' };
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
import { renderAchievements } from './ui/achievements';
import { ACHIEVEMENT_BY_ID } from './sim/achievements';
import { MEDALS } from './data/balance';
import { renderInventory } from './ui/inventory';
import { lastSavedText, renderSettings } from './ui/settings';
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
import { KeyboardCamera } from './render/keyboardCamera';
import { LayoutEditor } from './ui/layoutEditor';
import { beginEdit, finishEdit } from './sim/layoutEditor';
import { helpNode } from './ui/help';
import { BackgroundTicker, loadBackgroundSetting, saveBackgroundSetting } from './ui/background';
import { native, nativeTry } from './platform/native';
import { hasFeature, initEntitlements, onEntitlementsChange } from './platform/entitlements';
import { featureStatusNode, renderStore } from './ui/store';
import { setLimitsExpanded } from './sim/limits';
import { applyTheme, effectiveCosmetics, loadCosmetics, saveCosmetics } from './ui/cosmetics';
import { cloudAvailable, cloudEnabled, cloudLoad, onCloudChanged, setCloudEnabled, shouldOfferCloud } from './platform/cloud';
import { deserialize, type LoadResult } from './sim/save';
import { formatDate } from './sim/calendar';
import { installDemoSave, isDemoRequested } from './ui/demo';
import { PhotoMode } from './ui/photoMode';
import { preloadNativeSave } from './ui/storage';
import { BUILD_TOOL_ORDER } from './ui/buildMode';
import { registerServiceWorker } from './ui/pwa';
import { Sound } from './audio/sound';
import { renderDebug } from './ui/debugPanel';
import { refreshRobotListStatus, renderRobotList } from './ui/robotList';
import { isCyberWeek } from './sim/events';
import { visibleOrders } from './sim/orders';
import { copySaveToClipboard, exportSaveFile, importSaveFile, importSaveFromClipboard } from './ui/storage';
import type { QualityLevel } from './render/quality';
import { localeSetting, saveLocaleSetting, tr } from './i18n';
import { translateStaticDom } from './i18n/dom';

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
  private advisor: AdvisorStats = createAdvisorStats();
  private lastHint: { id: string; at: number } | null = null;
  private lastHintCheck = 0;
  /** 直近の提案（アップグレード画面の見出しに出す） */
  currentHint: Hint | null = null;
  /** iOS アプリ: 「アプリ 1.0 (12)・同梱 Web commit=abc1234 date=…」（sync-web.sh が書く BUILD_INFO。同梱が古くないかの確認用） */
  buildInfo = '';
  /** デバッグ: 計測 */
  private debug = { enabled: false, showStats: false, simMs: 0, fps: 0, frames: 0, fpsAt: 0 };
  private statsEl: HTMLElement | null = null;
  private lastSavedAt: number | null = null;
  /** 起動後にユーザーが視点を動かしたか（動かす前は画面サイズの変化に合わせて初期構図を取り直す） */
  private cameraTouched = false;
  private quality: QualityLevel;
  private build: BuildUiState = { tool: 'stack', held: null };
  calm = new CalmMode();
  sound = new Sound();
  private autoCam: AutoCamera;
  private keyCam: KeyboardCamera;
  private editor = new LayoutEditor();
  /** 最後に選ばれていた 0 以外の速度（Space で再開するとき用） */
  private lastSpeed = 1;
  private lastRender = 0;
  private hiddenAt: number | null = null;
  private catchUp = 0;
  /** バックグラウンド動作（PC 既定オン）: 隠れている間も Worker のタイマーで進める */
  backgroundMode = native.available ? false : loadBackgroundSetting();
  private ticker = new BackgroundTicker();
  /** バックグラウンド動作の前回時刻（フレームループの this.last とは別。隠れていてもフレームが走る環境があるため） */
  private bgLast = 0;
  private catchupOverlay = $('catchup');
  /** フォトモード（★）: カメラを置いて撮る。撮った写真は起動画面に使える */
  photo = new PhotoMode();
  private cameraBeforePhoto: { target: Vector3; azimuth: number; polar: number; distance: number } | null = null;
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
      setTimeout(() => showToast(loaded.migrated ? tr('セーブデータを新しい形式に移行しました') : tr('続きから再開しました')), 300);
    } else {
      if (loaded && !loaded.ok) setTimeout(() => showToast(tr('セーブデータを読めませんでした: {0}', loaded.reason)), 300);
      this.world = createWorld({ seed: Date.now() >>> 0 });
    }
    this.rt = createRuntime();
    const canvas = $<HTMLCanvasElement>('game-canvas');
    const q = detectQuality();
    this.quality = q.level;
    this.renderer = new WarehouseRenderer(canvas, q, $('fx-overlay'));
    // 初回のタップで音声を有効化（スマホのブラウザ制限 §10）。以降のタップでも、止まっていれば立て直す（iOS の interrupted は操作からの resume が要る）
    const unlock = () => {
      this.sound.unlock();
      this.sound.check(performance.now(), true);
    };
    document.addEventListener('pointerdown', unlock, { passive: true });
    document.addEventListener('keydown', unlock);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) this.sound.check(performance.now(), true);
    });
    this.autoCam = new AutoCamera(this.renderer.controls);
    this.keyCam = new KeyboardCamera(this.renderer.controls);
    // 眺めモードのカメラ: AUTO は自動カメラ（タップで解除）、MANUAL はキーボードとドラッグ（Esc／× で解除）
    const applyCalmCamera = () => {
      const manual = this.calm.settings.camera === 'manual';
      this.renderer.controls.enabled = manual;
      this.keyCam.enabled = manual;
      if (!manual) this.autoCam.start(this.world);
    };
    // 眺めモードに入る前のカメラを覚えておき、AUTO で出たときは戻す（自動カメラの寄った位置のままにしない）
    let cameraBeforeCalm: { target: Vector3; azimuth: number; polar: number; distance: number } | null = null;
    if (native.available) {
      const info = native.info;
      this.buildInfo = tr('アプリ {0} ({1})・同梱 Web: 読み込み中', info?.version ?? '?', info?.build ?? '?');
      fetch('/BUILD_INFO')
        .then((r) => (r.ok ? r.text() : Promise.reject(new Error(String(r.status)))))
        .then((t) => {
          this.buildInfo = tr('アプリ {0} ({1})・同梱 Web {2}', info?.version ?? '?', info?.build ?? '?', t.trim().split('\n').join(' '));
        })
        .catch(() => {
          this.buildInfo = tr('アプリ {0} ({1})・同梱 Web: BUILD_INFO なし（sync-web.sh を通していない？）', info?.version ?? '?', info?.build ?? '?');
        });
    }
    this.calm.onEnter = () => {
      this.bar.close();
      this.popup.hide();
      const c = this.renderer.controls;
      cameraBeforeCalm = { target: c.target.clone(), azimuth: c.azimuth, polar: c.polar, distance: c.distance };
      applyCalmCamera();
    };
    this.calm.onExit = () => {
      const c = this.renderer.controls;
      c.enabled = true;
      this.keyCam.enabled = false;
      if (cameraBeforeCalm && this.calm.settings.camera === 'auto') {
        c.target.copy(cameraBeforeCalm.target);
        c.azimuth = cameraBeforeCalm.azimuth;
        c.polar = cameraBeforeCalm.polar;
        c.distance = cameraBeforeCalm.distance;
        c.update();
      }
      cameraBeforeCalm = null;
    };
    this.photo.attach({
      onEnter: () => {
        if (this.calm.active) this.calm.exit();
        this.bar.close();
        this.popup.hide();
        const c = this.renderer.controls;
        this.cameraBeforePhoto = { target: c.target.clone(), azimuth: c.azimuth, polar: c.polar, distance: c.distance };
        c.enabled = true;
        this.keyCam.enabled = true;
        this.cameraTouched = true;
        this.renderer.setPhotoMode(true);
        this.renderer.resize();
      },
      onExit: () => {
        this.keyCam.enabled = false;
        this.renderer.setPhotoMode(false);
        const c = this.renderer.controls;
        if (this.cameraBeforePhoto) {
          c.target.copy(this.cameraBeforePhoto.target);
          c.azimuth = this.cameraBeforePhoto.azimuth;
          c.polar = this.cameraBeforePhoto.polar;
          c.distance = this.cameraBeforePhoto.distance;
          c.update();
          this.cameraBeforePhoto = null;
        }
        this.renderer.resize();
      },
      apply: (p) => this.renderer.setPhotoParams(p),
      distanceAt: (x, y) => this.renderer.distanceAt(this.world, x, y, this.alpha),
      capture: (longEdge) => this.renderer.capturePhoto(this.world, this.alpha, longEdge),
      isPaused: () => this.world.speed === 0,
      togglePause: () => this.setSpeed(this.world.speed === 0 ? this.lastSpeed : 0),
      showModal: (title, ...content) => this.modal.show(title, ...content),
      hideModal: () => this.modal.hide(),
    });
    this.calm.onCameraChange = () => {
      if (this.calm.active) applyCalmCamera();
    };
    this.renderer.controls.onInteract = () => {
      this.cameraTouched = true;
      if (this.calm.active && this.calm.settings.camera === 'auto') this.calm.exit();
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
          showToast(r.ok ? tr('倉庫を {0}×{1} マスに広げました', this.world.width, this.world.height) : r.reason);
          this.bar.refresh();
        },
        refresh: () => this.bar.refresh(),
        onOpenEditor: () => this.openEditor(),
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
    // デバッグ画面（?debug）。同じ画面を iOS 版では「サンドボックス」（購入機能）として設定から開ける
    this.debug.enabled = /[?&]debug/.test(location.search);
    if (this.debug.enabled) (globalThis as unknown as { __game?: Game }).__game = this;
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
        // ?debug（開発）ではなくサンドボックスとして使ったら、セーブに印を付ける
        onAction: () => {
          if (!this.debug.enabled) this.world.flags.sandboxUsed = true;
          setTimeout(() => this.save(), 0); // ボタンの処理が終わってから保存
        },
      }),
    );
    this.statsEl = el('div', { class: 'debug-stats', hidden: true });
    $('view').append(this.statsEl);
    if (this.debug.enabled) this.bar.addButton('debug', 'bug', tr('デバッグ'));
    // ストア（iOS 版の買い切り）。購入状態が変わったら開いているパネルを描き直す
    this.bar.registerPanel('store', (body) => renderStore(body, { refresh: () => this.bar.refresh() }));
    onEntitlementsChange(() => {
      setLimitsExpanded(hasFeature('limits'));
      this.applyCosmetics();
      this.bar.refresh();
      // ストア画面での購入・復元は画面側が知らせる。ここで知らせるのは外から変わったとき（承認待ちの完了・返金など）
      if (this.bar.open !== 'store') showToast(tr('購入状態を反映しました（返金・承認など）'), 4000, 'check');
    });
    this.bar.registerPanel('settings', (body) =>
      renderSettings(body, {
        openHelp: () => this.openHelp(),
        background: this.backgroundMode,
        // iOS アプリでは OS に止められるので「バックグラウンド動作」は出さない（常にオフ: 戻ったときに追いつき／お留守番）
        setBackground: native.available
          ? undefined
          : (on) => {
              this.setBackgroundMode(on);
              this.bar.refresh();
            },
        difficulty: this.world.difficulty,
        setDifficulty: (d) => {
          this.world.difficulty = d;
          this.bar.refresh();
        },
        economy: this.world.economy ?? 'standard',
        setEconomy: (e) => {
          this.world.economy = e;
          this.save();
          this.bar.refresh();
        },
        inbound: { ...inboundSettings(this.world), stockBins: Math.round(restockStockCap(this.world) / this.world.binCapacity) },
        setInbound: (next) => {
          setInbound(this.world, next);
          this.save();
          this.bar.refresh();
        },
        quality: this.quality,
        lastSavedAt: this.lastSavedAt,
        buildInfo: this.buildInfo,
        achievements: (body) => renderAchievements(body, this.world),
        openStore: () => this.bar.show('store'),
        language: {
          setting: localeSetting(),
          set: (s) => {
            saveLocaleSetting(s);
            this.save();
            location.reload();
          },
        },
        cosmetics: {
          unlocked: hasFeature('cosmetics'),
          skin: loadCosmetics().skin,
          theme: loadCosmetics().theme,
          setSkin: (skin) => {
            saveCosmetics({ ...loadCosmetics(), skin });
            this.applyCosmetics();
            this.bar.refresh();
          },
          setTheme: (theme) => {
            saveCosmetics({ ...loadCosmetics(), theme });
            this.applyCosmetics();
            this.bar.refresh();
          },
          hint: native.available ? tr('はサポーターパック（設定 → 追加機能 → ストア）で解放') : tr('は iOS 版のサポーターパックで解放'),
        },
        cloud: native.available
          ? {
              enabled: cloudEnabled(),
              available: this.cloudAvailable,
              setEnabled: (on) => {
                setCloudEnabled(on);
                if (on) this.save(true);
                this.bar.refresh();
              },
              checkNow: () => void this.checkCloud(true),
            }
          : undefined,
        openSandbox: hasFeature('sandbox') ? () => this.bar.show('debug') : undefined,
        featureStatus: () => featureStatusNode(),
        exportSave: () => {
          void exportSaveFile(this.world).then((err) => {
            if (err) showToast(tr('書き出せませんでした: {0}', err), 5000, 'triangle-alert');
          });
        },
        importSave: (file) => this.importSave(file),
        // iOS アプリ: 共有シートが出ないときの逃げ道（クリップボード経由）
        copySave: native.available
          ? () => {
              void copySaveToClipboard(this.world).then((err) => showToast(err ? tr('コピーできませんでした: {0}', err) : tr('セーブデータをクリップボードにコピーしました（メモなどに貼り付けて保管できます）'), 5000));
            }
          : undefined,
        pasteSave: native.available
          ? () => {
              void importSaveFromClipboard().then((res) => this.applyImported(res));
            }
          : undefined,
        extra: (body) => {
          body.append(el('h4', { text: tr('サウンド') }));
          const b = el('button', { class: `btn${this.sound.enabled ? ' is-active' : ''}`, type: 'button' }, this.sound.enabled ? iconText('volume-2', tr('オン'), 14) : iconText('volume-x', tr('オフ'), 14));
          b.addEventListener('click', () => {
            this.sound.setEnabled(!this.sound.enabled);
            this.bar.refresh();
          });
          body.append(el('div', { class: 'settings-row' }, b, el('span', { class: 'muted small', text: tr('ロボの駆動音・ピック音・出荷音・BGM（すべて合成音）') })));
          const st = el('p', { class: 'muted small', text: tr('BGM の状態: {0}', this.sound.status()) });
          body.append(st);
          // 開いている間は 1 秒ごとに状態を追いかける
          const timer = window.setInterval(() => {
            if (!st.isConnected) return clearInterval(timer);
            st.textContent = tr('BGM の状態: {0}', this.sound.status());
          }, 1000);
          this.calm.renderSettings(body);
          body.append(el('h4', { text: tr('フォトモード') }));
          const ph = el('button', { class: 'btn', type: 'button', title: 'P' }, iconText('camera', tr('フォトモードを開く'), 14), el('kbd', { class: 'key', text: 'P' }));
          ph.addEventListener('click', () => this.photo.enter());
          body.append(el('div', { class: 'settings-row' }, ph, el('span', { class: 'muted small', text: tr('カメラを自由に置いて、焦点距離・絞り・シャッター・エフェクトを決めて撮る。撮った写真は起動画面にできる') })));
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
    this.bar.registerPanel('upgrades', (body) => renderUpgrades(body, { world: this.world, selectedRobotId: this.selectedRobotId, refresh: () => this.bar.refresh(), buyAutomation: (id) => {
          const r = buyAutomation(this.world, id);
          if (r.ok) this.save();
          return r;
        }, hint: this.currentHint?.text ?? null, amrStaged: this.advisor.amrStaged }));

    $('btn-camera-reset').addEventListener('click', () => {
      this.cameraTouched = true;
      this.renderer.controls.reset();
    });
    window.addEventListener('keydown', (e) => this.onShortcut(e));
    $('btn-calm').addEventListener('click', () => this.calm.enter());
    this.renderer.controls.onTap = (x, y) => {
      if (this.photo.active) return this.photo.onTap(x, y); // フォトモード: タップでピント
      if (this.calm.active || this.editor.open) return; // MANUAL 中・プレビュー中のタップは視点操作の一部。ロボは選ばない
      this.onTap(x, y);
    };

    // 画面サイズの変化（WebView は起動直後にレイアウトが確定する。回転も）: まだ視点を触っていなければ初期構図を合わせ直す
    const onResize = () => {
      this.renderer.resize();
      if (!this.cameraTouched && !this.calm.active && !this.editor.open) this.renderer.refit();
    };
    window.addEventListener('resize', onResize);
    if (typeof ResizeObserver !== 'undefined') new ResizeObserver(onResize).observe(canvas);
    // オートセーブ: 30 秒ごと＋タブを閉じる／隠すとき（§11.2）
    setInterval(() => this.save(), SAVE.autosaveIntervalMs);
    window.addEventListener('pagehide', () => this.save());
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) this.save();
    });
    document.addEventListener('visibilitychange', () => {
      if (document.hidden) {
        if (this.backgroundMode && !this.world.flags.buildMode && !this.editor.open) {
          // バックグラウンド動作: 戻ったときの追いつきは不要
          this.hiddenAt = null;
          this.bgLast = performance.now();
          this.ticker.start(() => this.backgroundTick());
        } else {
          this.hiddenAt = Date.now();
        }
      } else {
        const wasRunning = this.ticker.running;
        this.ticker.stop();
        this.last = performance.now();
        if (!wasRunning && this.hiddenAt !== null) this.onResume(Date.now() - this.hiddenAt);
        this.hiddenAt = null;
      }
    });
    if (import.meta.env.PROD) registerServiceWorker();
    this.renderer.resize();
    this.refreshSelectedInfo(true);
    if (offlineReport && offlineReport.elapsedMs > 0) {
      this.modal.show(tr('お留守番レポート'), offlineReportNode(offlineReport));
      this.save();
    }
    if (this.world.season.pendingReport) {
      const rec = this.world.season.pendingReport;
      this.modal.show(tr('サイバーウィーク成績表'), cyberReportNode(rec, this.world.stats.cyberWeekRecords));
      this.world.season.pendingReport = null;
    }
  }

  /** 操作方法のモーダル */
  openHelp(): void {
    this.modal.show(tr('操作方法'), helpNode());
  }

  /**
   * キーボードショートカット（文字入力中・修飾キー付き・エディタ中・眺めモード中は無効。眺めモードとエディタは自前のキー処理を持つ）。
   * Space 一時停止 / [ ] 速度 / O B U I S N パネル / F カメラ / H ? ヘルプ / Esc 閉じる / 建設中は 1〜7 でツール、L でレイアウトエディタ
   */
  private onShortcut(e: KeyboardEvent): void {
    if (this.photo.active) return; // フォトモードは自前のキー処理（Esc / Space / Enter / 視点）
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)) return;
    if (this.editor.open || this.calm.active) return;
    const code = e.code;
    const panel = (id: Parameters<BottomBar['toggle']>[0]) => {
      this.bar.toggle(id);
      e.preventDefault();
    };
    if (code === 'Space') {
      this.setSpeed(this.world.speed === 0 ? this.lastSpeed || 1 : 0);
      e.preventDefault();
    } else if (code === 'BracketLeft' || code === 'BracketRight') {
      const order = [1, 2, 4];
      const cur = Math.max(0, order.indexOf(this.world.speed === 0 ? this.lastSpeed || 1 : this.world.speed));
      this.setSpeed(order[Math.min(order.length - 1, Math.max(0, cur + (code === 'BracketRight' ? 1 : -1)))]);
      e.preventDefault();
    } else if (code === 'KeyO') panel('robots');
    else if (code === 'KeyB') panel('build');
    else if (code === 'KeyU') panel('upgrades');
    else if (code === 'KeyI') panel('inventory');
    else if (code === 'KeyS') panel('settings');
    else if (code === 'KeyN') {
      this.calm.enter();
      e.preventDefault();
    } else if (code === 'KeyP') {
      this.photo.enter();
      e.preventDefault();
    } else if (code === 'KeyF') {
      this.renderer.controls.reset();
      e.preventDefault();
    } else if (code === 'KeyH' || (code === 'Slash' && e.shiftKey)) {
      this.openHelp();
      e.preventDefault();
    } else if (code === 'Escape') {
      if (this.bar.open) this.bar.close();
      else this.select(null);
    } else if (this.bar.open === 'build') {
      const digit = /^Digit([1-7])$/.exec(code);
      if (digit) {
        const tool = BUILD_TOOL_ORDER[Number(digit[1]) - 1];
        if (tool) {
          this.build.tool = tool;
          this.build.held = null;
          this.renderer.highlightCells = [];
          this.bar.refresh();
          e.preventDefault();
        }
      } else if (code === 'KeyL') {
        this.openEditor();
        e.preventDefault();
      }
    }
  }

  /** レイアウトエディタ（★）: 倉庫を止めてロボを外へ出し、俯瞰の 2D で編集。保存で再開、キャンセルで元に戻す */
  openEditor(): void {
    if (this.editor.open) return;
    if (this.calm.active) this.calm.exit();
    this.bar.close();
    this.popup.hide();
    this.select(null);
    this.world.flags.buildMode = false;
    beginEdit(this.world);
    this.rt.dirty = true;
    this.editor.show(this.world, {
      onSave: () => {
        const r = finishEdit(this.world);
        if (!r.ok) {
          showToast(r.reason, 4000, 'triangle-alert');
          return;
        }
        this.closeEditor(tr('新しいレイアウトで出荷を再開しました'));
      },
      onCancel: () => {
        const r = finishEdit(this.world);
        if (!r.ok) showToast(r.reason, 4000, 'triangle-alert');
        this.closeEditor(tr('編集を取り消しました'));
      },
      onPreview: (on) => {
        this.renderer.controls.enabled = on;
        if (on) this.renderer.resize();
      },
    });
    this.renderer.controls.enabled = false;
    this.save();
  }

  private closeEditor(message: string): void {
    this.editor.hide();
    this.renderer.controls.enabled = true;
    this.rt.dirty = true;
    this.renderer.resize();
    this.save();
    showToast(message, 3000, 'check');
    this.bar.refresh();
  }

  /** アドバイザー（★）: 30 秒ごとに提案を確認し、新しい提案（または 3 分ぶり）ならトーストで知らせる */
  private checkAdvisor(now: number): void {
    if (now - this.lastHintCheck < ADVISOR.checkMs || this.world.speed === 0 || this.world.flags.buildMode) return;
    this.lastHintCheck = now;
    const hint = adviseNext(this.world, this.advisor, { drones: !native.available ? 'none' : hasFeature('specialRobots') ? 'available' : 'locked' });
    this.currentHint = hint;
    if (!hint) return;
    if (this.lastHint && this.lastHint.id === hint.id && now - this.lastHint.at < ADVISOR.repeatMs) return;
    this.lastHint = { id: hint.id, at: now };
    showToast(hint.text, 8000, 'lightbulb');
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
      showToast(tr('表示中のオーダーは全部欠品待ち。次の入荷トラック（{0}）を待っています', INBOUND_FREQ[inboundSettings(w).freq].name), 6000, 'triangle-alert');
      return;
    }
    // 入荷口に山はあるのに詰められるビンが無い（空ビンも、同じ商品の空きのあるビンも無い）→ 補充AIも動けない
    const palletItems = new Set(w.pallets.map((p) => p.item));
    const canStuff = Object.values(w.bins).some((b) => b.item === null || (palletItems.has(b.item) && b.qty < w.binCapacity));
    if (!canStuff) {
      const slot = freeBinSlots(w) > reservedSlots(w);
      showToast(slot ? tr('欠品の商品は入荷口にありますが、詰められる空きビンがありません。ショップで空ビンを買うと補充が動きます（ビン容量アップも有効）') : tr('欠品の商品は入荷口にありますが、空きビンも棚の空きもありません。スタックを増やすか段数を上げてから空ビンを買ってください'), 8000, 'triangle-alert');
      return;
    }
    showToast(tr('表示中のオーダーは全部欠品待ち。入荷口の山をビンに詰めましょう（棚ロボで空ビンを取り出し → 搬送ロボを入荷ステーションへ。自動補充AIなら自動）'), 6000, 'triangle-alert');
  }

  /** バックグラウンド動作の 1 回ぶん: 前回からの実時間 × 速度の tick を進める（1 回の上限を超えたぶんは追いつき計算へ） */
  private backgroundTick(): void {
    if (!document.hidden || this.world.flags.buildMode || this.editor.open) return;
    const now = performance.now();
    const dt = Math.max(0, now - this.bgLast);
    this.bgLast = now;
    this.last = now;
    this.acc += dt * this.world.speed;
    let n = 0;
    while (this.acc >= TICK_MS && n < OFFLINE.backgroundTicksPerMessage) {
      stepSim(this.world, this.rt);
      this.acc -= TICK_MS;
      n++;
    }
    if (this.acc >= TICK_MS) {
      this.catchUp += Math.floor(this.acc / TICK_MS);
      this.acc = 0;
    }
    if (this.world.events.length) {
      this.handleEvents(this.world.events);
      this.world.events = [];
    }
  }

  setBackgroundMode(on: boolean): void {
    this.backgroundMode = on;
    saveBackgroundSetting(on);
  }

  /** タブが戻ったとき: 5 分以内なら追いつき計算、それ以上はまとめて計算（§10.3） */
  private onResume(hiddenMs: number): void {
    if (this.world.flags.buildMode) return;
    if (hiddenMs <= OFFLINE.catchUpMaxMs) {
      this.catchUp += (hiddenMs / TICK_MS) * this.world.speed;
    } else {
      const r = applyOffline(this.world, hiddenMs);
      if (r.elapsedMs > 0) this.modal.show(tr('お留守番レポート'), offlineReportNode(r));
      this.rt.dirty = true;
      this.save();
    }
  }

  private async importSave(file: File): Promise<void> {
    this.applyImported(await importSaveFile(file));
  }

  private applyImported(res: LoadResult): void {
    if (!res.ok) {
      showToast(tr('読み込めませんでした: {0}', res.reason));
      return;
    }
    this.loadWorld(res.world);
    showToast(tr('セーブデータを読み込みました'));
  }

  /** 別の倉庫（プリセット・読み込んだセーブ）に差し替える */
  loadWorld(w: WorldState): void {
    if (this.editor.open) this.editor.hide();
    this.world = w;
    this.rt = createRuntime();
    this.focusItem = null;
    this.renderer.highlightCells = [];
    this.select(null);
    this.bar.close();
    this.catchUp = 0;
    this.resumeInterruptedEdit();
    this.save();
  }

  /** エディタで止めたままセーブされていた倉庫: そのまま再開できれば再開、できなければエディタを開いて直してもらう */
  private resumeInterruptedEdit(): void {
    if (!this.world.flags.layoutEditor) return;
    const r = finishEdit(this.world);
    if (r.ok) {
      this.rt.dirty = true;
      return;
    }
    showToast(tr('レイアウトの編集が途中でした: {0}', r.reason), 5000, 'triangle-alert');
    this.editor.show(this.world, {
      onSave: () => {
        const f = finishEdit(this.world);
        if (!f.ok) {
          showToast(f.reason, 4000, 'triangle-alert');
          return;
        }
        this.closeEditor(tr('新しいレイアウトで出荷を再開しました'));
      },
      onCancel: () => {
        const f = finishEdit(this.world);
        if (!f.ok) showToast(f.reason, 4000, 'triangle-alert');
        this.closeEditor(tr('編集を取り消しました'));
      },
      onPreview: (on) => {
        this.renderer.controls.enabled = on;
        if (on) this.renderer.resize();
      },
    });
    this.renderer.controls.enabled = false;
  }

  save(cloudNow = false): boolean {
    const ok = saveToStorage(this.world, cloudNow);
    if (ok) {
      this.lastSavedAt = Date.now();
      const label = document.getElementById('last-saved');
      if (label) label.textContent = lastSavedText(this.lastSavedAt);
    }
    return ok;
  }

  /** 見た目（サポーターパック）を反映。機能が無ければ標準 */
  applyCosmetics(): void {
    const c = effectiveCosmetics();
    this.renderer.setSkin(c.skin);
    applyTheme(c.theme);
    this.renderer.setBackdrop(c.theme === 'midnight' ? '#2a2638' : c.theme === 'sand' ? '#f3ead8' : '#dfe9f3');
  }

  /** iCloud にサインインしているか（起動後に調べる。null = 未確認） */
  cloudAvailable: boolean | null = null;

  /** iCloud のセーブを調べ、端末より新しければ「読み込みますか？」を出す。manual は設定のボタンから */
  async checkCloud(manual = false): Promise<void> {
    if (!native.available || !cloudEnabled()) return;
    this.cloudAvailable = await cloudAvailable();
    if (!this.cloudAvailable) {
      if (manual) showToast(tr('iCloud にサインインしていないので同期できません'));
      return;
    }
    const c = await cloudLoad();
    if (!c) {
      if (manual) showToast(tr('iCloud にセーブはまだありません。次のセーブで送られます'));
      return;
    }
    if (!shouldOfferCloud(this.lastSavedAt, c.savedAt)) {
      if (manual) showToast(tr('iCloud のセーブはこの端末より新しくありません'));
      return;
    }
    this.offerCloudSave(c.text, c.savedAt);
  }

  /** 「iCloud に新しいセーブがあります」のモーダル（読み込むか、この端末のまま続けるか） */
  private offerCloudSave(text: string, savedAt: number): void {
    const res = deserialize(text);
    if (!res.ok) return;
    const w = res.world;
    const when = new Date(savedAt).toLocaleString('ja-JP');
    const summary = tr('{0}・{1} コイン・ロボ {2} 台・出荷 {3} 件', formatDate(w.calendar), Math.floor(w.coins).toLocaleString('ja-JP'), w.robots.length, w.stats.totalShipped);
    const mine = tr('この端末: {0}・{1} コイン・ロボ {2} 台・出荷 {3} 件', formatDate(this.world.calendar), Math.floor(this.world.coins).toLocaleString('ja-JP'), this.world.robots.length, this.world.stats.totalShipped);
    const load = el('button', { class: 'btn primary', type: 'button', text: tr('iCloud のセーブを読み込む') });
    const keep = el('button', { class: 'btn', type: 'button', text: tr('この端末のまま続ける') });
    load.addEventListener('click', () => {
      this.modal.hide();
      this.loadWorld(w);
      this.lastSavedAt = Date.now();
      showToast(tr('iCloud のセーブを読み込みました'));
    });
    keep.addEventListener('click', () => this.modal.hide());
    this.modal.show(
      tr('iCloud に新しいセーブがあります'),
      el('p', { text: tr('別の端末で {0} に保存されたセーブがあります。', when) }),
      el('p', { class: 'small', text: `iCloud: ${summary}` }),
      el('p', { class: 'muted small', text: mine }),
      el('p', { class: 'muted small', text: tr('読み込むと、この端末の進行はそのセーブで置き換わります（次の保存で iCloud にも送られます）。') }),
      el('div', { class: 'settings-row' }, load, keep),
    );
  }

  newGame(): void {
    clearStorage();
    this.world = createWorld({ seed: Date.now() >>> 0 });
    this.rt = createRuntime();
    this.select(null);
    this.bar.close();
    this.save();
    showToast(tr('新しい倉庫を始めました'));
  }

  setSpeed(s: number): void {
    if (!(SPEED_OPTIONS as readonly number[]).includes(s)) return;
    if (s > 0) this.lastSpeed = s;
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
    const hint = this.focusItem && r?.kind === 'shelf' ? tr('{0} の棚（光っている）をタップ', itemDef(this.focusItem).name) : null;
    this.bar.setSelectedInfo(selectedInfoNode(this.world, r, hint, () => this.cancelSelected()));
  }

  private cancelSelected(): void {
    if (this.selectedRobotId === null) return;
    commandCancel(this.world, this.rt, this.selectedRobotId);
    showToast(tr('指示を取り消しました'));
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
      showToast(tr('{0} は欠品中', itemDef(itemId).name));
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
      showToast(res.ok ? tr('{0}: ポートのビンを取りに行きます', r.name) : res.reason);
      this.refreshSelectedInfo(true);
      return;
    }
    if (r.kind === 'amr' && hit.kind === 'station') {
      const res = commandGoStation(this.world, this.rt, r.id, hit.id);
      const st = this.world.stations.find((s) => s.id === hit.id);
      showToast(res.ok ? tr('{0}: {1}ステーションへ', r.name, st?.kind === 'pick' ? tr('ピッキング') : tr('入荷')) : res.reason);
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
      if (res.ok) showToast(tr('撤去しました'));
    } else if (tool === 'move') {
      if (!this.build.held) {
        const kind = w.cells[z * w.width + x];
        if (kind === 'floor' || kind === 'inboundDock' || kind === 'outboundDock') {
          showToast(tr('動かせる設備をタップしてください'));
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
        showToast(tr('移動しました'));
      }
    } else {
      res = place(w, tool, x, z);
      if (res.ok) showToast(tr('{0} を置きました', tool === 'stack' ? tr('スタック') : tool === 'port' ? tr('ポート') : tool === 'waitSpot' ? tr('待機スポット') : tr('ステーション')));
    }
    if (!res.ok) showToast(res.reason);
    this.bar.refresh();
  }

  private describeTarget(hit: PickResult): void {
    const w = this.world;
    if (hit.kind === 'stack') {
      const s = w.stacks.find((s) => s.id === hit.id)!;
      const names = s.bins.map((id) => binLabel(w, id));
      showToast(names.length ? tr('スタック: {0}', names.join(' / ')) : tr('空のスタック'));
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
      showToast(tr('空のスタックです'));
      return;
    }
    const issue = (binId: number) => {
      const res = commandRetrieve(w, this.rt, r.id, stack.id, binId);
      showToast(res.ok ? tr('{0}: {1} を取り出します', r.name, binLabel(w, binId)) : res.reason);
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
      const node = el('span', {}, b.item ? iconImg(b.item, 28) : el('span', { class: 'slot-empty', title: tr('空ビン') }), el('span', { text: `${i === 0 ? '上 ' : ''}${binLabel(w, id)}` }));
      return { node, onPick: () => issue(id) };
    });
    this.popup.show(x, y, items, tr('どのビンを取り出す？'));
  }

  // ------------------------------------------------------------ イベント
  private handleEvents(events: SimEvent[]): void {
    for (const e of events) {
      switch (e.type) {
        case 'shipped':
          this.renderer.effects.ship(this.world, e.stationId, e.coins, e.bonus);
          this.sound.ship(e.bonus);
          if (!this.calm.active) showToast(tr('出荷！ +{0} コイン{1}', e.coins, e.bonus > 1 ? tr('（×{0} ボーナス）', e.bonus) : ''), 2200, 'package-check');
          nativeTry('haptic', { kind: 'light' });
          break;
        case 'pick':
          this.renderer.effects.pickFlash(this.world, e.stationId);
          this.sound.pick();
          break;
        case 'coinChange':
          this.sound.coin();
          break;
        case 'repChange':
          if (e.delta < 0) showToast(tr('評判が下がった（{0}）', e.reason));
          break;
        case 'notice':
          showToast(e.text, 3500, NOTICE_ICON[e.icon ?? 'info']);
          break;
        case 'achievement': {
          const def = ACHIEVEMENT_BY_ID[e.id];
          if (def) {
            const medal = MEDALS[Math.min(e.tier, MEDALS.length) - 1];
            showToast(`${def.negative ? '称号' : '実績'}「${def.name}」${medal}: ${def.tiers[e.tier - 1]?.label ?? ''}`, 5000, e.tier >= 5 ? 'moon' : e.tier >= 4 ? 'gem' : 'medal');
            this.sound.notice();
            nativeTry('haptic', { kind: 'success' });
            if (this.bar.open === 'settings') this.bar.refresh();
          }
          break;
        }
        case 'truckArrived':
          this.renderer.effects.truckArrive(this.world);
          this.sound.truck();
          if (this.bar.open === 'inventory') this.bar.refresh();
          break;
        case 'eventStart':
          showToast(e.banner, 4000, 'megaphone');
          this.sound.notice();
          break;
        case 'rankUp': {
          const list = el('ul');
          for (const u of unlockSummary(this.world)) list.append(el('li', { text: u }));
          nativeTry('haptic', { kind: 'success' });
          this.modal.show(tr('ランクアップ: {0}', rankName(this.world)), el('p', { text: tr('倉庫が昇格しました。アンロック:') }), list);
          if (this.bar.open) this.bar.refresh();
          break;
        }
        case 'cyberWeekReport':
          this.modal.show(tr('サイバーウィーク成績表'), cyberReportNode(e.record, this.world.stats.cyberWeekRecords));
          this.world.season.pendingReport = null;
          break;
        default:
          break;
      }
    }
  }

  // ------------------------------------------------------------ ループ
  start(): void {
    this.resumeInterruptedEdit();
    const frame = (now: number) => {
      this.raf = requestAnimationFrame(frame);
      const dt = Math.min(250, now - this.last);
      this.last = now;
      if (document.hidden) return;
      this.acc += this.world.flags.buildMode || this.editor.open ? 0 : dt * this.world.speed;
      let guard = 0;
      const simStart = performance.now();
      let ticks = 0;
      while (this.acc >= TICK_MS && guard++ < 40) {
        stepSim(this.world, this.rt);
        if (this.world.tick % TICKS_PER_SECOND === 0) sampleAdvisor(this.world, this.advisor);
        this.acc -= TICK_MS;
        ticks++;
      }
      // ロボ一覧を開いたままでも状態が追いかける（1 秒ごと、文字だけ）
      if (ticks && this.bar.open === 'robots' && this.world.tick % TICKS_PER_SECOND === 0) refreshRobotListStatus($('sheet-body'), this.world);
      // 在庫パネルは開いたままでも 2 秒ごとに描き直す（スクロール位置は保つ）
      if (ticks && this.bar.open === 'inventory' && this.world.tick % (2 * TICKS_PER_SECOND) === 0) {
        const sb = $('sheet-body');
        const st = sb.scrollTop;
        this.bar.refresh();
        sb.scrollTop = st;
      }
      if (this.debug.enabled) {
        if (ticks) this.debug.simMs = this.debug.simMs * 0.9 + ((performance.now() - simStart) / ticks) * 0.1;
        this.debug.frames++;
        if (now - this.debug.fpsAt >= 1000) {
          this.debug.fps = (this.debug.frames * 1000) / (now - this.debug.fpsAt);
          this.debug.frames = 0;
          this.debug.fpsAt = now;
          if (this.statsEl && this.debug.showStats) this.statsEl.textContent = tr('{0} fps / sim {1} ms/tick / ロボ {2} / {3}×{4} / tick {5}', this.debug.fps.toFixed(0), this.debug.simMs.toFixed(2), this.world.robots.length, this.world.width, this.world.height, this.world.tick);
        }
      }
      // 離席からの追いつき計算（1 フレームに少しずつ。終わるまでは描画せず「反映中」の表示だけ）
      if (this.catchUp >= 1 && !this.world.flags.buildMode && !this.editor.open) {
        const n = Math.min(OFFLINE.catchUpTicksPerFrame, Math.floor(this.catchUp));
        for (let i = 0; i < n; i++) stepSim(this.world, this.rt);
        this.catchUp -= n;
        if (this.world.events.length) {
          this.handleEvents(this.world.events);
          this.world.events = [];
        }
        if (this.catchUp >= 1) {
          this.catchupOverlay.hidden = false;
          this.catchupOverlay.textContent = tr('離席中の進行を反映しています… 残り {0} 秒ぶん', Math.ceil(this.catchUp / TICKS_PER_SECOND));
          return;
        }
        this.catchupOverlay.hidden = true;
        this.rt.dirty = true;
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
      this.sound.check(now); // BGM の見張り（1 秒に 1 回。フォトモード中も）
      if (this.photo.active) {
        this.keyCam.update(Math.min(0.25, (now - this.lastRender) / 1000));
        this.lastRender = now;
        this.renderer.render(this.world, this.alpha);
        return;
      }
      if (this.calm.active) {
        // 眺めモード: 描画を 30/15fps に落とす（§10.1）
        const minInterval = 1000 / this.calm.settings.fps;
        if (now - this.lastRender < minInterval) return;
        const cdt = Math.min(0.25, (now - this.lastRender) / 1000);
        if (this.calm.settings.camera === 'manual') this.keyCam.update(cdt);
        else this.autoCam.update(this.world, cdt);
        this.lastRender = now;
        this.renderer.render(this.world, this.alpha);
        return;
      }
      this.lastRender = now;
      this.checkStockoutHint(now);
      this.checkAdvisor(now);
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

// iOS アプリではネイティブの保存と購入状態を先に取り込んでから始める（Web 版は即開始）
void (async () => {
  translateStaticDom(); // 静的な HTML の日本語を辞書で置き換える（英語のとき）
  await Promise.all([preloadNativeSave(), initEntitlements()]);
  if (isDemoRequested()) installDemoSave(); // スクリーンショット・審査デモ用
  setLimitsExpanded(hasFeature('limits'));
  const game = new Game();
  game.start();
  // 起動スプラッシュを消す（最初の描画が済んでから）
  const splash = document.getElementById('splash');
  if (splash) {
    requestAnimationFrame(() => {
      splash.classList.add('is-done');
      nativeTry('ready'); // iOS: 起動画像のオーバーレイを消してよい
      setTimeout(() => (splash.hidden = true), 400);
    });
  }
  // デバッグ用にグローバルへ（本番でも無害）
  (window as unknown as { game: Game }).game = game;
  game.applyCosmetics();
  if (native.available) {
    native.on('background', () => game.save(true)); // 背面に回るときは iCloud にも即送る
    // 前面に戻ったとき／電話などの割り込みが終わったときは BGM を立て直す
    // ★ 実機では戻ったあと AudioContext が running のまま無音になるので、前面復帰と割り込み終了では作り直す
    native.on('foreground', () => game.sound.onForeground());
    native.on('audioResume', () => game.sound.onForeground());
    // WKWebView は操作なしで音を出せる設定（mediaTypesRequiringUserActionForPlayback = []）なので、起動直後から BGM を始める
    game.sound.unlock();
    document.documentElement.classList.add('is-native');
    void game.checkCloud();
    onCloudChanged(() => void game.checkCloud());
  }
})();
