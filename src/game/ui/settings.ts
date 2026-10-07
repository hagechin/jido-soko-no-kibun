/** 設定パネル: セーブ・新規開始・画質（書き出し／読み込みは M10、眺めモードの fps は M10） */
import { saveQuality, settingsFor, type QualityLevel } from '../render/quality';
import { el, showToast } from './layout';

export interface SettingsContext {
  quality: QualityLevel;
  /** 追加セクション（眺めモードなど） */
  extra?: (body: HTMLElement) => void;
  saveNow: () => boolean;
  newGame: () => void;
  setQuality: (q: QualityLevel) => void;
  exportSave?: () => void;
  importSave?: (file: File) => void;
  lastSavedAt: number | null;
}

export function renderSettings(body: HTMLElement, ctx: SettingsContext): void {
  body.append(el('h4', { text: 'セーブ' }));
  const saveBtn = el('button', { class: 'btn', type: 'button', text: '💾 今すぐセーブ' });
  saveBtn.addEventListener('click', () => showToast(ctx.saveNow() ? 'セーブしました' : 'セーブできませんでした'));
  body.append(el('div', { class: 'settings-row' }, saveBtn, el('span', { class: 'muted small', text: ctx.lastSavedAt ? `最終セーブ ${new Date(ctx.lastSavedAt).toLocaleTimeString('ja-JP')}（30 秒ごとに自動）` : '30 秒ごとに自動セーブ' })));
  if (ctx.exportSave) {
    const ex = el('button', { class: 'btn', type: 'button', text: '📤 ファイルに書き出し' });
    ex.addEventListener('click', () => ctx.exportSave!());
    const im = el('label', { class: 'btn', text: '📥 ファイルから読み込み' });
    const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) ctx.importSave?.(f);
      input.value = '';
    });
    im.append(input);
    body.append(el('div', { class: 'settings-row' }, ex, im));
  }
  const reset = el('button', { class: 'btn danger', type: 'button', text: '🗑 新しく始める' });
  reset.addEventListener('click', () => {
    if (confirm('セーブデータを消して最初から始めますか？')) ctx.newGame();
  });
  body.append(el('div', { class: 'settings-row' }, reset));

  body.append(el('h4', { text: '画質' }));
  const qRow = el('div', { class: 'settings-row' });
  for (const q of ['high', 'low'] as QualityLevel[]) {
    const b = el('button', { class: `btn${ctx.quality === q ? ' is-active' : ''}`, type: 'button', text: q === 'high' ? '高（影あり）' : '低（影なし・軽い）' });
    b.addEventListener('click', () => {
      saveQuality(q);
      ctx.setQuality(q);
      showToast(`画質: ${q === 'high' ? '高' : '低'}`);
    });
    qRow.append(b);
  }
  body.append(qRow);
  body.append(el('p', { class: 'muted small', text: `端末の自動判定: ${settingsFor(ctx.quality).pixelRatio.toFixed(1)}x 描画` }));
  ctx.extra?.(body);
}
