/**
 * フォトモード（★）: 倉庫の好きな場所にカメラを置き、焦点距離・絞り・シャッター・露出・エフェクトを決めて撮る。
 * 撮った写真は保存／共有でき、「起動画面にする」でアプリの起動画面（スプラッシュ）に使われる。
 * カメラは眺めモード MANUAL と同じ操作（ドラッグ・ピンチ、WASD / Q E / R F / Z X）。画面をタップするとそこにピント。
 * 第 24 回: 設定パネルを隠してシャッターだけの画面（画面中央下の ●）にでき、● を長押しすると最大 5 秒ぶん（0.25 秒ごと）の瞬間を記録して、あとから 1 枚選んで現像できる
 */
import { icon, iconText } from './icon';
import { DEFAULT_PHOTO, PHOTO_CHOICES, PHOTO_SHARE_TEXT, type PhotoParams } from '../render/photo';
import { native, nativeTry } from '../platform/native';
import { $, el, showToast } from './layout';

const KEY = 'jido-soko-no-kibun:photo';
const UI_KEY = 'jido-soko-no-kibun:photo-ui';
export const STARTUP_PHOTO_KEY = 'jido-soko-no-kibun:startup-photo';
/** 起動画面に使う画像の長辺（localStorage に入れるので抑えめ） */
const STARTUP_LONG_EDGE = 1600;
/** 保存／共有する写真の長辺 */
const PHOTO_LONG_EDGE = 2400;
/** 現像のサムネイルの長辺 */
const THUMB_LONG_EDGE = 480;
/** 長押し: この時間を超えたら連写（瞬間の記録）を始める */
const HOLD_MS = 350;
/** 連写の間隔と上限（0.25 秒 × 20 = 5 秒） */
const BURST_INTERVAL_MS = 250;
const BURST_MAX = 20;

export type PhotoCameraMode = 'orbit' | 'walk';

/** ある瞬間の記録（世界と予約表の写し、カメラの位置、補間位置）。中身は main が作る */
export interface PhotoSnapshot {
  at: number;
}

export interface PhotoHost {
  /** 開始／終了（カメラ操作の切替、HUD の非表示、描画の後処理） */
  onEnter: () => void;
  onExit: () => void;
  apply: (p: PhotoParams) => void;
  /** カメラ: オービット（回す）／ウォークスルー（歩く・飛ぶ） */
  setCameraMode: (mode: PhotoCameraMode) => void;
  /** 画面の点までの距離（ピント） */
  distanceAt: (clientX: number, clientY: number) => number | null;
  /** 開始時のピント: いま見ている場所（カメラの注視点）までの距離 */
  focusAtStart?: () => number | null;
  /** 撮影 → JPEG データ URL */
  capture: (longEdge: number) => string;
  /** いまの瞬間を記録する／記録した瞬間を撮影する（連写 → 現像） */
  snapshot: () => PhotoSnapshot;
  captureFrom: (snap: PhotoSnapshot, longEdge: number) => string;
  /** 一時停止／再開（撮影中に止めたいとき） */
  isPaused: () => boolean;
  togglePause: () => void;
  /** モーダル */
  showModal: (title: string, ...content: Node[]) => void;
  hideModal: () => void;
}

export function loadPhotoParams(): PhotoParams {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...DEFAULT_PHOTO, ...(JSON.parse(raw) as Partial<PhotoParams>) };
  } catch {
    /* ignore */
  }
  return { ...DEFAULT_PHOTO };
}

/** 起動画面の写真（データ URL）。無ければ null */
export function loadStartupPhoto(): string | null {
  try {
    return localStorage.getItem(STARTUP_PHOTO_KEY);
  } catch {
    return null;
  }
}

