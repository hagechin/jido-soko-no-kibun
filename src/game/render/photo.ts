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
import { tr } from '../i18n';

export type PhotoEffect = 'none' | 'film' | 'mono' | 'sepia' | 'vivid' | 'dusk';
export type PhotoAspect = 'screen' | '3:2' | '16:9' | '4:5' | '1:1';

export interface PhotoParams {
  /** 焦点距離（35mm 換算 mm） */
  focalMm: number;
  /** 絞り F 値 */
  fNumber: number;
  /** ピント位置（カメラからの距離、ワールド単位） */
  focusDistance: number;
  /** シャッター（ゲーム内 tick。0 = ブラーなし。1 tick = ロボの 1 マス移動の 1/5〜1/2） */
  shutterTicks: number;
  effect: PhotoEffect;
  aspect: PhotoAspect;
}

export const PHOTO_CHOICES = {
  focalMm: [24, 35, 50, 85, 135] as const,
  fNumber: [1.4, 2.8, 5.6, 11, 16] as const,
  /** 表示名 → tick */
  shutter: [
    { label: '1/250', ticks: 0 },
    { label: '1/60', ticks: 0.6 },
    { label: '1/30', ticks: 1.2 },
    { label: '1/15', ticks: 2.5 },
    { label: '1/8', ticks: 5 },
  ] as const,
  effect: [
    { id: 'none', name: tr('なし') },
    { id: 'film', name: tr('フィルム') },
    { id: 'mono', name: tr('モノクロ') },
    { id: 'sepia', name: tr('セピア') },
    { id: 'vivid', name: tr('ビビッド') },
    { id: 'dusk', name: tr('夕暮れ') },
  ] as { id: PhotoEffect; name: string }[],
  aspect: [
    { id: 'screen', name: tr('画面') },
    { id: '3:2', name: '3:2' },
    { id: '16:9', name: '16:9' },
    { id: '4:5', name: '4:5' },
    { id: '1:1', name: '1:1' },
  ] as { id: PhotoAspect; name: string }[],
};

export const DEFAULT_PHOTO: PhotoParams = { focalMm: 50, fNumber: 2.8, focusDistance: 12, shutterTicks: 0, effect: 'film', aspect: 'screen' };

/** 35mm 換算の焦点距離 → 縦の画角（度）。センサー縦 24mm */
export function fovForFocal(focalMm: number): number {
  return (2 * Math.atan(12 / focalMm) * 180) / Math.PI;
}

/** F 値 → BokehPass の aperture。F1.4 で強く、F16 でほぼ無し */
export function apertureForF(fNumber: number): number {
  return 0.06 / fNumber;
}

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

/** シャッターの合成コマ数（ブラーが長いほど多く） */
export function shutterFrames(ticks: number): number {
  return ticks <= 0 ? 1 : Math.min(16, Math.max(4, Math.round(ticks * 3)));
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
    this.bokeh = new BokehPass(scene, camera, { focus: 12, aperture: 0.02, maxblur: 0.012 });
    this.composer.addPass(this.bokeh);
    this.grade = new ShaderPass(GradeShader);
    this.composer.addPass(this.grade);
    this.film = new FilmPass(0.25, false);
    this.composer.addPass(this.film);
    this.apply();
  }

  /** params を各パスへ反映 */
  apply(): void {
    const p = this.params;
    const u = this.bokeh.uniforms as Record<string, { value: number }>;
    u.focus.value = p.focusDistance;
    u.aperture.value = apertureForF(p.fNumber);
    u.maxblur.value = 0.012;
    const g = gradeFor(p.effect);
    const gu = this.grade.uniforms as Record<string, { value: number }>;
    gu.saturation.value = g.saturation;
    gu.contrast.value = g.contrast;
    gu.brightness.value = g.brightness;
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
