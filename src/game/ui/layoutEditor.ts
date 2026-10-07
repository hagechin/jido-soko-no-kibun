/**
 * レイアウトエディタ UI（★）: 倉庫を止めて真俯瞰の 2D でまとめて配置を変える。
 *  - 選択ツール: ドラッグで矩形選択、選択をドラッグで移動（スタックは中身ごと、ポートは置かれたビンごと）
 *  - 配置ツール: ドラッグで塗る（スタック／ポート／ピッカー／入荷ST／待機スポット）、撤去
 *  - ホイール／ピンチでズーム、2 本指・中ボタン・手のひらツールでパン
 *  - 元に戻す／やり直す、東・南への拡張、3D プレビュー（実際の描画で確認）、保存して再開／キャンセル
 * ロジックは sim/layoutEditor.ts。ここは描画と入力だけ
 */
import { ITEM_BY_ID } from '../data/items';
import { expand, expansionCost, type BuildKind, type ExpandDir } from '../sim/build';
import { cellAt } from '../sim/grid';
import { countSelection, eraseCell, moveCells, paintCell, restoreLayout, snapshotLayout, validateLayout, type LayoutSnapshot } from '../sim/layoutEditor';
import type { Vec2, WorldState } from '../sim/types';
import { icon, iconText, type IconName } from './icon';
import { $, el, showToast } from './layout';

type Tool = 'select' | 'pan' | BuildKind | 'erase';

const TOOLS: { id: Tool; icon: IconName; label: string }[] = [
  { id: 'select', icon: 'square', label: '選択' },
  { id: 'pan', icon: 'hand', label: '手のひら' },
  { id: 'stack', icon: 'layers', label: 'スタック' },
  { id: 'port', icon: 'box', label: 'ポート' },
  { id: 'pickStation', icon: 'user', label: 'ピッカー' },
  { id: 'inboundStation', icon: 'package', label: '入荷ST' },
  { id: 'waitSpot', icon: 'circle-parking', label: '待機' },
  { id: 'erase', icon: 'eraser', label: '撤去' },
];

const COLORS: Record<string, string> = {
  floor: '#26333f',
  stack: '#8a6a3a',
  port: '#e6c050',
  pickStation: '#4fc3f7',
  inboundStation: '#7bd389',
  waitSpot: '#3b4c60',
  inboundDock: '#6d7f93',
  outboundDock: '#6d7f93',
};

interface Pointer {
  id: number;
  x: number;
  y: number;
  startX: number;
  startY: number;
  cell: Vec2;
  mode: 'rect' | 'move' | 'paint' | 'pan' | 'none';
  moved: boolean;
}

export interface EditorHost {
  /** 保存（配置が正しいときだけ呼ばれる） */
  onSave: () => void;
  /** キャンセル（元の配置に戻した後に呼ばれる） */
  onCancel: () => void;
  /** 3D プレビューの表示／非表示 */
  onPreview: (on: boolean) => void;
}

export class LayoutEditor {
  open = false;
  private root = $('layout-editor');
  private canvas = el('canvas', { class: 'editor-canvas' });
  private stage = el('div', { class: 'editor-stage' });
  private status = el('div', { class: 'editor-status' });
  private toolbar = el('div', { class: 'editor-tools' });
  private actions = el('div', { class: 'editor-actions' });
  private previewBar = el('div', { class: 'editor-preview-bar' });
  private tool: Tool = 'select';
  private scale = 24;
  private ox = 0;
  private oy = 0;
  private selection = new Set<string>();
  private pointers = new Map<number, Pointer>();
  private drag: { dx: number; dz: number } | null = null;
  private rect: { a: Vec2; b: Vec2 } | null = null;
  private undo: LayoutSnapshot[] = [];
  private redo: LayoutSnapshot[] = [];
  private original: LayoutSnapshot | null = null;
  private preview = false;
  private lastPinch = 0;
  private world: WorldState | null = null;
  private host: EditorHost | null = null;
  private raf = 0;

  constructor() {
    this.stage.append(this.canvas);
    this.root.append(this.toolbar, this.stage, this.status, this.actions, this.previewBar);
    const c = this.canvas;
    c.addEventListener('pointerdown', (e) => this.onDown(e));
    c.addEventListener('pointermove', (e) => this.onMove(e));
    c.addEventListener('pointerup', (e) => this.onUp(e));
    c.addEventListener('pointercancel', (e) => this.onUp(e));
    c.addEventListener('wheel', (e) => this.onWheel(e), { passive: false });
    c.addEventListener('contextmenu', (e) => e.preventDefault());
    window.addEventListener('keydown', (e) => this.onKey(e));
    window.addEventListener('resize', () => this.open && this.fit());
  }