export function setStartupPhoto(dataUrl: string | null): boolean {
  try {
    if (dataUrl) localStorage.setItem(STARTUP_PHOTO_KEY, dataUrl);
    else localStorage.removeItem(STARTUP_PHOTO_KEY);
  } catch {
    return false;
  }
  // iOS: ネイティブにも置く（起動直後、WebView が動く前の画面に使う）
  if (native.available) nativeTry(dataUrl ? 'save' : 'delete', dataUrl ? { key: STARTUP_PHOTO_KEY, data: dataUrl } : { key: STARTUP_PHOTO_KEY });
  return true;
}

/** データ URL の画像を長辺 max に縮めて JPEG に */
export async function downscaleDataUrl(dataUrl: string, max: number, quality = 0.85): Promise<string> {
  const img = new Image();
  await new Promise<void>((res, rej) => {
    img.onload = () => res();
    img.onerror = () => rej(new Error('image'));
    img.src = dataUrl;
  });
  const r = Math.min(1, max / Math.max(img.width, img.height));
  if (r >= 1) return dataUrl;
  const c = document.createElement('canvas');
  c.width = Math.round(img.width * r);
  c.height = Math.round(img.height * r);
  c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
  return c.toDataURL('image/jpeg', quality);
}

const nextFrame = () => new Promise<void>((r) => requestAnimationFrame(() => r()));

export class PhotoMode {
  active = false;
  params: PhotoParams = loadPhotoParams();
  /** 設定パネルを隠してシャッターだけにする */
  minimal = false;
  cameraMode: PhotoCameraMode = 'orbit';
  private panel = $('photo-panel');
  private mask = $('photo-mask');
  private host: PhotoHost | null = null;
  private focusHint = el('span', { class: 'photo-focus muted small', text: '' });
  private busy = false;
  /** 長押しの連写 */
  private holdTimer = 0;
  private burstTimer = 0;
  private burst: PhotoSnapshot[] | null = null;
  private shutterBtn: HTMLButtonElement | null = null;

  constructor() {
    try {
      this.minimal = localStorage.getItem(UI_KEY) === 'min';
    } catch {
      /* ignore */
    }
  }

  attach(host: PhotoHost): void {
    this.host = host;
    document.addEventListener('keydown', (e) => {
      if (!this.active) return;
      if (e.code === 'Escape') {
        this.exit();
        e.preventDefault();
      } else if (e.code === 'Space' && !e.ctrlKey && !e.metaKey && !e.altKey) {
        this.host?.togglePause();
        this.renderPanel();
        e.preventDefault();
      } else if (e.code === 'Enter') {
        void this.shoot();
        e.preventDefault();
      } else if (e.code === 'KeyH') {
        this.setMinimal(!this.minimal);
        e.preventDefault();
      } else if (e.code === 'KeyV') {
        this.setCameraMode(this.cameraMode === 'walk' ? 'orbit' : 'walk');
        e.preventDefault();
      }
    });
    window.addEventListener('resize', () => this.active && this.updateMask());
  }

  enter(): void {
    if (this.active || !this.host) return;
    this.active = true;
    this.cameraMode = 'orbit';
    document.body.classList.add('is-photo');
    this.host.onEnter();
    // ピントは「いま見ている場所」に合わせて始める（前回の距離のままだと全体がぼけて見える）
    const d = this.host.focusAtStart?.();
    if (d !== null && d !== undefined && Number.isFinite(d)) this.params = { ...this.params, focusDistance: Math.max(1, d) };
    this.host.apply(this.params);
    this.panel.hidden = false;
    this.mask.hidden = false;
    this.renderPanel();
    this.updateMask();
    showToast('フォトモード: 画面をタップでピント、● で撮影（長押しで連写して後から選ぶ）、Esc で眺めモードに戻る', 4000, 'camera', true);
  }

  exit(): void {
    if (!this.active || !this.host) return;
    this.cancelHold();
    this.active = false;
    document.body.classList.remove('is-photo');
    this.panel.hidden = true;
    this.mask.hidden = true;
    this.host.onExit();
  }

