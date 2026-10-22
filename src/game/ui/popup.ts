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

  /**
   * @param opts.column 縦並びのメニュー（コインの使い道）
   * @param opts.below タップ位置の下に出す（既定は上）。画面上端の HUD から開くメニュー用
   */
  show(clientX: number, clientY: number, items: { node: Node; onPick: () => void }[], title?: string, opts: { column?: boolean; below?: boolean } = {}): void {
    this.root.replaceChildren();
    this.root.classList.toggle('is-column', !!opts.column);
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
    // 画面内に収める。上端はセーフエリア（ステータスバー・Dynamic Island）の下から（HUD の padding-top が --sa-top）
    const app = $('app').getBoundingClientRect();
    const r = this.root.getBoundingClientRect();
    const safeTop = parseFloat(getComputedStyle($('hud')).paddingTop) || 0;
    // 左右のセーフエリア（.app の padding。iPhone Duo の縦のステータスバー）の内側に収める
    const cs = getComputedStyle($('app'));
    const padL = parseFloat(cs.paddingLeft) || 0;
    const padR = parseFloat(cs.paddingRight) || 0;
    const minY = safeTop + 8;
    const maxY = Math.max(minY, app.height - r.height - 8);
    const x = Math.min(Math.max(padL + 8, clientX - r.width / 2), app.width - padR - r.width - 8);
    const wantY = opts.below ? clientY + 6 : clientY - r.height - 12;
    const y = Math.min(Math.max(minY, wantY), maxY);
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
