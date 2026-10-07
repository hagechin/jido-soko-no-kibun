/** 絵文字の代わりの単色アイコン（Lucide）。UI の文字色（currentColor）で描くので白でもアクセント色でも使える */
import { LUCIDE, type IconName } from './icons/lucide';

export type { IconName };

/** <svg> の文字列（Astro のテンプレートや innerHTML 用） */
export function iconMarkup(name: IconName, size = 18, cls = ''): string {
  return `<svg class="icon${cls ? ' ' + cls : ''}" width="${size}" height="${size}" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${LUCIDE[name]}</svg>`;
}

/** <svg> 要素 */
export function icon(name: IconName, size = 18, cls = ''): SVGSVGElement {
  const tpl = document.createElement('template');
  tpl.innerHTML = iconMarkup(name, size, cls);
  return tpl.content.firstElementChild as SVGSVGElement;
}

/** アイコン + テキストの並び（ボタンの中身など） */
export function iconText(name: IconName, text: string, size = 16): DocumentFragment {
  const f = document.createDocumentFragment();
  f.append(icon(name, size), document.createTextNode(' ' + text));
  return f;
}