  show(w: WorldState, host: EditorHost): void {
    this.world = w;
    this.host = host;
    this.open = true;
    this.original = snapshotLayout(w);
    this.undo = [];
    this.redo = [];
    this.selection.clear();
    this.tool = 'select';
    this.preview = false;
    this.root.hidden = false;
    document.body.classList.add('is-editing');
    this.renderChrome();
    this.fit();
    this.loop();
  }

  hide(): void {
    this.open = false;
    this.root.hidden = true;
    document.body.classList.remove('is-editing', 'is-previewing');
    cancelAnimationFrame(this.raf);
    this.world = null;
  }

  // ------------------------------------------------------------ chrome
  private renderChrome(): void {
    const w = this.world!;
    this.toolbar.replaceChildren();
    for (const t of TOOLS) {
      const b = el('button', { class: `btn editor-tool${this.tool === t.id ? ' is-active' : ''}`, type: 'button', title: t.label }, icon(t.icon, 18), el('span', { class: 'lbl', text: t.label }));
      b.addEventListener('click', () => {
        this.tool = t.id;
        this.renderChrome();
      });
      this.toolbar.append(b);
    }
    const sep = () => el('span', { class: 'editor-sep' });
    this.toolbar.append(sep());
    const undo = el('button', { class: 'btn editor-tool', type: 'button', title: '元に戻す（Ctrl+Z）' }, icon('refresh-cw', 18), el('span', { class: 'lbl', text: '戻す' }));
    undo.addEventListener('click', () => this.doUndo());
    if (!this.undo.length) undo.setAttribute('disabled', 'true');
    const redo = el('button', { class: 'btn editor-tool', type: 'button', title: 'やり直す（Ctrl+Y）' }, icon('refresh-cw', 18, 'flip'), el('span', { class: 'lbl', text: 'やり直し' }));
    redo.addEventListener('click', () => this.doRedo());
    if (!this.redo.length) redo.setAttribute('disabled', 'true');
    const del = el('button', { class: 'btn editor-tool', type: 'button', title: '選択した設備を撤去（Delete）' }, icon('trash-2', 18), el('span', { class: 'lbl', text: '選択を撤去' }));
    del.addEventListener('click', () => this.eraseSelection());
    if (!this.selection.size) del.setAttribute('disabled', 'true');
    this.toolbar.append(undo, redo, del, sep());
    for (const [dir, ico, lbl] of [
      ['east', 'move-horizontal', '東へ +4'],
      ['south', 'move-vertical', '南へ +4'],
    ] as [ExpandDir, IconName, string][]) {
      const cost = expansionCost(w, dir);
      const b = el('button', { class: 'btn editor-tool', type: 'button', title: cost === null ? 'これ以上広げられません' : `${cost} コイン` }, icon(ico, 18), el('span', { class: 'lbl', text: lbl }));
      if (cost === null) b.setAttribute('disabled', 'true');
      b.addEventListener('click', () => {
        this.push();
        const r = expand(w, dir);
        if (!r.ok) {
          this.undo.pop();
          showToast(r.reason);
        } else this.fit();
        this.renderChrome();
      });
      this.toolbar.append(b);
    }

    this.actions.replaceChildren();
    const prev = el('button', { class: 'btn', type: 'button' }, iconText('crosshair', '3D プレビュー', 16));
    prev.addEventListener('click', () => this.setPreview(true));
    const cancel = el('button', { class: 'btn danger', type: 'button' }, iconText('x', 'キャンセル（元に戻す）', 16));
    cancel.addEventListener('click', () => {
      if (!confirm('編集を破棄して元のレイアウトに戻しますか？')) return;
      restoreLayout(w, this.original!);
      this.host?.onCancel();
    });
    const problems = validateLayout(w);
    const save = el('button', { class: 'btn primary', type: 'button' }, iconText('save', '保存して出荷を再開', 16));
    if (problems.length) save.setAttribute('disabled', 'true');
    save.addEventListener('click', () => this.host?.onSave());
    this.actions.append(prev, cancel, save);

    this.previewBar.replaceChildren();
    const back = el('button', { class: 'btn primary', type: 'button' }, iconText('layers', 'エディタに戻る', 16));
    back.addEventListener('click', () => this.setPreview(false));
    this.previewBar.append(el('span', { class: 'muted small', text: '3D プレビュー: ドラッグで回転、ホイール／ピンチでズーム。倉庫は停止中' }), back);
    this.renderStatus(problems);
  }

