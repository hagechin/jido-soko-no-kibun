import { iconText } from './icon';
/** 設定パネル: セーブ・新規開始・画質（書き出し／読み込みは M10、眺めモードの fps は M10） */
import { saveQuality, settingsFor, type QualityLevel } from '../render/quality';
import { DIFFICULTY, DIFFICULTY_ORDER, ECONOMY_MODES, ECONOMY_ORDER, INBOUND_FREQ, INBOUND_FREQ_ORDER, INBOUND_LOAD, INBOUND_LOAD_ORDER, type DifficultyId, type EconomyId, type InboundFreqId, type InboundLoadId } from '../data/balance';
import { el, showToast } from './layout';
import { THEMES, type Skin, type Theme } from './cosmetics';

/** 「最終セーブ」の表示（セーブのたびに main が更新する） */
export function lastSavedText(at: number | null): string {
  return at ? `最終セーブ ${new Date(at).toLocaleTimeString('ja-JP')}（30 秒ごとに自動）` : '30 秒ごとに自動セーブ';
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
  /** iOS アプリ: クリップボード経由の書き出し／読み込み（共有シートが出ないときの逃げ道） */
  copySave?: () => void;
  pasteSave?: () => void;
  lastSavedAt: number | null;
  /** 難易度（受注まわりだけに効く。途中で変更できる） */
  difficulty?: DifficultyId;
  setDifficulty?: (d: DifficultyId) => void;
  /** 経済モード（コインの貯まりやすさと値段。途中で変更できる） */
  economy?: EconomyId;
  setEconomy?: (e: EconomyId) => void;
  /** 入荷トラック（頻度と積載量。途中で変更できる） */
  inbound?: { freq: InboundFreqId; load: InboundLoadId; stockBins: number };
  setInbound?: (next: Partial<{ freq: InboundFreqId; load: InboundLoadId }>) => void;
  /** iOS アプリ: アプリのバージョンと同梱 Web のビルド情報（同梱が古くないかの確認用） */
  buildInfo?: string;
  /** 実績の一覧を描く */
  achievements?: (body: HTMLElement) => void;
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
  /** iCloud 同期（iOS 版のみ） */
  cloud?: { enabled: boolean; available: boolean | null; setEnabled: (on: boolean) => void; checkNow: () => void };
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
  if (ctx.achievements) ctx.achievements(body);
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
  if (ctx.setEconomy) {
    body.append(el('h4', { text: '経済モード（いつでも変更できます）' }));
    const cur = ctx.economy ?? 'standard';
    const row = el('div', { class: 'settings-row' });
    for (const id of ECONOMY_ORDER) {
      const b = el('button', { class: `btn${cur === id ? ' is-active' : ''}`, type: 'button', text: ECONOMY_MODES[id].name });
      b.addEventListener('click', () => {
        ctx.setEconomy!(id);
        showToast(`経済モード: ${ECONOMY_MODES[id].name}`);
      });
      row.append(b);
    }
    body.append(row);
    body.append(el('p', { class: 'muted small', text: ECONOMY_MODES[cur].desc }));
    body.append(el('p', { class: 'muted small', text: '難易度とは別の軸。切り替えた時点から報酬・値段・昇格に要る出荷数が変わる（持っているコインやロボはそのまま）。難易度と組み合わせられる（例: スーパーハード × ロングラン）' }));
  }
  if (ctx.inbound && ctx.setInbound) {
    body.append(el('h4', { text: '入荷トラック（いつでも変更できます）' }));
    const cur = ctx.inbound;
    body.append(el('p', { class: 'muted small', text: '頻度' }));
    const fr = el('div', { class: 'settings-row' });
    for (const id of INBOUND_FREQ_ORDER) {
      const b = el('button', { class: `btn${cur.freq === id ? ' is-active' : ''}`, type: 'button', text: INBOUND_FREQ[id].name });
      b.addEventListener('click', () => {
        ctx.setInbound!({ freq: id });
        showToast(`入荷の頻度: ${INBOUND_FREQ[id].name}`);
      });
      fr.append(b);
    }
    body.append(fr);
    body.append(el('p', { class: 'muted small', text: INBOUND_FREQ[cur.freq].desc }));
    body.append(el('p', { class: 'muted small', text: '積載量' }));
    const lr = el('div', { class: 'settings-row' });
    for (const id of INBOUND_LOAD_ORDER) {
      const b = el('button', { class: `btn${cur.load === id ? ' is-active' : ''}`, type: 'button', text: INBOUND_LOAD[id].name });
      b.addEventListener('click', () => {
        ctx.setInbound!({ load: id });
        showToast(`入荷の積載量: ${INBOUND_LOAD[id].name}`);
      });
      lr.append(b);
    }
    body.append(lr);
    body.append(el('p', { class: 'muted small', text: `${INBOUND_LOAD[cur.load].desc}（いまの在庫の目標: 1 商品につきビン ${cur.stockBins} 杯）` }));
    body.append(el('p', { class: 'muted small', text: '1 回に積む量は頻度の間隔ぶん（月 1 なら 4 週ぶん）なので、頻度を変えても週あたりの入荷量は同じ。倉庫を広げて空ビンが余っているなら積載量を上げると在庫が増える' }));
  }
  if (ctx.openStore || ctx.openSandbox) {
    body.append(el('h4', { text: '追加機能' }));
    const row = el('div', { class: 'settings-row' });
    if (ctx.openSandbox) {
      const sb = el('button', { class: 'btn', type: 'button' }, iconText('box', 'サンドボックス画面'));
      sb.addEventListener('click', () => ctx.openSandbox!());
      row.append(sb);
    }
    if (ctx.openStore) {
      const st = el('button', { class: 'btn', type: 'button' }, iconText('sparkles', 'ストア（特別ロボ・上限突破・サンドボックス）'));
      st.addEventListener('click', () => ctx.openStore!());
      row.append(st);
    }
    body.append(row);
    if (ctx.featureStatus) body.append(ctx.featureStatus());
  }
  if (ctx.cosmetics) {
    const c = ctx.cosmetics;
    body.append(el('h4', { text: '見た目' }));
    if (!c.unlocked) body.append(el('p', { class: 'muted small', text: `金色ロボスキンと倉庫カラーテーマ${c.hint}` }));
    else {
      const skinRow = el('div', { class: 'settings-row' });
      for (const [id, label] of [
        ['standard', '標準'],
        ['gold', '金色'],
      ] as [Skin, string][]) {
        const b = el('button', { class: `btn${c.skin === id ? ' is-active' : ''}`, type: 'button', text: `ロボ: ${label}` });
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
  body.append(el('h4', { text: 'セーブ' }));
  const saveBtn = el('button', { class: 'btn', type: 'button' }, iconText('save', '今すぐセーブ'));
  saveBtn.addEventListener('click', () => showToast(ctx.saveNow() ? 'セーブしました' : 'セーブできませんでした'));
  body.append(el('div', { class: 'settings-row' }, saveBtn, el('span', { class: 'muted small', id: 'last-saved', text: lastSavedText(ctx.lastSavedAt) })));
  if (ctx.buildInfo) body.append(el('p', { class: 'muted small', text: ctx.buildInfo }));
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
    if (ctx.copySave && ctx.pasteSave) {
      const cp = el('button', { class: 'btn', type: 'button' }, iconText('copy', 'クリップボードにコピー'));
      cp.addEventListener('click', () => ctx.copySave!());
      const ps = el('button', { class: 'btn', type: 'button' }, iconText('clipboard', 'クリップボードから読み込み'));
      ps.addEventListener('click', () => ctx.pasteSave!());
      body.append(el('div', { class: 'settings-row' }, cp, ps));
      body.append(el('p', { class: 'muted small', text: '「ファイルに書き出し」は共有シート（ファイルに保存・AirDrop）。シートが出ないときはクリップボード経由で、メモなどに貼り付けて保管できます' }));
    }
  }
  if (ctx.cloud) {
    const c = ctx.cloud;
    const toggle = el('button', { class: `btn${c.enabled ? ' is-active' : ''}`, type: 'button' }, iconText('refresh-cw', c.enabled ? 'iCloud 同期: オン' : 'iCloud 同期: オフ', 14));
    toggle.addEventListener('click', () => c.setEnabled(!c.enabled));
    const check = el('button', { class: 'btn', type: 'button', text: 'iCloud のセーブを確認' });
    if (!c.enabled) check.setAttribute('disabled', 'true');
    check.addEventListener('click', () => c.checkNow());
    const status = c.available === false ? 'iCloud にサインインしていないので同期できません（設定アプリ → Apple アカウント）' : 'セーブを iCloud に置き、別の端末で新しいセーブがあれば起動時に「読み込みますか？」と聞きます。端末のセーブを勝手に上書きはしません';
    body.append(el('div', { class: 'settings-row' }, toggle, check), el('p', { class: 'muted small', text: status }));
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
