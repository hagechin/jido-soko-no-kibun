/** 操作方法の説明（モーダル）とショートカット一覧。ショートカットの実体は main.ts / layoutEditor.ts */
import { el } from './layout';

export interface ShortcutRow {
  keys: string[];
  what: string;
}

export const GLOBAL_SHORTCUTS: ShortcutRow[] = [
  { keys: ['Space'], what: '一時停止 / 再開' },
  { keys: ['[', ']'], what: '速度を下げる / 上げる（1x → 2x → 4x）' },
  { keys: ['O'], what: 'ロボ一覧' },
  { keys: ['B'], what: '建設モード' },
  { keys: ['U'], what: '強化（アップグレード）' },
  { keys: ['I'], what: '在庫' },
  { keys: ['S'], what: '設定' },
  { keys: ['N'], what: '眺めモード' },
  { keys: ['F'], what: 'カメラを全体表示に戻す' },
  { keys: ['H', '?'], what: 'この操作方法' },
  { keys: ['Esc'], what: 'パネルを閉じる / 選択解除' },
];

export const BUILD_SHORTCUTS: ShortcutRow[] = [
  { keys: ['1 〜 7'], what: 'ツールを選ぶ（スタック・ポート・ピッカー・入荷ST・待機・移動・撤去）' },
  { keys: ['L'], what: 'レイアウトエディタを開く（倉庫を停止）' },
];

export const EDITOR_SHORTCUTS: ShortcutRow[] = [
  { keys: ['1 〜 8'], what: 'ツールを選ぶ（選択・手のひら・スタック・ポート・ピッカー・入荷ST・待機・撤去）' },
  { keys: ['ドラッグ'], what: '選択ツール: 範囲選択。選択した設備の上から: まとめて移動' },
  { keys: ['Delete'], what: '選択した設備を撤去' },
  { keys: ['Ctrl+Z', 'Ctrl+Y'], what: '元に戻す / やり直す' },
  { keys: ['P'], what: '3D プレビューの表示 / 非表示' },
  { keys: ['ホイール / ピンチ'], what: 'ズーム。2 本指・中ボタンでパン' },
  { keys: ['Esc'], what: '選択解除' },
];

export const CALM_SHORTCUTS: ShortcutRow[] = [
  { keys: ['M'], what: 'カメラ AUTO / MANUAL 切替' },
  { keys: ['W A S D', '矢印'], what: 'MANUAL: 前後左右に移動' },
  { keys: ['Q', 'E'], what: 'MANUAL: 回転' },
  { keys: ['R', 'F'], what: 'MANUAL: 見下ろし角' },
  { keys: ['Z', 'X'], what: 'MANUAL: ズーム' },
  { keys: ['Esc'], what: '眺めモードを終了（AUTO は画面タップでも）' },
];

function table(rows: ShortcutRow[]): HTMLElement {
  const t = el('table', { class: 'help-table' });
  for (const r of rows) {
    const keys = el('td', { class: 'help-keys' });
    r.keys.forEach((k, i) => {
      if (i) keys.append(document.createTextNode(' / '));
      keys.append(el('kbd', { text: k }));
    });
    t.append(el('tr', {}, keys, el('td', { text: r.what })));
  }
  return t;
}

/** 操作方法のモーダル本文 */
export function helpNode(): HTMLElement {
  const root = el('div', { class: 'help' });
  const h = (t: string) => el('h4', { text: t });
  const p = (t: string) => el('p', { text: t });
  const ul = (...items: string[]) => el('ul', {}, ...items.map((t) => el('li', { text: t })));
  root.append(
    h('基本の流れ'),
    ul(
      'オーダー欄の商品をタップすると、その商品がある棚が光り、空いている棚ロボが選ばれます。光った棚をタップすると取り出しに向かいます',
      '棚ロボはビンをポートへ降ろします。搬送ロボをタップしてポートをタップすると、積んでピッカーへ届けます（自動配車AI があれば自動）',
      'ピッカーが商品を取り、オーダーが揃うと出荷。早く出荷するほどボーナスが付きます',
      '入荷トラックの山は、空ビン（または同じ商品の空きのあるビン）を入荷ステーションへ運ぶと詰め込まれます（自動補充AI があれば自動）',
    ),
    h('カメラ'),
    ul('ドラッグで回転、右ドラッグ・2 本指でパン、ホイール・ピンチでズーム', '右上の照準ボタン（F）で全体表示に戻る'),
    h('画面とショートカット'),
    p('下のバーからパネルを開きます。キーボードでも操作できます（文字入力中は無効）'),
    table(GLOBAL_SHORTCUTS),
    h('建設モード'),
    p('建設中はシミュレーションが止まります。ツールを選んでマスをタップ。移動は設備をタップしてから移動先をタップ。レイアウトエディタでは俯瞰でまとめて配置換えができます'),
    table(BUILD_SHORTCUTS),
    h('レイアウトエディタ'),
    p('倉庫を止め、ロボは持っているビンを棚に戻して外で待機します。スタックは中身ごと動かせます。「保存して出荷を再開」で戻ります'),
    table(EDITOR_SHORTCUTS),
    h('眺めモード'),
    p('UI を隠して倉庫を眺めます。AUTO は自動カメラ、MANUAL はキーボードとドラッグで自由に見られます'),
    table(CALM_SHORTCUTS),
    h('自動化とヒント'),
    ul('自動配車AI Lv1: 搬送ロボが自動でポートのビンを運ぶ / Lv2: 棚ロボがオーダーを見て自動で取り出す / Lv3: 同じ商品のオーダーをまとめる', '自動補充AI: 入荷口の山を自動で棚へ。在庫再配置AI: 人気商品を上段へ', '強化パネルの「おすすめ」とトーストのヒントが、いま効く強化を教えてくれます', '設定の難易度で、客の多さや受注抑制の強さが変わります（いつでも変更可）', '特別ロボ（iOS 版の特別ロボパック）: ドローン搬送ロボは棚の上を飛んで渋滞を避け、ポートやステーションの真上に着く（上限 4 台）。ダブルデッカー棚ロボはビンを 2 段持ち、1 個掘れば届くビンを退避なしで取り出す。ドローンは搬送ロボが横付けで順番待ちする大きな倉庫で効き、買い時は「おすすめ」が教えてくれる。ダブルデッカーは序盤から活躍', 'ロボ一覧の「運んだ」は各ロボが目的地に下ろしたビンの数。強化パネルの「全ロボを最大強化」で全機の速度・リフト・積載を一気に最大にできる'),
  );
  return root;
}
