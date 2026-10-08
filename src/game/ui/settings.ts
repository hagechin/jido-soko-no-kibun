import { iconText } from './icon';
/** 設定パネル: セーブ・新規開始・画質（書き出し／読み込みは M10、眺めモードの fps は M10） */
import { saveQuality, settingsFor, type QualityLevel } from '../render/quality';
import { DIFFICULTY, DIFFICULTY_ORDER, type DifficultyId } from '../data/balance';
import { el, showToast } from './layout';
import { THEMES, type Skin, type Theme } from './cosmetics';
import type { LocaleSetting } from '../i18n';
import { tr } from '../i18n';

/** 「最終セーブ」の表示（セーブのたびに main が更新する） */
export function lastSavedText(at: number | null): string {
  return at ? tr('最終セーブ {0}（30 秒ごとに自動）', new Date(at).toLocaleTimeString('ja-JP')) : tr('30 秒ごとに自動セーブ');
}

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
  /** 追加機能（iOS 版の買い切り）: ストアを開く／サンドボックス画面を開く（購入済みのときだけ渡される） */
  openStore?: () => void;
  openSandbox?: () => void;
  /** 解放済み機能の一覧 */
  featureStatus?: () => HTMLElement;
  /** 見た目（サポーターパック）: unlocked でなければ案内だけ */
  cosmetics?: { unlocked: boolean; skin: Skin; theme: Theme; setSkin: (s: Skin) => void; setTheme: (t: Theme) => void; hint: string };
  /** 言語（反映は再読み込み後） */
  language?: { setting: LocaleSetting; set: (s: LocaleSetting) => void };
  /** iCloud 同期（iOS 版のみ） */
  cloud?: { enabled: boolean; available: boolean | null; setEnabled: (on: boolean) => void; checkNow: () => void };
}

