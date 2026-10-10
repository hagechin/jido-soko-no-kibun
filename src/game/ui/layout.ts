import { icon, type IconName } from './icon';
import { UI } from '../data/balance';

export type LayoutMode = 'pc' | 'mobile';

export function currentLayout(): LayoutMode {
  return window.innerWidth < UI.mobileBreakpointPx ? 'mobile' : 'pc';
}

export function $<T extends HTMLElement = HTMLElement>(id: string): T {
  const el = document.getElementById(id);
  if (!el) throw new Error(`#${id} not found`);
  return el as T;
}

export function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  attrs: Record<string, string | number | boolean | undefined> = {},
  ...children: (Node | string | null | undefined)[]
): HTMLElementTagNameMap[K] {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (v === undefined || v === false) continue;
    if (k === 'class') e.className = String(v);
    else if (k === 'text') e.textContent = String(v);
    else if (k === 'html') e.innerHTML = String(v);
    else e.setAttribute(k, String(v));
  }
  for (const c of children) {
    if (c === null || c === undefined) continue;
    e.append(c);
  }
  return e;
}

/** パネル（シート）が開いているときは、その本文やボタンに重ならないようシートのすぐ上に出す。閉じていれば 3D ビューの下端 */
function placeToasts(host: HTMLElement): void {
  const sheet = document.getElementById('sheet');
  const view = host.parentElement;
  if (!sheet || !view) return;
  if (sheet.hidden) {
    // 「眺めモードにする？」のボタンが出ていればその上に
    const suggest = document.getElementById('calm-suggest');
    if (suggest && !suggest.hidden) {
      const vr = view.getBoundingClientRect();
      const sg = suggest.getBoundingClientRect();
      host.style.bottom = `${Math.round(vr.bottom - sg.top + 8)}px`;
    } else host.style.bottom = '';
    host.style.top = '';
    return;
  }
  const vr = view.getBoundingClientRect();
  const sr = sheet.getBoundingClientRect();
  const above = vr.bottom - sr.top; // シートの上端までの高さ（ビュー下端から）
  if (above < vr.height - 60) {
    host.style.bottom = `${Math.max(12, above + 8)}px`;
    host.style.top = '';
  } else {
    // シートがビューをほぼ覆っている（スマホ）: ビューの上のオーダー列に重ねる（シートの見出しやボタンには重ねない）
    const orders = document.getElementById('orders');
    const orR = orders?.getBoundingClientRect();
    const overOrders = orR && orR.bottom <= vr.top + 1 && orR.height > 40;
    host.style.bottom = 'auto';
    host.style.top = overOrders ? `${Math.round(orR.top - vr.top + 6)}px` : '8px';
    // オーダー列に収まるのは 1 つだけ（2 つ目はシートの見出しにかかる）
    while (host.children.length > 1) host.firstElementChild?.remove();
    return;
  }
  // シートが開いている間は 2 つまで（ボタンを覆わない）
  while (host.children.length > 2) host.firstElementChild?.remove();
}

let toastsSuppressed = false;
/** フォトモード中はゲームのトーストを出さない（フォトモード自身の案内は force で出す） */
export function setToastsSuppressed(on: boolean): void {
  toastsSuppressed = on;
  if (on) document.getElementById('toasts')?.replaceChildren();
}

export function showToast(text: string, ms = 2200, iconName?: IconName, force = false): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  if (toastsSuppressed && !force) return;
  // 同じ文のトーストが出ている間は重ねない（追いつき計算などで同じイベントが続けて起きる）
  for (const c of Array.from(host.children)) if ((c as HTMLElement).dataset.text === text) return;
  const t = el('div', { class: 'toast' }, iconName ? icon(iconName, 16) : null, el('span', { text }));
  t.dataset.text = text;
  host.append(t);
  placeToasts(host);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => t.remove(), ms);
}