  private renderStatus(problems = validateLayout(this.world!)): void {
    const w = this.world!;
    this.status.replaceChildren();
    const n = countSelection(w, this.selectedCells());
    const selText = this.selection.size ? `選択 ${this.selection.size} マス（スタック ${n.stacks} / ポート ${n.ports} / ステーション ${n.stations} / 待機 ${n.waitSpots}）。ドラッグで移動、Delete で撤去` : this.tool === 'select' ? 'ドラッグで範囲選択、設備をタップで選択' : this.tool === 'pan' ? 'ドラッグで画面を動かす' : this.tool === 'erase' ? 'タップ／ドラッグで撤去（ビンの入ったスタックは不可）' : 'タップ／ドラッグで配置';
    this.status.append(el('div', { class: 'editor-line' }, el('span', { text: `${w.width}×${w.height} マス　` }), icon('coins', 12), el('span', { text: ` ${Math.floor(w.coins).toLocaleString('ja-JP')}　${selText}` })));
    if (problems.length) this.status.append(el('div', { class: 'editor-line is-problem' }, icon('triangle-alert', 14), el('span', { text: ' ' + problems.slice(0, 3).join(' / ') + (problems.length > 3 ? ` ほか ${problems.length - 3} 件` : '') })));
    else this.status.append(el('div', { class: 'editor-line is-ok' }, icon('check', 14), el('span', { text: ' 保存できる配置です' })));
  }

  private setPreview(on: boolean): void {
    this.preview = on;
    document.body.classList.toggle('is-previewing', on);
    this.host?.onPreview(on);
  }

  // ------------------------------------------------------------ edits
  private push(): void {
    this.undo.push(snapshotLayout(this.world!));
    if (this.undo.length > 100) this.undo.shift();
    this.redo = [];
  }

  private doUndo(): void {
    const s = this.undo.pop();
    if (!s) return;
    this.redo.push(snapshotLayout(this.world!));
    restoreLayout(this.world!, s);
    this.selection.clear();
    this.renderChrome();
  }

  private doRedo(): void {
    const s = this.redo.pop();
    if (!s) return;
    this.undo.push(snapshotLayout(this.world!));
    restoreLayout(this.world!, s);
    this.selection.clear();
    this.renderChrome();
  }

  private selectedCells(): Vec2[] {
    return [...this.selection].map((k) => {
      const [x, z] = k.split(',').map(Number);
      return { x, z };
    });
  }

  private eraseSelection(): void {
    if (!this.selection.size) return;
    this.push();
    let refused = '';
    for (const c of this.selectedCells()) {
      const r = eraseCell(this.world!, c.x, c.z);
      if (!r.ok) refused = r.reason;
    }
    if (refused) showToast(refused);
    this.selection.clear();
    this.renderChrome();
  }

  // ------------------------------------------------------------ view
  private fit(): void {
    const w = this.world!;
    this.resizeCanvas();
    const rect = this.stage.getBoundingClientRect();
    const availW = rect.width - 24;
    const availH = rect.height - 24;
    // 上に 2 行ぶん「倉庫の外で待機中のロボ」の表示を取る
    this.scale = Math.max(6, Math.min(48, Math.floor(Math.min(availW / w.width, availH / (w.height + 2)))));
    this.ox = Math.floor((rect.width - w.width * this.scale) / 2);
    this.oy = Math.floor(12 + 2 * this.scale + Math.max(0, (availH - (w.height + 2) * this.scale) / 2));
  }

  private resizeCanvas(): void {
    const rect = this.stage.getBoundingClientRect();
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    this.canvas.width = Math.floor(rect.width * dpr);
    this.canvas.height = Math.floor(rect.height * dpr);
    this.canvas.style.width = `${rect.width}px`;
    this.canvas.style.height = `${rect.height}px`;
  }

  private cellAtPoint(px: number, py: number): Vec2 {
    return { x: Math.floor((px - this.ox) / this.scale), z: Math.floor((py - this.oy) / this.scale) };
  }