export function renderSettings(body: HTMLElement, ctx: SettingsContext): void {
  if (ctx.openHelp) {
    const help = el('button', { class: 'btn', type: 'button' }, iconText('info', tr('操作方法とショートカット（H）')));
    help.addEventListener('click', () => ctx.openHelp!());
    body.append(el('div', { class: 'settings-row' }, help));
  }
  if (ctx.setBackground) {
    body.append(el('h4', { text: tr('バックグラウンド動作') }));
    const row = el('div', { class: 'settings-row' });
    for (const [on, label] of [
      [true, tr('オン（他のタブを見ている間も進む）')],
      [false, tr('オフ（戻ったときに追いつく／お留守番）')],
    ] as [boolean, string][]) {
      const b = el('button', { class: `btn${ctx.background === on ? ' is-active' : ''}`, type: 'button', text: label });
      b.addEventListener('click', () => {
        ctx.setBackground!(on);
        showToast(tr('バックグラウンド動作: {0}', on ? tr('オン') : tr('オフ')));
      });
      row.append(b);
    }
    body.append(row);
    body.append(el('p', { class: 'muted small', text: tr('オンにすると PC で他のタブやアプリを使っている間もシミュレーションが進みます（音も鳴ります）。スマホはスリープやアプリ切替で OS に止められるため、戻ったときに追いつき計算（5 分まで）かお留守番レポート（それ以上）になります。既定: PC はオン、タッチ端末はオフ') }));
  }
  if (ctx.setDifficulty) {
    body.append(el('h4', { text: tr('難易度（いつでも変更できます）') }));
    const cur = ctx.difficulty ?? 'normal';
    const row = el('div', { class: 'settings-row' });
    for (const id of DIFFICULTY_ORDER) {
      const b = el('button', { class: `btn${cur === id ? ' is-active' : ''}`, type: 'button', text: DIFFICULTY[id].name });
      b.addEventListener('click', () => {
        ctx.setDifficulty!(id);
        showToast(tr('難易度: {0}', DIFFICULTY[id].name));
      });
      row.append(b);
    }
    body.append(row);
    body.append(el('p', { class: 'muted small', text: DIFFICULTY[cur].desc }));
    body.append(el('p', { class: 'muted small', text: tr('変わるのは受注まわり（客の多さ・溜まったときの受注抑制・遅延の猶予とペナルティ・報酬倍率）だけ。倉庫やロボはそのまま') }));
  }
  if (ctx.openStore || ctx.openSandbox) {
    body.append(el('h4', { text: tr('追加機能') }));
    const row = el('div', { class: 'settings-row' });
    if (ctx.openSandbox) {
      const sb = el('button', { class: 'btn', type: 'button' }, iconText('box', tr('サンドボックス画面')));
      sb.addEventListener('click', () => ctx.openSandbox!());
      row.append(sb);
    }
    if (ctx.openStore) {
      const st = el('button', { class: 'btn', type: 'button' }, iconText('sparkles', tr('ストア（特別ロボ・上限突破・サンドボックス）')));
      st.addEventListener('click', () => ctx.openStore!());
      row.append(st);
    }
    body.append(row);
    if (ctx.featureStatus) body.append(ctx.featureStatus());
  }
  if (ctx.cosmetics) {
    const c = ctx.cosmetics;
    body.append(el('h4', { text: tr('見た目') }));
    if (!c.unlocked) body.append(el('p', { class: 'muted small', text: tr('金色ロボスキンと倉庫カラーテーマ{0}', c.hint) }));
    else {
      const skinRow = el('div', { class: 'settings-row' });
      for (const [id, label] of [
        ['standard', tr('標準')],
        ['gold', tr('金色')],
      ] as [Skin, string][]) {
        const b = el('button', { class: `btn${c.skin === id ? ' is-active' : ''}`, type: 'button', text: tr('ロボ: {0}', label) });
        b.addEventListener('click', () => c.setSkin(id));
        skinRow.append(b);
      }
      body.append(skinRow);
      const themeRow = el('div', { class: 'settings-row' });
      for (const t of THEMES) {
        const b = el('button', { class: `btn${c.theme === t.id ? ' is-active' : ''}`, type: 'button', text: t.name, title: t.desc });
        b.addEventListener('click', () => c.setTheme(t.id));
        themeRow.append(b);
      }
      body.append(themeRow);
      body.append(el('p', { class: 'muted small', text: THEMES.find((t) => t.id === c.theme)?.desc ?? '' }));
    }
  }
  if (ctx.language) {
    const lg = ctx.language;
    body.append(el('h4', { text: tr('言語') }));
    const row = el('div', { class: 'settings-row' });
    for (const [id, label] of [
      ['auto', tr('自動（端末の設定）')],
      ['ja', '日本語'],
      ['en', 'English'],
    ] as [LocaleSetting, string][]) {
      const b = el('button', { class: `btn${lg.setting === id ? ' is-active' : ''}`, type: 'button', text: label });
      b.addEventListener('click', () => lg.set(id));
      row.append(b);
    }
    body.append(row, el('p', { class: 'muted small', text: tr('変更すると再読み込みします（セーブは保たれます）') }));
  }
  body.append(el('h4', { text: tr('セーブ') }));
  const saveBtn = el('button', { class: 'btn', type: 'button' }, iconText('save', tr('今すぐセーブ')));
  saveBtn.addEventListener('click', () => showToast(ctx.saveNow() ? tr('セーブしました') : tr('セーブできませんでした')));
  body.append(el('div', { class: 'settings-row' }, saveBtn, el('span', { class: 'muted small', id: 'last-saved', text: lastSavedText(ctx.lastSavedAt) })));
  if (ctx.exportSave) {
    const ex = el('button', { class: 'btn', type: 'button' }, iconText('upload', tr('ファイルに書き出し')));
    ex.addEventListener('click', () => ctx.exportSave!());
    const im = el('label', { class: 'btn' }, iconText('download', tr('ファイルから読み込み')));
    const input = el('input', { type: 'file', accept: 'application/json,.json', hidden: true });
    input.addEventListener('change', () => {
      const f = input.files?.[0];
      if (f) ctx.importSave?.(f);
      input.value = '';
    });
    im.append(input);
    body.append(el('div', { class: 'settings-row' }, ex, im));
  }
  if (ctx.cloud) {
    const c = ctx.cloud;
    const toggle = el('button', { class: `btn${c.enabled ? ' is-active' : ''}`, type: 'button' }, iconText('refresh-cw', c.enabled ? tr('iCloud 同期: オン') : tr('iCloud 同期: オフ'), 14));
    toggle.addEventListener('click', () => c.setEnabled(!c.enabled));
    const check = el('button', { class: 'btn', type: 'button', text: tr('iCloud のセーブを確認') });
    if (!c.enabled) check.setAttribute('disabled', 'true');
    check.addEventListener('click', () => c.checkNow());
    const status = c.available === false ? tr('iCloud にサインインしていないので同期できません（設定アプリ → Apple アカウント）') : tr('セーブを iCloud に置き、別の端末で新しいセーブがあれば起動時に「読み込みますか？」と聞きます。端末のセーブを勝手に上書きはしません');
    body.append(el('div', { class: 'settings-row' }, toggle, check), el('p', { class: 'muted small', text: status }));
  }
  const reset = el('button', { class: 'btn danger', type: 'button' }, iconText('trash-2', tr('新しく始める')));
  reset.addEventListener('click', () => {
    if (confirm(tr('セーブデータを消して最初から始めますか？'))) ctx.newGame();
  });
  body.append(el('div', { class: 'settings-row' }, reset));

  body.append(el('h4', { text: tr('画質') }));
  const qRow = el('div', { class: 'settings-row' });
  for (const q of ['high', 'low'] as QualityLevel[]) {
    const b = el('button', { class: `btn${ctx.quality === q ? ' is-active' : ''}`, type: 'button', text: q === 'high' ? tr('高（影あり）') : tr('低（影なし・軽い）') });
    b.addEventListener('click', () => {
      saveQuality(q);
      ctx.setQuality(q);
      showToast(tr('画質: {0}', q === 'high' ? tr('高') : tr('低')));
    });
    qRow.append(b);
  }
  body.append(qRow);
  body.append(el('p', { class: 'muted small', text: tr('端末の自動判定: {0}x 描画', settingsFor(ctx.quality).pixelRatio.toFixed(1)) }));
  ctx.extra?.(body);
  const build = document.querySelector('meta[name="build"]')?.getAttribute('content') ?? '';
  body.append(el('p', { class: 'muted small', text: tr('ビルド: {0}　デバッグ画面: URL に ?debug を付けて開く', build) }));
}