  /** 3D ビューのタップ: ピント合わせ */
  onTap(clientX: number, clientY: number): void {
    if (!this.host) return;
    const d = this.host.distanceAt(clientX, clientY);
    if (d === null) return;
    this.set({ focusDistance: Math.max(1, d) });
    this.focusHint.textContent = `ピント: ${d.toFixed(1)} m`;
  }

  setCameraMode(mode: PhotoCameraMode): void {
    if (!this.host || mode === this.cameraMode) return;
    this.cameraMode = mode;
    this.host.setCameraMode(mode);
    this.renderPanel();
    if (mode === 'walk') showToast('ウォークスルー: 左半分をドラッグで移動、右半分で見回す、2 本指の上下で上昇・下降（WASD・Q/E・Shift）', 4500, 'camera', true);
  }

  setMinimal(on: boolean): void {
    this.minimal = on;
    try {
      localStorage.setItem(UI_KEY, on ? 'min' : 'full');
    } catch {
      /* ignore */
    }
    this.renderPanel();
    this.updateMask();
  }

  private set(patch: Partial<PhotoParams>): void {
    this.params = { ...this.params, ...patch };
    try {
      localStorage.setItem(KEY, JSON.stringify(this.params));
    } catch {
      /* ignore */
    }
    this.host?.apply(this.params);
    this.renderPanel();
    this.updateMask();
  }

  /** 写真の比率の黒帯（プレビュー用） */
  private updateMask(): void {
    if (!this.active) return;
    const view = $('view').getBoundingClientRect();
    const a = this.params.aspect;
    if (a === 'screen') {
      this.mask.style.setProperty('--mask-x', '0px');
      this.mask.style.setProperty('--mask-y', '0px');
      return;
    }
    const ratio = a === '3:2' ? 1.5 : a === '16:9' ? 16 / 9 : a === '4:5' ? 0.8 : 1;
    const screen = view.width / Math.max(1, view.height);
    if (ratio > screen) {
      const h = view.width / ratio;
      this.mask.style.setProperty('--mask-x', '0px');
      this.mask.style.setProperty('--mask-y', `${Math.max(0, (view.height - h) / 2)}px`);
    } else {
      const w = view.height * ratio;
      this.mask.style.setProperty('--mask-x', `${Math.max(0, (view.width - w) / 2)}px`);
      this.mask.style.setProperty('--mask-y', '0px');
    }
  }

  /** シャッター ●: タップで 1 枚、長押しで連写（瞬間の記録） */
  private makeShutter(): HTMLButtonElement {
    const b = el('button', { class: 'photo-shutter', type: 'button', title: '撮影（Enter）。長押しで連写して後から 1 枚選ぶ', 'aria-label': '撮影' }) as HTMLButtonElement;
    b.append(el('span', { class: 'photo-shutter-count', text: '' }));
    b.addEventListener('pointerdown', (e) => {
      if (this.busy) return;
      e.preventDefault();
      b.setPointerCapture(e.pointerId);
      this.cancelHold();
      this.holdTimer = window.setTimeout(() => this.beginBurst(), HOLD_MS);
    });
    const release = () => {
      if (this.holdTimer) {
        // 長押しになる前に離した → 1 枚
        window.clearTimeout(this.holdTimer);
        this.holdTimer = 0;
        void this.shoot();
        return;
      }
      if (this.burst) void this.endBurst();
    };
    b.addEventListener('pointerup', release);
    b.addEventListener('pointercancel', () => {
      this.cancelHold();
      if (this.burst) void this.endBurst();
    });
    this.shutterBtn = b;
    return b;
  }

  private cancelHold(): void {
    if (this.holdTimer) window.clearTimeout(this.holdTimer);
    if (this.burstTimer) window.clearInterval(this.burstTimer);
    this.holdTimer = 0;
    this.burstTimer = 0;
  }