  private loop = (): void => {
    if (!this.open) return;
    if (!this.preview) this.draw();
    this.raf = requestAnimationFrame(this.loop);
  };

  private draw(): void {
    const w = this.world!;
    const ctx = this.canvas.getContext('2d')!;
    const dpr = Math.min(2, window.devicePixelRatio || 1);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    const s = this.scale;
    const dx = this.drag?.dx ?? 0;
    const dz = this.drag?.dz ?? 0;
    // 倉庫の外（北側）に待機しているロボ
    const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
    const amrs = w.robots.length - shelves;
    ctx.fillStyle = 'rgba(255,255,255,0.55)';
    ctx.font = `${Math.max(10, Math.min(13, s * 0.6))}px system-ui, sans-serif`;
    ctx.textBaseline = 'middle';
    ctx.fillText(`倉庫の外で待機中: 棚ロボ ${shelves} 台 / 搬送ロボ ${amrs} 台（保存すると戻ります）`, this.ox, this.oy - s);
    for (let z = 0; z < w.height; z++) {
      for (let x = 0; x < w.width; x++) {
        const k = cellAt(w, x, z) ?? 'floor';
        const key = `${x},${z}`;
        const selected = this.selection.has(key);
        const px = this.ox + x * s;
        const py = this.oy + z * s;
        // 移動中は選択した設備を元の場所から消して（薄く）ゴーストを後で描く
        ctx.fillStyle = selected && this.drag ? COLORS.floor : COLORS[k] ?? COLORS.floor;
        ctx.fillRect(px, py, s, s);
        ctx.strokeStyle = 'rgba(0,0,0,0.35)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + 0.5, py + 0.5, s - 1, s - 1);
        if (!(selected && this.drag)) this.drawContent(ctx, w, k, x, z, px, py, s);
        if (selected && !this.drag) {
          ctx.strokeStyle = '#ffffff';
          ctx.lineWidth = 2;
          ctx.strokeRect(px + 1.5, py + 1.5, s - 3, s - 3);
        }
      }
    }
    // 移動のゴースト
    if (this.drag && this.selection.size) {
      const ok = this.canMove(dx, dz);
      ctx.globalAlpha = 0.75;
      for (const c of this.selectedCells()) {
        const k = cellAt(w, c.x, c.z) ?? 'floor';
        if (k === 'floor') continue;
        const px = this.ox + (c.x + dx) * s;
        const py = this.oy + (c.z + dz) * s;
        ctx.fillStyle = COLORS[k] ?? COLORS.floor;
        ctx.fillRect(px, py, s, s);
        this.drawContent(ctx, w, k, c.x, c.z, px, py, s);
        ctx.strokeStyle = ok ? '#7bd389' : '#ff6b6b';
        ctx.lineWidth = 2;
        ctx.strokeRect(px + 1, py + 1, s - 2, s - 2);
      }
      ctx.globalAlpha = 1;
    }
    // 矩形選択
    if (this.rect) {
      const a = this.rect.a;
      const b = this.rect.b;
      const x0 = Math.min(a.x, b.x);
      const z0 = Math.min(a.z, b.z);
      const x1 = Math.max(a.x, b.x);
      const z1 = Math.max(a.z, b.z);
      ctx.strokeStyle = 'rgba(255,255,255,0.9)';
      ctx.setLineDash([4, 3]);
      ctx.lineWidth = 1.5;
      ctx.strokeRect(this.ox + x0 * s, this.oy + z0 * s, (x1 - x0 + 1) * s, (z1 - z0 + 1) * s);
      ctx.setLineDash([]);
    }
    // 外枠
    ctx.strokeStyle = 'rgba(255,255,255,0.5)';
    ctx.lineWidth = 1.5;
    ctx.strokeRect(this.ox, this.oy, w.width * s, w.height * s);
  }

