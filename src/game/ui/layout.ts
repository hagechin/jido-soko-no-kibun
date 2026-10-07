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

export function showToast(text: string, ms = 2200): void {
  const host = document.getElementById('toasts');
  if (!host) return;
  const t = el('div', { class: 'toast', text });
  host.append(t);
  while (host.children.length > 4) host.firstElementChild?.remove();
  setTimeout(() => t.remove(), ms);
}
