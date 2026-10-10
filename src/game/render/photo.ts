/**
 * フォトモード（撮影）の描画: 被写界深度（絞り）・色調・粒子・ビネットの後処理と、シャッター（モーションブラー）の合成。
 * three の examples/jsm（同梱。CDN なし）の EffectComposer / BokehPass / FilmPass / ShaderPass を使う。
 */
import { Camera, Scene, Vector2, WebGLRenderer } from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { BokehPass } from 'three/examples/jsm/postprocessing/BokehPass.js';
import { FilmPass } from 'three/examples/jsm/postprocessing/FilmPass.js';
import { ShaderPass } from 'three/examples/jsm/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';

export type PhotoEffect = 'none' | 'film' | 'mono' | 'sepia' | 'vivid' | 'dusk';
export type PhotoAspect = 'screen' | '3:2' | '16:9' | '4:5' | '1:1';
/** 写真に入れるロゴ: なし／ロゴ／ロゴ＋倉庫情報（ランク・暦・出荷数） */
export type PhotoLogo = 'none' | 'logo' | 'logoInfo';

export interface PhotoParams {
  /** 焦点距離（35mm 換算 mm） */
  focalMm: number;
  /** ボケ（被写界深度）を付ける。オフはパンフォーカス（絞りの設定も出さない） */
  bokeh: boolean;
  /** 絞り F 値（ボケがオンのとき） */
  fNumber: number;
  /** ピント位置（カメラからの距離、ワールド単位） */
  focusDistance: number;
  /** シャッター（ゲーム内 tick。0 = ブラーなし。10 tick = ゲーム内 1 秒。撮影中はシミュレーションの写しをこの分だけ進めてコマを重ねる） */
  shutterTicks: number;
  /** 露出補正（EV。+1 で 2 倍の明るさ） */
  exposure: number;
  effect: PhotoEffect;
  aspect: PhotoAspect;
  logo: PhotoLogo;
}

/** シャッター中にシミュレーションの写しを進める手段（main が用意する） */
export interface PhotoAdvance {
  world: import('../sim/types').WorldState;
  step: () => void;
}

export const PHOTO_CHOICES = {
  focalMm: [24, 35, 50, 85, 135] as const,
  fNumber: [1.4, 2.8, 5.6, 11, 16, 32, 64] as const,
  /** 表示名 → tick */
  shutter: [
    { label: '1/250', ticks: 0 },
    { label: '1/30', ticks: 0.33 },
    { label: '1/8', ticks: 1.25 },
    { label: '1/2', ticks: 5 },
    { label: '1 秒', ticks: 10 },
    { label: '2 秒', ticks: 20 },
  ] as const,
  exposure: [-1, -0.5, 0, 0.5, 1, 1.5, 2] as const,
  effect: [
    { id: 'none', name: 'なし' },
    { id: 'film', name: 'フィルム' },
    { id: 'mono', name: 'モノクロ' },
    { id: 'sepia', name: 'セピア' },
    { id: 'vivid', name: 'ビビッド' },
    { id: 'dusk', name: '夕暮れ' },
  ] as { id: PhotoEffect; name: string }[],
  aspect: [
    { id: 'screen', name: '画面' },
    { id: '3:2', name: '3:2' },
    { id: '16:9', name: '16:9' },
    { id: '4:5', name: '4:5' },
    { id: '1:1', name: '1:1' },
  ] as { id: PhotoAspect; name: string }[],
  logo: [
    { id: 'none', name: 'なし' },
    { id: 'logo', name: 'ロゴ' },
    { id: 'logoInfo', name: 'ロゴ＋倉庫情報' },
  ] as { id: PhotoLogo; name: string }[],
};

export const DEFAULT_PHOTO: PhotoParams = { focalMm: 50, bokeh: true, fNumber: 2.8, focusDistance: 12, shutterTicks: 0, exposure: 0, effect: 'film', aspect: 'screen', logo: 'logo' };

export const PHOTO_TITLE = '箱庭！ディストリビューション';
/** 共有シートに添える文（iOS） */
export const PHOTO_SHARE_TEXT = '#箱庭ディストリビューション で撮りました';

/** 写真の右下に入れる文字列（ロゴ行と、倉庫情報の行） */
export function captionLines(logo: PhotoLogo, info: { rank: string; year: number; month: number; shipped: number }): string[] {
  if (logo === 'none') return [];
  if (logo === 'logo') return [PHOTO_TITLE];
  return [PHOTO_TITLE, `${info.rank} ・ ${info.year} 年目 ${info.month} 月 ・ 出荷 ${info.shipped.toLocaleString('ja-JP')} 件`];
}

