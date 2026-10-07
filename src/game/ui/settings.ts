import { iconText } from './icon';
/** 設定パネル: セーブ・新規開始・画質（書き出し／読み込みは M10、眺めモードの fps は M10） */
import { saveQuality, settingsFor, type QualityLevel } from '../render/quality';
import { DIFFICULTY, DIFFICULTY_ORDER, type DifficultyId } from '../data/balance';
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
  /** 難易度（受注まわりだけに効く。途中で変更できる） */
  difficulty?: DifficultyId;
  setDifficulty?: (d: DifficultyId) => void;
  /** 操作方法を開く */
  openHelp?: () => void;
  /** バックグラウンド動作（他のタブを見ている間も進める） */
  background?: boolean;
  setBackground?: (on: boolean) => void;
}

export function renderSettings(body: HTMLElement, ctx: SettingsContext): void {
  if (ctx.openHelp) {
    const help = el('button', { class: 'btn', type: 'button' }, iconText('info', '操作方法とショートカット（H）'));
    help.addEventListener('click', () => ctx.openHelp!());
    body.append(el('div', { class: 'settings-row' }, help));
  }
  if (ctx.setBackground) {
    body.append(el('h4', { text: 'バックグラウンド動作' }));
    const row = el('div', { class: 'settings-row' });
    for (const [on, label] of [
      [true, 'オン（他のタブを見ている間も進む）'],
      [false, 'オフ（戻ったときに追いつく／お留守番）'],
    ] as [boolean, string][]) {
      const b = el('button', { class: `btn${ctx.background === on ? ' is-active' : ''}`, type: 'button', text: label });
      b.addEventListener('click', () => {
        ctx.setBackground!(on);
        showToast(`バックグラウンド動作: ${on ? 'オン' : 'オフ'}`);
      });
      row.append(b);
    }
    body.append(row);
    body.append(el('p', { class: 'muted small', text: 'オンにすると PC で他のタブやアプリを使っている間もシミュレーションが進みます（音も鳴ります）。スマホはスリープやアプリ切替で OS に止められるため、戻ったときに追いつき計算（5 分まで）かお留守番レポート（それ以上）になります。既定: PC はオン、タッチ端末はオフ' }));
  }
  if (ctx.setDifficulty) {
    body.append(el('h4', { text: '難易度（いつでも変更できます）' }));
    const cur = ctx.difficulty ?? 'normal';
    const row = el('div', { class: 'settings-row' });
    for (const id of DIFFICULTY_ORDER) {
      const b = el('button', { class: `btn${cur === id ? ' is-active' : ''}`, type: 'button', text: DIFFICULTY[id].name });
      b.addEventListener('click', () => {
        ctx.setDifficulty!(id);
        showToast(`難易度: ${DIFFICULTY[id].name}`);
      });
      row.append(b);
    }
    body.append(row);
    body.append(el('p', { class: 'muted small', text: DIFFICULTY[cur].desc }));
    body.append(el('p', { class: 'muted small', text: '変わるのは受注まわり（客の多さ・溜まったときの受注抑制・遅延の猶予とペナルティ・報酬倍率）だけ。倉庫やロボはそのまま' }));
  }
  body.append(el('h4', { text: 'セーブ' }));
  const saveBtn = el('button', { class: 'btn', type: 'button' }, iconText('save', '今すぐセーブ'));
  saveBtn.addEventListener('click', () => showToast(ctx.saveNow() ? 'セーブしました' : 'セーブできませんでした'));
  body.append(el('div', { class: 'settings-row' }, saveBtn, el('span', { class: 'muted small', text: ctx.lastSavedAt ? `最終セーブ ${new Date(ctx.lastSavedAt).toLocaleTimeString('ja-JP')}（30 秒ごとに自動）` : '30 秒ごとに自動セーブ' })));
  if (ctx.exportSave) {
    const ex = el('button', { class: 'btn', type: 'button' }, iconText('upload', 'ファイルに書き出し'));
    ex.addEventListener('click', () => ctx.exportSave!());
    const im = el('label', { class: 'btn' }, iconText('download', 'ファイルから読み込み'));
    const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) ctx.importSave?.(f);
      input.value = '';
    });
    im.append(input);
    body.append(el('div', { class: 'settings-row' }, ex, im));
  }
  const reset = el('button', { class: 'btn danger', type: 'button' }, iconText('trash-2', '新しく始める'));
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
  const build = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? '';
  body.append(el('p', { class: 'muted small', text: `ビルド: ${build}　デバッグ画面: URL に ?debug を付けて開く` }));
}
