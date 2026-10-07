import { RENDER } from '../data/balance';

export type QualityLevel = 'high' | 'low';

export interface QualitySettings {
  level: QualityLevel;
  pixelRatio: number;
  shadows: boolean;
  antialias: boolean;
}

const QUALITY_KEY = 'jido-soko-no-kibun:quality';

/** 端末から画質を自動判定する（§10.3）。保存済みの設定があればそれを優先。 */
export function detectQuality(): QualitySettings {
  let saved: string | null = null;
  try {
    saved = localStorage.getItem(QUALITY_KEY);
  } catch {
    /* ignore */
  }
  const level: QualityLevel = saved === 'high' || saved === 'low' ? saved : autoDetect();
  return settingsFor(level);
}

export function settingsFor(level: QualityLevel): QualitySettings {
  const dpr = typeof window !== 'undefined' ? window.devicePixelRatio || 1 : 1;
  if (level === 'high') {
    return { level, pixelRatio: Math.min(dpr, RENDER.maxPixelRatio), shadows: true, antialias: true };
  }
  return { level, pixelRatio: Math.min(dpr, RENDER.lowQualityPixelRatio), shadows: false, antialias: false };
}

export function saveQuality(level: QualityLevel): void {
  try {
    localStorage.setItem(QUALITY_KEY, level);
  } catch {
    /* ignore */
  }
}

function autoDetect(): QualityLevel {
  if (typeof navigator === 'undefined') return 'high';
  const ua = navigator.userAgent;
  const isMobile = /Android|iPhone|iPad|iPod|Mobile/i.test(ua) || (navigator.maxTouchPoints > 1 && /Macintosh/.test(ua));
  const cores = navigator.hardwareConcurrency ?? 4;
  const mem = (navigator as unknown as { deviceMemory?: number }).deviceMemory ?? 8;
  if (isMobile) return 'low';
  if (cores <= 2 || mem <= 2) return 'low';
  return 'high';
}