/** 2D canvas に右下のキャプションを描く（長辺に対する比率で大きさを決める） */
export function drawCaption(ctx: CanvasRenderingContext2D, width: number, height: number, lines: string[]): void {
  if (!lines.length) return;
  const long = Math.max(width, height);
  const size = Math.round(long * 0.016);
  const small = Math.round(size * 0.78);
  const pad = Math.round(size * 0.7);
  const gap = Math.round(size * 0.35);
  ctx.save();
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'right';
  const font = (px: number, bold: boolean) => `${bold ? '700' : '500'} ${px}px system-ui, -apple-system, "Hiragino Sans", "Noto Sans JP", sans-serif`;
  ctx.font = font(size, true);
  const w0 = ctx.measureText(lines[0]).width;
  ctx.font = font(small, false);
  const w1 = lines[1] ? ctx.measureText(lines[1]).width : 0;
  const boxW = Math.max(w0, w1) + pad * 2;
  const boxH = pad * 2 + size + (lines[1] ? gap + small : 0);
  const x = width - pad - boxW;
  const y = height - pad - boxH;
  ctx.fillStyle = 'rgba(29, 39, 51, 0.62)';
  ctx.beginPath();
  ctx.roundRect(x, y, boxW, boxH, Math.round(size * 0.5));
  ctx.fill();
  ctx.fillStyle = '#ffffff';
  ctx.font = font(size, true);
  ctx.fillText(lines[0], x + boxW - pad, y + pad + size * 0.86);
  if (lines[1]) {
    ctx.fillStyle = 'rgba(255, 255, 255, 0.85)';
    ctx.font = font(small, false);
    ctx.fillText(lines[1], x + boxW - pad, y + pad + size + gap + small * 0.86);
  }
  ctx.restore();
}

/** 35mm 換算の焦点距離 → 縦の画角（度）。センサー縦 24mm */
export function fovForFocal(focalMm: number): number {
  return (2 * Math.atan(12 / focalMm) * 180) / Math.PI;
}

/**
 * F 値 → BokehPass の aperture。F1.4 で強く、F16 で弱い。
 * 同梱の BokehShader は「ピントからの距離 × aperture」（上限 maxblur）のシンプルな式で、物理的な被写界深度ではないが
 * 情緒的なミニチュア風のボケになる（物理的な錯乱円の版も試したが、こちらの見た目のほうが好評。0c30350 参照）。
 * 遠景までくっきり撮りたいときは「ボケ」をオフ（パンフォーカス）
 */
export function apertureForF(fNumber: number): number {
  return 0.06 / fNumber;
}
export const BOKEH_MAX_BLUR = 0.012;

/** 写真の縦横比（幅/高さ）。screen は画面のまま */
export function aspectRatio(a: PhotoAspect, screenRatio: number): number {
  switch (a) {
    case '3:2':
      return 3 / 2;
    case '16:9':
      return 16 / 9;
    case '4:5':
      return 4 / 5;
    case '1:1':
      return 1;
    default:
      return screenRatio;
  }
}

/** 出力サイズ: 長辺を longEdge に（縦長なら高さが長辺） */
export function photoSize(a: PhotoAspect, screenRatio: number, longEdge: number): { width: number; height: number } {
  const r = aspectRatio(a, screenRatio);
  return r >= 1 ? { width: longEdge, height: Math.round(longEdge / r) } : { width: Math.round(longEdge * r), height: longEdge };
}

/** シャッターの合成コマ数（ブラーが長いほど多く。1 tick あたり 3 コマ、4〜24） */
export function shutterFrames(ticks: number): number {
  return ticks <= 0 ? 1 : Math.min(24, Math.max(4, Math.round(ticks * 3)));
}

/**
 * 撮影する写真の縦の画角（度）: プレビューの枠（黒帯の内側）と同じ範囲が写るようにする。
 * 出力が画面より横長なら横の画角を合わせ（縦は狭くなる）、縦長なら縦の画角をそのまま使う
 */
export function captureFov(previewFovDeg: number, previewRatio: number, outputRatio: number): number {
  if (outputRatio <= previewRatio) return previewFovDeg;
  const v = (previewFovDeg * Math.PI) / 180;
  const h = 2 * Math.atan(Math.tan(v / 2) * previewRatio);
  return (2 * Math.atan(Math.tan(h / 2) / outputRatio) * 180) / Math.PI;
}

interface Grade {
  saturation: number;
  contrast: number;
  brightness: number;
  sepia: number;
  vignette: number;
  warm: number;
  grain: number;
  grayscale: boolean;
}

