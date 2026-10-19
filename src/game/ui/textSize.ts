/**
 * 文字の大きさ（1.0.2。「老眼で見づらい」への対応）。
 * UI の各部分（HUD・オーダー・下のバー・パネル・モーダル・トースト）を CSS の zoom でまとめて拡大する。
 * 3D のビューは拡大しない。選択は localStorage に覚え、起動時に反映する。
 */
export type TextSize = 'small' | 'normal' | 'large' | 'xlarge';

export const TEXT_SIZES: { id: TextSize; name: string; scale: number; desc: string }[] = [
  { id: 'small', name: '小', scale: 0.9, desc: '画面を広く使いたいとき' },
  { id: 'normal', name: '標準', scale: 1, desc: '標準の大きさ' },
  { id: 'large', name: '大', scale: 1.2, desc: '文字が約 1.2 倍' },
  { id: 'xlarge', name: '特大', scale: 1.4, desc: '文字が約 1.4 倍。パネルは縦に長くなります' },
];

const KEY = 'jido-soko-no-kibun:text-size';

export function isTextSize(v: unknown): v is TextSize {
  return TEXT_SIZES.some((t) => t.id === v);
}

export function scaleFor(size: TextSize): number {
  return TEXT_SIZES.find((t) => t.id === size)?.scale ?? 1;
}

/** 保存されている選択（まだ選んでいなければ null） */
export function loadTextSizeChoice(): TextSize | null {
  try {
    const v = localStorage.getItem(KEY);
    return isTextSize(v) ? v : null;
  } catch {
    return null;
  }
}

export function loadTextSize(): TextSize {
  return loadTextSizeChoice() ?? 'normal';
}

export function saveTextSize(size: TextSize): void {
  try {
    localStorage.setItem(KEY, size);
  } catch {
    /* ignore */
  }
}

/** html に data-text-size と --ui-scale を付ける（CSS 側で zoom とレイアウトの高さに使う） */
export function applyTextSize(size: TextSize): void {
  const root = document.documentElement;
  root.dataset.textSize = size;
  root.style.setProperty('--ui-scale', String(scaleFor(size)));
  window.dispatchEvent(new Event('resize'));
}