  private beginBurst(): void {
    if (!this.host) return;
    this.holdTimer = 0;
    this.burst = [this.host.snapshot()];
    this.shutterBtn?.classList.add('is-hold');
    this.updateBurstCount();
    this.burstTimer = window.setInterval(() => {
      if (!this.host || !this.burst) return;
      if (this.burst.length >= BURST_MAX) {
        window.clearInterval(this.burstTimer);
        this.burstTimer = 0;
        return;
      }
      this.burst.push(this.host.snapshot());
      this.updateBurstCount();
    }, BURST_INTERVAL_MS);
  }

  private updateBurstCount(): void {
    const c = this.shutterBtn?.querySelector('.photo-shutter-count');
    if (c) c.textContent = this.burst ? String(this.burst.length) : '';
  }

  /** 連写を終えて現像（1 枚選ぶ）へ */
  private async endBurst(): Promise<void> {
    this.cancelHold();
    const snaps = this.burst;
    this.burst = null;
    this.shutterBtn?.classList.remove('is-hold');
    this.updateBurstCount();
    if (!snaps || !this.host) return;
    if (snaps.length < 2) {
      await this.shoot(snaps[0]);
      return;
    }
    this.busy = true;
    this.panel.classList.add('is-busy');
    const host = this.host;
    const big = el('img', { class: 'photo-preview', alt: '選んでいる瞬間' }) as HTMLImageElement;
    const strip = el('div', { class: 'photo-strip' });
    const note = el('p', { class: 'muted small', text: `${snaps.length} 枚の瞬間（${((snaps.length - 1) * BURST_INTERVAL_MS) / 1000} 秒ぶん）。タップして選び、「この 1 枚を現像」` });
    let selected = 0;
    const thumbs: HTMLImageElement[] = [];
    const pick = (i: number) => {
      selected = i;
      thumbs.forEach((t, k) => t.classList.toggle('is-active', k === i));
      big.src = thumbs[i].src;
    };
    const develop = el('button', { class: 'btn primary', type: 'button' }, iconText('camera', 'この 1 枚を現像', 14));
    develop.addEventListener('click', () => {
      host.hideModal();
      void this.shoot(snaps[selected]);
    });
    const cancel = el('button', { class: 'btn', type: 'button', text: 'やめる' });
    cancel.addEventListener('click', () => host.hideModal());
    host.showModal('現像', big, strip, note, el('div', { class: 'settings-row' }, develop, cancel));
    // サムネイルは 1 枚ずつ描く（描画の合間に画面を返す）
    for (let i = 0; i < snaps.length; i++) {
      const t = el('img', { class: 'photo-thumb', alt: `${i + 1} 枚目` }) as HTMLImageElement;
      t.addEventListener('click', () => pick(i));
      thumbs.push(t);
      strip.append(t);
      await nextFrame();
      try {
        t.src = host.captureFrom(snaps[i], THUMB_LONG_EDGE);
      } catch {
        t.remove();
      }
      if (i === 0) pick(0);
    }
    this.busy = false;
    this.panel.classList.remove('is-busy');
  }