const GRADES: Record<PhotoEffect, Grade> = {
  none: { saturation: 1, contrast: 1, brightness: 1, sepia: 0, vignette: 0, warm: 0, grain: 0, grayscale: false },
  film: { saturation: 0.9, contrast: 1.08, brightness: 1.0, sepia: 0.08, vignette: 0.45, warm: 0.05, grain: 0.25, grayscale: false },
  mono: { saturation: 0, contrast: 1.15, brightness: 1.02, sepia: 0, vignette: 0.55, warm: 0, grain: 0.35, grayscale: true },
  sepia: { saturation: 0.6, contrast: 1.05, brightness: 1.0, sepia: 0.75, vignette: 0.5, warm: 0.1, grain: 0.3, grayscale: false },
  vivid: { saturation: 1.35, contrast: 1.12, brightness: 1.03, sepia: 0, vignette: 0.2, warm: 0, grain: 0, grayscale: false },
  dusk: { saturation: 0.95, contrast: 1.05, brightness: 0.95, sepia: 0.15, vignette: 0.5, warm: 0.35, grain: 0.15, grayscale: false },
};

export function gradeFor(effect: PhotoEffect): Grade {
  return GRADES[effect];
}

const GradeShader = {
  uniforms: {
    tDiffuse: { value: null },
    saturation: { value: 1 },
    contrast: { value: 1 },
    brightness: { value: 1 },
    sepia: { value: 0 },
    vignette: { value: 0 },
    warm: { value: 0 },
  },
  vertexShader: /* glsl */ `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: /* glsl */ `
    uniform sampler2D tDiffuse;
    uniform float saturation, contrast, brightness, sepia, vignette, warm;
    varying vec2 vUv;
    void main() {
      vec4 c = texture2D(tDiffuse, vUv);
      vec3 col = c.rgb * brightness;
      float l = dot(col, vec3(0.299, 0.587, 0.114));
      col = mix(vec3(l), col, saturation);
      col = (col - 0.5) * contrast + 0.5;
      vec3 sep = vec3(dot(col, vec3(0.393, 0.769, 0.189)), dot(col, vec3(0.349, 0.686, 0.168)), dot(col, vec3(0.272, 0.534, 0.131)));
      col = mix(col, sep, sepia);
      col += vec3(0.10, 0.03, -0.08) * warm;
      vec2 d = vUv - 0.5;
      float v = 1.0 - smoothstep(0.35, 0.95, length(d) * 1.4);
      col *= mix(1.0, v, vignette);
      gl_FragColor = vec4(clamp(col, 0.0, 1.0), c.a);
    }
  `,
};

/** 後処理の組み立て。render() で composer を使って描く */
export class PhotoRig {
  readonly composer: EffectComposer;
  private readonly bokeh: BokehPass;
  private readonly grade: ShaderPass;
  private readonly film: FilmPass;
  params: PhotoParams = { ...DEFAULT_PHOTO };

  constructor(
    private readonly renderer: WebGLRenderer,
    scene: Scene,
    readonly camera: Camera,
  ) {
    this.composer = new EffectComposer(renderer);
    this.composer.addPass(new RenderPass(scene, camera));
    this.bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.02, maxblur: BOKEH_MAX_BLUR });
    this.composer.addPass(this.bokeh);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.film = new FilmPass(0.25, false);
    this.composer.addPass(this.film);
    // 色空間の変換（sRGB）。これが無いと後処理の出力がリニアのまま表示されて暗くなる
    this.composer.addPass(new OutputPass());
    this.apply();
  }

  /** params を各パスへ反映 */
  apply(): void {
    const p = this.params;
    const u = this.bokeh.uniforms as Record<string, { value: number }>;
    this.bokeh.enabled = p.bokeh !== false;
    u.focus.value = p.focusDistance;
    u.aperture.value = apertureForF(p.fNumber);
    u.maxblur.value = BOKEH_MAX_BLUR;
    const g = gradeFor(p.effect);
    const gu = this.grade.uniforms as Record<string, { value: number }>;
    gu.saturation.value = g.saturation;
    gu.contrast.value = g.contrast;
    gu.brightness.value = g.brightness * Math.pow(2, p.exposure ?? 0);
    gu.sepia.value = g.sepia;
    gu.vignette.value = g.vignette;
    gu.warm.value = g.warm;
    const fu = this.film.uniforms as Record<string, { value: number | boolean }>;
    fu.intensity.value = g.grain;
    fu.grayscale.value = g.grayscale;
    this.film.enabled = g.grain > 0 || g.grayscale;
  }

  setSize(w: number, h: number): void {
    this.composer.setPixelRatio(this.renderer.getPixelRatio());
    this.composer.setSize(w, h);
  }

  render(): void {
    this.composer.render();
  }

  dispose(): void {
    this.composer.dispose();
  }
}

export const tmpSize = new Vector2();
