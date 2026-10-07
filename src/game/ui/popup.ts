/** タップ位置近くに出す小さな選択ポップアップ（ビン選択など） */
import { $, el } from './layout';

export class Popup {
  private root = $('popup');
  private onDismiss: (() => void) | null = null;

  constructor() {
    document.addEventListener('pointerdown', (e) => {
      if (this.root.hidden) return;
      if (this.root.contains(e.target as Node)) return;
      this.hide();
    });
  }

  show(clientX: number, clientY: number, items: { node: Node; onPick: () => void }[], title?: string): void {
    this.root.replaceChildren();
    if (title) this.root.append(el('div', { class: 'popup-title', text: title }));
    for (const it of items) {
      const b = el('button', { class: 'btn popup-item', type: 'button' }, it.node);
      b.addEventListener('click', () => {
        it.onPick();
        this.hide();
      });
      this.root.append(b);
    }
    this.root.hidden = false;
    // 画面内に収める
    const app = $('app').getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    const x = Math.min(Math.max(8, clientX - r.width / 2), app.width - r.width - 8);
    const y = Math.min(Math.max(8, clientY - r.height - 12), app.height - r.height - 8);
    this.root.style.left = `${x}px`;
    this.root.style.top = `${y}px`;
  }

  hide(): void {
    if (this.root.hidden) return;
    this.root.hidden = true;
    this.root.replaceChildren();
    this.onDismiss?.();
  }

  get visible(): boolean {
    return !this.root.hidden;
  }
}
