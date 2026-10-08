/**
 * 静的な HTML（index.astro）の日本語を、起動時に辞書で置き換える。
 * 文字ノードと title / aria-label / alt / placeholder を対象にする。日本語のときは何もしない
 */
import { locale, tr } from './index';

const JA = /[぀-ヿ一-鿿]/;

export function translateStaticDom(root: ParentNode = document): void {
  if (locale() === 'ja') return;
  const walker = document.createTreeWalker(root as Node, NodeFilter.SHOW_TEXT);
  const texts: Text[] = [];
  for (let n = walker.nextNode(); n; n = walker.nextNode()) texts.push(n as Text);
  for (const t of texts) {
    const raw = t.nodeValue ?? '';
    if (!JA.test(raw)) continue;
    const m = /^(\s*)(.*?)(\s*)$/s.exec(raw)!;
    const out = tr(m[2]);
    if (out !== m[2]) t.nodeValue = m[1] + out + m[3];
  }
  for (const el of (root as ParentNode).querySelectorAll<HTMLElement>('[title], [aria-label], [alt], [placeholder]')) {
    for (const attr of ['title', 'aria-label', 'alt', 'placeholder']) {
      const v = el.getAttribute(attr);
      if (v && JA.test(v)) el.setAttribute(attr, tr(v));
    }
  }
  if (root === document) {
    document.documentElement.lang = locale();
    document.title = tr(document.title);
    const meta = document.querySelector('meta[name="description"]');
    const d = meta?.getAttribute('content');
    if (meta && d) meta.setAttribute('content', tr(d));
  }
}
