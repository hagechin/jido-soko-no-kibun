/**
 * フォトモード（★）: 倉庫の好きな場所にカメラを置き、焦点距離・絞り・シャッター・エフェクトを決めて撮る。
 * 撮った写真は保存／共有でき、「起動画面にする」でアプリの起動画面（スプラッシュ）に使われる。
 * カメラは眺めモード MANUAL と同じ操作（ドラッグ・ピンチ、WASD / Q E / R F / Z X）。画面をタップするとそこにピント
 */
import { icon, iconText } from './icon';
import { DEFAULT_PHOTO, PHOTO_CHOICES, PHOTO_SHARE_TEXT, type PhotoParams } from '../render/photo';
import { native, nativeTry } from '../platform/native';
import { $, el, showToast } from './layout';

const KEY = 'jido-soko-no-kibun:photo';
export const STARTUP_PHOTO_KEY = 'jido-soko-no-kibun:startup-photo';
/** 起動画面に使う画像の長辺（localStorage に入れるので抑えめ） */
const STARTUP_LONG_EDGE = 1600;
/** 保存／共有する写真の長辺 */
const PHOTO_LONG_EDGE = 2400;

export interface PhotoHost {
  /** 開始／終了（カメラ操作の切替、HUD の非表示、描画の後処理） */
  onEnter: () => void;
  onExit: () => void;
  apply: (p: PhotoParams) => void;
  /** 画面の点までの距離（ピント） */
  distanceAt: (clientX: number, clientY: number) => number | null;
  /** 開始時のピント: いま見ている場所（カメラの注視点）までの距離 */
  focusAtStart?: () => number | null;
  /** 撮影 → JPEG データ URL */
  capture: (longEdge: number) => string;
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

export class PhotoMode {
  active = false;
  params: PhotoParams = loadPhotoParams();
  private panel = $('photo-panel');
  private mask = $('photo-mask');
  private host: PhotoHost | null = null;
  private focusHint = el('span', { class: 'photo-focus muted small', text: '' });

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
      }
    });
    window.addEventListener('resize', () => this.active && this.updateMask());
  }

  enter(): void {
    if (this.active || !this.host) return;
    this.active = true;
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
    showToast('フォトモード: 画面をタップでピント、Enter で撮影、Esc で戻る', 3500, 'camera');
  }

  exit(): void {
    if (!this.active || !this.host) return;
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
    const shoot = el('button', { class: 'btn primary photo-shoot', type: 'button', title: '撮影（Enter）' }, iconText('camera', '撮影', 16));
    shoot.addEventListener('click', () => void this.shoot());
    const pause = el('button', { class: 'btn', type: 'button', title: 'Space' }, this.host?.isPaused() ? iconText('play', '再開', 14) : iconText('pause', '一時停止', 14));
    pause.addEventListener('click', () => {
      this.host?.togglePause();
      this.renderPanel();
    });
    const close = el('button', { class: 'btn', type: 'button', title: 'Esc' }, iconText('x', '終了', 14));
    close.addEventListener('click', () => this.exit());
    this.panel.replaceChildren(
      el('div', { class: 'photo-head' }, el('span', { class: 'photo-title' }, icon('camera', 16), el('span', { text: ' フォトモード' })), this.focusHint, el('span', { class: 'photo-actions' }, pause, shoot, close)),
      row(
        '焦点距離',
        PHOTO_CHOICES.focalMm.map((f) => ({ key: String(f), text: `${f}mm`, on: p.focalMm === f, pick: () => this.set({ focalMm: f }) })),
      ),
      row(
        '絞り',
        PHOTO_CHOICES.fNumber.map((f) => ({ key: String(f), text: `F${f}`, on: p.fNumber === f, pick: () => this.set({ fNumber: f }) })),
      ),
      row(
        'シャッター',
        PHOTO_CHOICES.shutter.map((s) => ({ key: s.label, text: s.label, on: p.shutterTicks === s.ticks, pick: () => this.set({ shutterTicks: s.ticks }) })),
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

  /** 撮影 → 確認モーダル（保存／共有、起動画面にする） */
  async shoot(): Promise<void> {
    if (!this.host) return;
    this.panel.classList.add('is-busy');
    await new Promise((r) => requestAnimationFrame(r));
    let url = '';
    try {
      url = this.host.capture(PHOTO_LONG_EDGE);
    } catch (e) {
      showToast(`撮影できませんでした: ${e instanceof Error ? e.message : String(e)}`);
      this.panel.classList.remove('is-busy');
      return;
    }
    this.panel.classList.remove('is-busy');
    const img = el('img', { class: 'photo-preview', alt: '撮った写真' }) as HTMLImageElement;
    img.src = url;
    const save = el('button', { class: 'btn primary', type: 'button' }, iconText(native.available ? 'upload' : 'download', native.available ? '保存／共有' : 'ダウンロード', 14));
    save.addEventListener('click', () => this.savePhoto(url));
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
    this.host.showModal('撮れました', img, el('div', { class: 'settings-row' }, save, startup, again));
  }

  private savePhoto(url: string): void {
    const stamp = new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14);
    if (native.available) {
      native.call('sharePhoto', { data: url, name: `hakoniwa-${stamp}.jpg`, text: PHOTO_SHARE_TEXT }, 120_000).catch(() => showToast('共有できませんでした'));
      return;
    }
    const a = document.createElement('a');
    a.href = url;
    a.download = `hakoniwa-${stamp}.jpg`;
    document.body.append(a);
    a.click();
    a.remove();
  }
}
