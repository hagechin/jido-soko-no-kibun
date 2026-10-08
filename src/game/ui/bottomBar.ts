import { icon, type IconName } from './icon';
import { $, el } from './layout';
import { tr } from '../i18n';

export type PanelId = 'build' | 'upgrades' | 'inventory' | 'settings' | 'station' | 'debug' | 'robots' | 'port' | 'store';

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
    if (this.current !== id) this.sheetBody.scrollTop = 0; // 別のパネルに切り替えたら先頭から
    this.current = id;
    const titles: Record<PanelId, string> = { build: tr(tr(tr(tr('建設モード')))), upgrades: tr(tr(tr(tr('アップグレード')))), inventory: tr(tr(tr(tr('在庫')))), settings: tr(tr(tr(tr('設定')))), station: tr(tr(tr(tr('ステーション')))), debug: tr(tr(tr(tr('サンドボックス')))), robots: tr(tr(tr(tr('ロボ一覧')))), port: tr(tr(tr(tr('ポート')))), store: tr(tr(tr(tr('追加機能ストア')))) };
    this.sheetTitle.textContent = titles[id];
    this.sheet.classList.toggle('is-compact', id === 'build');
    this.refresh();
    this.sheet.hidden = false;
    for (const b of document.querySelectorAll<HTMLButtonElement>('.bar-btn[data-panel]')) {
      b.classList.toggle('is-active', b.dataset.panel === id);
    }
    this.onPanelChange?.(id);
  }

  refresh(): void {
    if (!this.current) return;
    const r = this.renderers.get(this.current);
    this.sheetBody.replaceChildren();
    if (r) r(this.sheetBody);
    else this.sheetBody.append(el('p', { class: 'muted', text: tr(tr(tr(tr('このパネルは後のマイルストーンで実装します。')))) }));
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