  private renderPanel(): void {
    const p = this.params;
    const row = (label: string, items: { key: string; text: string; on: boolean; pick: () => void }[]) => {
      const r = el('div', { class: 'photo-row' }, el('span', { class: 'photo-label', text: label }));
      for (const it of items) {
        const b = el('button', { class: `btn photo-opt${it.on ? ' is-active' : ''}`, type: 'button', text: it.text });
        b.addEventListener('click', it.pick);
        r.append(b);
      }
      return r;
    };
    const pause = el('button', { class: 'btn', type: 'button', title: 'Space' }, this.host?.isPaused() ? iconText('play', '再開', 14) : iconText('pause', '一時停止', 14));
    pause.addEventListener('click', () => {
      this.host?.togglePause();
      this.renderPanel();
    });
    const close = el('button', { class: 'btn', type: 'button', title: '眺めモードに戻る（Esc）' }, iconText('x', '終了', 14));
    close.addEventListener('click', () => this.exit());
    this.panel.classList.toggle('is-min', this.minimal);
    if (this.minimal) {
      // シャッターだけの画面: 左に設定、中央に ●、右に終了
      const settings = el('button', { class: 'btn photo-min-btn', type: 'button', title: '設定を出す（H）' }, iconText('settings', '設定', 14));
      settings.addEventListener('click', () => this.setMinimal(false));
      const cam = el('button', { class: 'btn photo-min-btn', type: 'button', title: 'カメラの切り替え（V）' }, iconText('move', this.cameraMode === 'walk' ? '回す' : '歩く', 14));
      cam.addEventListener('click', () => this.setCameraMode(this.cameraMode === 'walk' ? 'orbit' : 'walk'));
      this.panel.replaceChildren(el('div', { class: 'photo-min' }, el('span', { class: 'photo-min-group' }, settings, cam), this.makeShutter(), close), el('div', { class: 'photo-min-hint' }, this.focusHint));
      return;
    }
    const hide = el('button', { class: 'btn', type: 'button', title: '設定を隠してシャッターだけにする（H）' }, iconText('image', '設定を隠す', 14));
    hide.addEventListener('click', () => this.setMinimal(true));
    this.panel.replaceChildren(
      el('div', { class: 'photo-head' }, el('span', { class: 'photo-title' }, icon('camera', 16), el('span', { text: ' フォトモード' })), this.focusHint, el('span', { class: 'photo-actions' }, pause, hide, this.makeShutter(), close)),
      row('カメラ', [
        { key: 'orbit', text: 'オービット（回す）', on: this.cameraMode === 'orbit', pick: () => this.setCameraMode('orbit') },
        { key: 'walk', text: 'ウォークスルー（歩く・飛ぶ）', on: this.cameraMode === 'walk', pick: () => this.setCameraMode('walk') },
      ]),
      row(
        '焦点距離',
        PHOTO_CHOICES.focalMm.map((f) => ({ key: String(f), text: `${f}mm`, on: p.focalMm === f, pick: () => this.set({ focalMm: f }) })),
      ),
      row('ボケ', [
        { key: 'off', text: 'オフ（パンフォーカス）', on: !p.bokeh, pick: () => this.set({ bokeh: false }) },
        { key: 'on', text: 'オン', on: p.bokeh, pick: () => this.set({ bokeh: true }) },
      ]),
      // 絞りはボケがオンのときだけ
      ...(p.bokeh
        ? [
            row(
              '絞り',
              PHOTO_CHOICES.fNumber.map((f) => ({ key: String(f), text: `F${f}`, on: p.fNumber === f, pick: () => this.set({ fNumber: f }) })),
            ),
          ]
        : []),
      row(
        'シャッター',
        PHOTO_CHOICES.shutter.map((s) => ({ key: s.label, text: s.label, on: p.shutterTicks === s.ticks, pick: () => this.set({ shutterTicks: s.ticks }) })),
      ),
      row(
        '露出',
        PHOTO_CHOICES.exposure.map((e) => ({ key: String(e), text: e === 0 ? '±0' : `${e > 0 ? '+' : ''}${e}`, on: p.exposure === e, pick: () => this.set({ exposure: e }) })),
      ),
      row(
        'エフェクト',
        PHOTO_CHOICES.effect.map((e) => ({ key: e.id, text: e.name, on: p.effect === e.id, pick: () => this.set({ effect: e.id }) })),
      ),
      row(
        '比率',
        PHOTO_CHOICES.aspect.map((a) => ({ key: a.id, text: a.name, on: p.aspect === a.id, pick: () => this.set({ aspect: a.id }) })),
      ),
      row(
        'ロゴ',
        PHOTO_CHOICES.logo.map((l) => ({ key: l.id, text: l.name, on: p.logo === l.id, pick: () => this.set({ logo: l.id }) })),
      ),
    );
  }