  private drawContent(ctx: CanvasRenderingContext2D, w: WorldState, k: string, x: number, z: number, px: number, py: number, s: number): void {
    if (k === 'stack') {
      const st = w.stacks.find((o) => o.x === x && o.z === z);
      if (!st) return;
      const top = st.bins.length ? w.bins[st.bins[st.bins.length - 1]] : null;
      if (top?.item) {
        ctx.fillStyle = ITEM_BY_ID[top.item]?.color ?? '#fff';
        ctx.fillRect(px + s * 0.25, py + s * 0.25, s * 0.5, s * 0.5);
      } else if (top) {
        ctx.strokeStyle = 'rgba(255,255,255,0.6)';
        ctx.lineWidth = 1;
        ctx.strokeRect(px + s * 0.3, py + s * 0.3, s * 0.4, s * 0.4);
      }
      if (s >= 14 && st.bins.length) {
        ctx.fillStyle = '#fff';
        ctx.font = `${Math.max(8, s * 0.38)}px system-ui, sans-serif`;
        ctx.textBaseline = 'alphabetic';
        ctx.fillText(String(st.bins.length), px + 2, py + s - 2);
      }
    } else if (k === 'port') {
      const p = w.ports.find((o) => o.x === x && o.z === z);
      const n = (p?.outbound.length ?? 0) + (p?.returns.length ?? 0);
      ctx.fillStyle = '#1b1b1b';
      ctx.font = `bold ${Math.max(8, s * 0.45)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(n ? `P${n}` : 'P', px + s / 2, py + s / 2);
      ctx.textAlign = 'left';
    } else if (k === 'pickStation' || k === 'inboundStation') {
      ctx.fillStyle = '#1b1b1b';
      ctx.font = `bold ${Math.max(8, s * 0.45)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(k === 'pickStation' ? 'K' : 'I', px + s / 2, py + s / 2);
      ctx.textAlign = 'left';
    } else if (k === 'waitSpot') {
      ctx.strokeStyle = 'rgba(255,255,255,0.5)';
      ctx.setLineDash([2, 2]);
      ctx.strokeRect(px + 3, py + 3, s - 6, s - 6);
      ctx.setLineDash([]);
    } else if (k === 'inboundDock' || k === 'outboundDock') {
      ctx.fillStyle = '#fff';
      ctx.font = `${Math.max(8, s * 0.4)}px system-ui, sans-serif`;
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'center';
      ctx.fillText(k === 'inboundDock' ? '入' : '出', px + s / 2, py + s / 2);
      ctx.textAlign = 'left';
    }
  }

  private canMove(dx: number, dz: number): boolean {
    const w = this.world!;
    const cells = this.selectedCells().filter((c) => cellAt(w, c.x, c.z) !== 'floor');
    const keys = new Set(cells.map((c) => `${c.x},${c.z}`));
    return cells.every((c) => {
      const nx = c.x + dx;
      const nz = c.z + dz;
      if (nx < 0 || nz < 0 || nx >= w.width || nz >= w.height) return false;
      const k = cellAt(w, nx, nz);
      return k === 'floor' || keys.has(`${nx},${nz}`);
    });
  }

  // ------------------------------------------------------------ input
  private onDown(e: PointerEvent): void {
    if (!this.open || this.preview) return;
    this.canvas.setPointerCapture(e.pointerId);
    const cell = this.cellAtPoint(e.offsetX, e.offsetY);
    const p: Pointer = { id: e.pointerId, x: e.offsetX, y: e.offsetY, startX: e.offsetX, startY: e.offsetY, cell, mode: 'none', moved: false };
    this.pointers.set(e.pointerId, p);
    if (this.pointers.size === 2) {
      for (const q of this.pointers.values()) q.mode = 'pan';
      const [a, b] = [...this.pointers.values()];
      this.lastPinch = Math.hypot(a.x - b.x, a.y - b.y);
      this.rect = null;
      this.drag = null;
      return;
    }
    const inside = cell.x >= 0 && cell.z >= 0 && cell.x < this.world!.width && cell.z < this.world!.height;
    if (e.button === 1 || this.tool === 'pan' || !inside) {
      p.mode = 'pan';
      return;
    }
    if (this.tool === 'select') {
      if (this.selection.has(`${cell.x},${cell.z}`)) {
        p.mode = 'move';
        this.drag = { dx: 0, dz: 0 };
      } else {
        p.mode = 'rect';
        this.rect = { a: cell, b: cell };
      }
      return;
    }
    // 配置／撤去: ストローク開始でスナップショット
    p.mode = 'paint';
    this.push();
    this.applyPaint(cell);
  }

  private onMove(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    const dxPx = e.offsetX - p.x;
    const dyPx = e.offsetY - p.y;
    p.x = e.offsetX;
    p.y = e.offsetY;
    if (Math.hypot(p.x - p.startX, p.y - p.startY) > 6) p.moved = true;
    if (this.pointers.size === 2) {
      const [a, b] = [...this.pointers.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      if (this.lastPinch > 0) this.zoomAt((a.x + b.x) / 2, (a.y + b.y) / 2, dist / this.lastPinch);
      this.lastPinch = dist;
      this.ox += dxPx / 2;
      this.oy += dyPx / 2;
      return;
    }
    const cell = this.cellAtPoint(p.x, p.y);
    if (p.mode === 'pan') {
      this.ox += dxPx;
      this.oy += dyPx;
    } else if (p.mode === 'rect' && this.rect) {
      this.rect.b = cell;
    } else if (p.mode === 'move' && this.drag) {
      this.drag = { dx: cell.x - p.cell.x, dz: cell.z - p.cell.z };
    } else if (p.mode === 'paint') {
      this.applyPaint(cell);
    }
  }

  private onUp(e: PointerEvent): void {
    const p = this.pointers.get(e.pointerId);
    if (!p) return;
    this.pointers.delete(e.pointerId);
    this.canvas.releasePointerCapture?.(e.pointerId);
    if (this.pointers.size) {
      this.lastPinch = 0;
      return;
    }
    const w = this.world!;
    if (p.mode === 'rect' && this.rect) {
      const a = this.rect.a;
      const b = this.rect.b;
      this.rect = null;
      if (!p.moved) {
        // タップ: その設備だけ選択（床なら選択解除）
        this.selection.clear();
        const k = cellAt(w, a.x, a.z);
        if (k && k !== 'floor') this.selection.add(`${a.x},${a.z}`);
      } else {
        this.selection.clear();
        for (let z = Math.max(0, Math.min(a.z, b.z)); z <= Math.min(w.height - 1, Math.max(a.z, b.z)); z++) for (let x = Math.max(0, Math.min(a.x, b.x)); x <= Math.min(w.width - 1, Math.max(a.x, b.x)); x++) if (cellAt(w, x, z) !== 'floor') this.selection.add(`${x},${z}`);
      }
      this.renderChrome();
    } else if (p.mode === 'move' && this.drag) {
      const { dx, dz } = this.drag;
      this.drag = null;
      if (dx || dz) {
        this.push();
        const r = moveCells(w, this.selectedCells(), dx, dz);
        if (!r.ok) {
          this.undo.pop();
          showToast(r.reason);
        } else {
          const moved = new Set<string>();
          for (const c of this.selectedCells()) moved.add(`${c.x + dx},${c.z + dz}`);
          this.selection = moved;
        }
      } else if (!p.moved) {
        // 選択内をタップ → その 1 マスだけに
        this.selection.clear();
        this.selection.add(`${p.cell.x},${p.cell.z}`);
      }
      this.renderChrome();
    } else if (p.mode === 'paint') {
      this.renderChrome();
    }
  }

  private applyPaint(cell: Vec2): void {
    const w = this.world!;
    if (cell.x < 0 || cell.z < 0 || cell.x >= w.width || cell.z >= w.height) return;
    const r = this.tool === 'erase' ? eraseCell(w, cell.x, cell.z) : paintCell(w, this.tool as BuildKind, cell.x, cell.z);
    if (!r.ok && r.reason !== 'そこには何かがあります') showToast(r.reason, 1500);
  }

  private onWheel(e: WheelEvent): void {
    if (!this.open || this.preview) return;
    e.preventDefault();
    const f = Math.exp(-e.deltaY * 0.0015);
    this.zoomAt(e.offsetX, e.offsetY, f);
  }

  private zoomAt(px: number, py: number, f: number): void {
    const ns = Math.max(4, Math.min(64, this.scale * f));
    const k = ns / this.scale;
    this.ox = px - (px - this.ox) * k;
    this.oy = py - (py - this.oy) * k;
    this.scale = ns;
  }

  private onKey(e: KeyboardEvent): void {
    if (!this.open || this.preview) return;
    const t = e.target as HTMLElement | null;
    if (t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA')) return;
    if ((e.ctrlKey || e.metaKey) && e.code === 'KeyZ') {
      e.preventDefault();
      if (e.shiftKey) this.doRedo();
      else this.doUndo();
    } else if ((e.ctrlKey || e.metaKey) && e.code === 'KeyY') {
      e.preventDefault();
      this.doRedo();
    } else if (e.code === 'Delete' || e.code === 'Backspace') {
      if (this.selection.size) {
        e.preventDefault();
        this.eraseSelection();
      }
    } else if (e.code === 'Escape') {
      this.selection.clear();
      this.renderChrome();
    }
  }
}
