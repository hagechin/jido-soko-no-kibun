import { icon, iconText } from './icon';
/** 眺めモード（暖炉モード）§10.1: UI を隠し、自動カメラ、タップで復帰、Wake Lock、fps 制限 */
import { RENDER, UI } from '../data/balance';
import { formatDate } from '../sim/calendar';
import type { WorldState } from '../sim/types';
import { $, el, showToast } from './layout';

export type CalmCamera = 'auto' | 'manual';

export interface CalmSettings {
  fps: number; // 30 | 15
  wakeLock: boolean;
  /** AUTO: 自動カメラ / MANUAL: キーボード（WASD・矢印）とドラッグで視点を動かす */
  camera: CalmCamera;
}

const KEY = 'jido-soko-no-kibun:calm';

export function loadCalmSettings(): CalmSettings {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) {
      const v = JSON.parse(raw) as Partial<CalmSettings>;
      return { fps: v.fps === RENDER.calmFpsLow ? RENDER.calmFpsLow : RENDER.calmFps, wakeLock: !!v.wakeLock, camera: v.camera === 'manual' ? 'manual' : 'auto' };
    }
  } catch {
    /* ignore */
  }
  return { fps: RENDER.calmFps, wakeLock: false, camera: 'auto' };
}

export function saveCalmSettings(s: CalmSettings): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore */
  }
}

export class CalmMode {
  active = false;
  settings = loadCalmSettings();
  private mini = $('mini-hud');
  private suggest = $('calm-suggest');
  private lastInteraction = performance.now();
  private suggested = false;
  private wakeLock: { release: () => Promise<void> } | null = null;
  private miniText = el('span', { class: 'mini-text' });
  private miniMode = el('button', { class: 'btn mini-btn', type: 'button', title: 'カメラ: AUTO（自動）／ MANUAL（WASD・矢印キー・ドラッグ）。M キーでも切替' });
  private miniExit = el('button', { class: 'btn mini-btn', type: 'button', title: '眺めモードを終了（Esc）' }, icon('x', 14));
  onEnter: (() => void) | null = null;
  onExit: (() => void) | null = null;
  /** カメラモードが変わったとき */
  onCameraChange: ((mode: CalmCamera) => void) | null = null;