  /** 撮影 → 確認モーダル（保存／共有、起動画面にする）。snap があればその瞬間を撮る */
  async shoot(snap?: PhotoSnapshot): Promise<void> {
    if (!this.host || this.busy) return;
    this.busy = true;
    this.panel.classList.add('is-busy');
    await nextFrame();
    let url = '';
    try {
      url = snap ? this.host.captureFrom(snap, PHOTO_LONG_EDGE) : this.host.capture(PHOTO_LONG_EDGE);
    } catch (e) {
      showToast(`撮影できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      this.busy = false;
      this.panel.classList.remove('is-busy');
      return;
    }
    this.busy = false;
    this.panel.classList.remove('is-busy');
    const img = el('img', { class: 'photo-preview', alt: '撮った写真' }) as HTMLImageElement;
    img.src = url;
    const save = el('button', { class: 'btn primary', type: 'button' }, iconText(native.available ? 'image' : 'download', native.available ? 'カメラロールに保存' : 'ダウンロード', 14));
    save.addEventListener('click', () => void this.savePhoto(url, save));
    const share = native.available ? el('button', { class: 'btn', type: 'button' }, iconText('upload', '共有', 14)) : null;
    share?.addEventListener('click', () => this.sharePhoto(url));
    const startup = el('button', { class: 'btn', type: 'button' }, iconText('image', '起動画面にする', 14));
    startup.addEventListener('click', async () => {
      startup.setAttribute('disabled', 'true');
      const small = await downscaleDataUrl(url, STARTUP_LONG_EDGE);
      const ok = setStartupPhoto(small);
      showToast(ok ? '次の起動からこの写真が起動画面になります' : '保存できませんでした（容量）');
      this.host?.hideModal();
    });
    const again = el('button', { class: 'btn', type: 'button', text: '撮り直す' });
    again.addEventListener('click', () => this.host?.hideModal());
    this.host.showModal('撮れました', img, el('div', { class: 'settings-row' }, save, share, startup, again));
  }

  private stamp(): string {
    return new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
  }

  /** iOS: 共有シート（写真 + ハッシュタグの文） */
  private sharePhoto(url: string): void {
    native.call('sharePhoto', { data: url, name: `hakoniwa-${this.stamp()}.jpg`, text: PHOTO_SHARE_TEXT }, 120_000).catch(() => showToast('共有できませんでした', 2200, undefined, true));
  }

  /** iOS: カメラロールへ保存（「追加のみ」の権限）。Web: ダウンロード */
  private async savePhoto(url: string, button?: HTMLButtonElement): Promise<void> {
    if (native.available) {
      button?.setAttribute('disabled', 'true');
      try {
        const r = (await native.call('savePhoto', { data: url, name: `hakoniwa-${this.stamp()}.jpg` }, 60_000)) as { saved?: boolean; denied?: boolean; error?: string } | null;
        if (r?.saved) {
          showToast('カメラロールに保存しました', 2200, 'check', true);
          button?.replaceChildren(iconText('check', '保存しました', 14));
          return;
        }
        button?.removeAttribute('disabled');
        if (r?.denied) {
          const open = el('button', { class: 'btn primary', type: 'button', text: '設定を開く' });
          open.addEventListener('click', () => nativeTry('openSettings'));
          const back = el('button', { class: 'btn', type: 'button', text: '閉じる' });
          back.addEventListener('click', () => this.host?.hideModal());
          this.host?.showModal('写真への保存が許可されていません', el('p', { text: '設定 → 箱庭！DS → 写真 で「追加のみ」を許可すると、カメラロールに保存できます。共有シートからの「画像を保存」も使えます。' }), el('div', { class: 'settings-row' }, open, back));
          return;
        }
        showToast(`保存できませんでした${r?.error ? `: ${r.error}` : ''}`, 3000, 'triangle-alert', true);
      } catch {
        button?.removeAttribute('disabled');
        showToast('保存できませんでした', 2200, 'triangle-alert', true);
      }
      return;
    }
    const stamp = this.stamp();
    const a = document.createElement('a');
    a.href = url;
    a.download = `hakoniwa-${stamp}.jpg`;
    document.body.append(a);
    a.click();
    a.remove();
  }
}
