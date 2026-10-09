import { icon, type IconName } from './icon';
import { $, el } from './layout';
import { tr } from '../i18n';

export type PanelId = 'build' | 'upgrades' | 'inventory' | 'settings' | 'station' | 'debug' | 'robots' | 'port' | 'store' | 'achievements';

export class BottomBar {
  private sheet = $('sheet');
  private sheetTitle = $('sheet-title');
  private sheetBody = $('sheet-body');
  private selectedInfo = $('selected-info');
  private current: PanelId | null = null;
  private renderers = new Map<PanelId, (body: HTMLElement) => void>();
  onPanelChange: ((panel: PanelId | null) => void) | null = null;

  constructor() {
    for (const b of document.querySelectorAll<HTMLButtonElement>('.bar-btn[data-panel]')) {
      b.addEventListener('click', () => this.toggle(b.dataset.panel as PanelId));
    }
    $('sheet-close').addEventListener('click', () => this.close());
  }

  registerPanel(id: PanelId, render: (body: HTMLElement) => void): void {
    this.renderers.set(id, render);
  }

  /** 下部バーにボタンを追加する（デバッグ用） */
  addButton(id: PanelId, iconName: IconName, label: string): void {
    const b = el('button', { class: 'btn bar-btn', 'data-panel': id }, el('span', { class: 'ico' }, icon(iconName, 18)), el('span', { class: 'lbl', text: label }));
    b.addEventListener('click', () => this.toggle(id));
    const actions = document.querySelector('.bottom-actions');
    actions?.prepend(b);
  }

  get open(): PanelId | null {
    return this.current;
  }

  toggle(id: PanelId): void {
    if (this.current === id) this.close();
    else this.show(id);
  }

  show(id: PanelId): void {
    const switched = this.current !== id;
    this.current = id;
    const titles: Record<PanelId, string> = { build: tr('建設モード'), upgrades: tr('アップグレード'), inventory: tr('在庫'), settings: tr('設定'), station: tr('ステーション'), debug: tr('サンドボックス'), robots: tr('ロボ一覧'), port: tr('ポート'), store: tr('追加機能ストア'), achievements: tr('実績') };
    this.sheetTitle.textContent = titles[id];
    this.sheet.classList.toggle('is-compact', id === 'build');
    this.refresh();
    this.sheet.hidden = false;
    if (switched) this.sheetBody.scrollTop = 0; // 別のパネルに切り替えたら先頭から（描いたあとに戻す）
    for (const b of document.querySelectorAll<HTMLButtonElement>('.bar-btn[data-panel]')) {
      b.classList.toggle('is-active', b.dataset.panel === id);
    }
    this.onPanelChange?.(id);
  }

  /** パネルの見出しを差し替える（ステーションの座標など。show() の後に呼ぶ） */
  setTitle(text: string): void {
    this.sheetTitle.textContent = text;
  }

  refresh(): void {
    if (!this.current) return;
    const r = this.renderers.get(this.current);
    this.sheetBody.replaceChildren();
    if (r) r(this.sheetBody);
    else this.sheetBody.append(el('p', { class: 'muted', text: tr('このパネルは後のマイルストーンで実装します。') }));
  }

  close(): void {
    this.current = null;
    this.sheet.hidden = true;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.bar-btn[data-panel]')) b.classList.remove('is-active');
    this.onPanelChange?.(null);
  }

  setSelectedInfo(node: Node | string): void {
    this.selectedInfo.replaceChildren(typeof node === 'string' ? el('span', { text: node }) : node);
  }
}