  constructor() {
    this.suggest.addEventListener('click', () => this.enter());
    const touch = () => {
      this.lastInteraction = performance.now();
      this.suggested = false;
      this.suggest.hidden = true;
    };
    for (const t of ['pointerdown', 'keydown', 'wheel'] as const) document.addEventListener(t, touch, { passive: true });
    this.mini.replaceChildren(this.miniText, this.miniMode, this.miniExit);
    this.miniMode.addEventListener('click', (e) => {
      e.stopPropagation();
      this.setCamera(this.settings.camera === 'auto' ? 'manual' : 'auto');
    });
    this.miniExit.addEventListener('click', (e) => {
      e.stopPropagation();
      this.exit();
    });
    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape') this.exit();
      else if (e.code === 'KeyM' && !e.ctrlKey && !e.metaKey && !e.altKey) this.setCamera(this.settings.camera === 'auto' ? 'manual' : 'auto');
    });
    this.renderMiniMode();
  }

  /** カメラモードを切り替える（設定にも保存） */
  setCamera(mode: CalmCamera): void {
    if (this.settings.camera === mode) return;
    this.settings.camera = mode;
    saveCalmSettings(this.settings);
    this.renderMiniMode();
    this.onCameraChange?.(mode);
    if (this.active) showToast(mode === 'manual' ? 'カメラ MANUAL: WASD・矢印で移動、Q/E 回転、R/F 角度、Z/X ズーム。ドラッグも可' : 'カメラ AUTO: 自動で見て回ります', 3000);
  }

  private renderMiniMode(): void {
    this.miniMode.replaceChildren(icon(this.settings.camera === 'auto' ? 'refresh-cw' : 'move', 14), document.createTextNode(this.settings.camera === 'auto' ? ' AUTO' : ' MANUAL'));
  }

  enter(): void {
    if (this.active) return;
    this.active = true;
    document.body.classList.add('is-calm');
    this.suggest.hidden = true;
    this.requestWakeLock();
    this.onEnter?.();
    showToast(this.settings.camera === 'manual' ? '眺めモード（MANUAL）。WASD・矢印で視点移動、Esc か右下の × で戻ります' : '眺めモード。画面をタップで戻ります', 3000);
  }

  exit(): void {
    if (!this.active) return;
    this.active = false;
    document.body.classList.remove('is-calm');
    this.releaseWakeLock();
    this.onExit?.();
  }

  /** 毎フレーム: ミニ HUD と無操作の提案 */
  update(w: WorldState, now: number): void {
    if (this.active) {
      const txt = `${formatDate(w.calendar)}　${Math.floor(w.coins).toLocaleString('ja-JP')}`;
      if (this.mini.dataset.txt !== txt) {
        this.mini.dataset.txt = txt;
        this.miniText.replaceChildren(el('span', { text: formatDate(w.calendar) + '　' }), icon('coins', 14), el('span', { text: ' ' + Math.floor(w.coins).toLocaleString('ja-JP') + '　' }));
      }
      return;
    }
    if (!this.suggested && now - this.lastInteraction > UI.idleSuggestMs && !w.flags.buildMode) {
      this.suggested = true;
      this.suggest.hidden = false;
    }
  }

  private async requestWakeLock(): Promise<void> {
    if (!this.settings.wakeLock) return;
    const nav = navigator as Navigator & { wakeLock?: { request: (t: 'screen') => Promise<{ release: () => Promise<void> }> } };
    if (!nav.wakeLock) return;
    try {
      this.wakeLock = await nav.wakeLock.request('screen');
    } catch {
      this.wakeLock = null;
    }
  }

  private releaseWakeLock(): void {
    this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  /** 設定 UI */
  renderSettings(body: HTMLElement): void {
    body.append(el('h4', { text: '眺めモード' }));
    const row = el('div', { class: 'settings-row' });
    for (const fps of [RENDER.calmFps, RENDER.calmFpsLow]) {
      const b = el('button', { class: `btn${this.settings.fps === fps ? ' is-active' : ''}`, type: 'button', text: `${fps} fps` });
      b.addEventListener('click', () => {
        this.settings.fps = fps;
        saveCalmSettings(this.settings);
        this.renderSettingsInto(body);
      });
      row.append(b);
    }
    const supported = 'wakeLock' in navigator;
    const wl = el('button', { class: `btn${this.settings.wakeLock ? ' is-active' : ''}`, type: 'button' }, iconText('smartphone', supported ? '画面を点けっぱなし' : '画面点けっぱなし（非対応）'));
    if (!supported) wl.setAttribute('disabled', 'true');
    wl.addEventListener('click', () => {
      this.settings.wakeLock = !this.settings.wakeLock;
      saveCalmSettings(this.settings);
      this.renderSettingsInto(body);
    });
    row.append(wl);
    body.append(row);
    const cam = el('div', { class: 'settings-row' });
    for (const [mode, label] of [['auto', 'AUTO（自動カメラ）'], ['manual', 'MANUAL（キーボード）']] as [CalmCamera, string][]) {
      const b = el('button', { class: `btn${this.settings.camera === mode ? ' is-active' : ''}`, type: 'button', text: label });
      b.addEventListener('click', () => {
        this.setCamera(mode);
        this.renderSettingsInto(body);
      });
      cam.append(b);
    }
    body.append(cam);
    body.append(el('p', { class: 'muted small', text: 'MANUAL: W/A/S/D・矢印キーで移動、Q/E で回転、R/F で見下ろし角、Z/X でズーム。ドラッグ・ホイールも使えます。眺めモード中は M キーで AUTO/MANUAL 切替、Esc で終了' }));
    body.append(el('p', { class: 'muted small', text: '眺めモード中は描画を落として省電力にします。90 秒操作が無いと提案が出ます。' }));
  }

  private renderSettingsInto(body: HTMLElement): void {
    // 自分のセクションだけ描き直す（h4 以降を消して再描画）
    const h = Array.from(body.querySelectorAll('h4')).find((h) => h.textContent === '眺めモード');
    if (!h) return;
    let n = h.nextSibling;
    while (n && !(n instanceof HTMLHeadingElement)) {
      const next = n.nextSibling;
      n.remove();
      n = next;
    }
    h.remove();
    this.renderSettings(body);
  }
}
