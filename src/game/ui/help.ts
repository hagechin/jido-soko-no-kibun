/** 操作方法の説明（モーダル）とショートカット一覧。ショートカットの実体は main.ts / layoutEditor.ts */
import { el } from './layout';
import { tr } from '../i18n';

export interface ShortcutRow {
  keys: string[];
  what: string;
}

export const GLOBAL_SHORTCUTS: ShortcutRow[] = [
  { keys: ['Space'], what: tr('一時停止 / 再開') },
  { keys: ['[', ']'], what: tr('速度を下げる / 上げる（1x → 2x → 4x）') },
  { keys: ['O'], what: tr('ロボ一覧') },
  { keys: ['B'], what: tr('建設モード') },
  { keys: ['U'], what: tr('強化（アップグレード）') },
  { keys: ['I'], what: tr('在庫') },
  { keys: ['S'], what: tr('設定') },
  { keys: ['N'], what: tr('眺めモード') },
  { keys: ['F'], what: tr('カメラを全体表示に戻す') },
  { keys: ['H', '?'], what: tr('この操作方法') },
  { keys: ['Esc'], what: tr('パネルを閉じる / 選択解除') },
  { keys: ['Space'], what: tr('一時停止 / 再開') },
  { keys: ['[', ']'], what: tr('速度を下げる / 上げる（1x → 2x → 4x）') },
  { keys: ['O'], what: tr('ロボ一覧') },
  { keys: ['B'], what: tr('建設モード') },
  { keys: ['U'], what: tr('強化（アップグレード）') },
  { keys: ['A'], what: tr('実績') },
  { keys: ['I'], what: tr('在庫') },
  { keys: ['S'], what: tr('設定') },
  { keys: ['N'], what: tr('眺めモード') },
  { keys: ['F'], what: tr('カメラを全体表示に戻す') },
  { keys: ['H', '?'], what: tr('この操作方法') },
  { keys: ['Esc'], what: tr('パネルを閉じる / 選択解除') },
];

export const BUILD_SHORTCUTS: ShortcutRow[] = [
  { keys: ['1 〜 7'], what: tr('ツールを選ぶ（スタック・ポート・ピッカー・入荷ST・待機・移動・撤去）') },
  { keys: ['L'], what: tr('レイアウトエディタを開く（倉庫を停止）') },
];

export const EDITOR_SHORTCUTS: ShortcutRow[] = [
  { keys: ['1 〜 8'], what: tr('ツールを選ぶ（選択・手のひら・スタック・ポート・ピッカー・入荷ST・待機・撤去）') },
  { keys: [tr('ドラッグ')], what: tr('選択ツール: 範囲選択。選択した設備の上から: まとめて移動') },
  { keys: ['Delete'], what: tr('選択した設備を撤去') },
  { keys: ['Ctrl+Z', 'Ctrl+Y'], what: tr('元に戻す / やり直す') },
  { keys: ['P'], what: tr('3D プレビューの表示 / 非表示') },
  { keys: [tr('ホイール / ピンチ')], what: tr('ズーム。2 本指・中ボタンでパン') },
  { keys: ['Esc'], what: tr('選択解除') },
];

export const CALM_SHORTCUTS: ShortcutRow[] = [
  { keys: ['M'], what: tr('カメラ AUTO / MANUAL 切替') },
  { keys: ['W A S D', tr('矢印')], what: tr('MANUAL: 前後左右に移動') },
  { keys: ['Q', 'E'], what: tr('MANUAL: 回転') },
  { keys: ['R', 'F'], what: tr('MANUAL: 見下ろし角') },
  { keys: ['Z', 'X'], what: tr('MANUAL: ズーム') },
  { keys: ['Esc'], what: tr('眺めモードを終了（AUTO は画面タップでも）') },
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
    h(tr('基本の流れ')),
    ul(
      tr('オーダー欄の商品をタップすると、その商品がある棚が光り、空いている棚ロボが選ばれます。光った棚をタップすると取り出しに向かいます'),
      tr('棚ロボはビンをポートへ降ろします。搬送ロボをタップしてポートをタップすると、積んでピッカーへ届けます（自動配車AI があれば自動）'),
      tr('ピッカーが商品を取り、オーダーが揃うと出荷。早く出荷するほどボーナスが付きます'),
      tr('入荷トラックの山は、空ビン（または同じ商品の空きのあるビン）を入荷ステーションへ運ぶと詰め込まれます（自動補充AI があれば自動）'),
    ),
    h(tr('カメラ')),
    ul(tr('ドラッグで回転、右ドラッグ・2 本指でパン、ホイール・ピンチでズーム'), tr('右上の照準ボタン（F）で全体表示に戻る')),
    h(tr('画面とショートカット')),
    p(tr('下のバーからパネルを開きます。キーボードでも操作できます（文字入力中は無効）')),
    table(GLOBAL_SHORTCUTS),
    h(tr('建設モード')),
    p(tr('建設中はシミュレーションが止まります。ツールを選んでマスをタップ。移動は設備をタップしてから移動先をタップ。レイアウトエディタでは俯瞰でまとめて配置換えができます')),
    table(BUILD_SHORTCUTS),
    h(tr('レイアウトエディタ')),
    p(tr('倉庫を止め、ロボは持っているビンを棚に戻して外で待機します。スタックは中身ごと動かせます。「保存して出荷を再開」で戻ります')),
    table(EDITOR_SHORTCUTS),
    h(tr('眺めモード')),
    p(tr('UI を隠して倉庫を眺めます。AUTO は自動カメラ、MANUAL はキーボードとドラッグで自由に見られます')),
    table(CALM_SHORTCUTS),
    h(tr('自動化とヒント')),
    ul(tr('自動配車AI Lv1: 搬送ロボが自動でポートのビンを運ぶ / Lv2: 棚ロボがオーダーを見て自動で取り出す / Lv3: 同じ商品のオーダーをまとめる'), tr('自動補充AI: 入荷口の山を自動で棚へ。在庫再配置AI: 人気商品を上段へ'), tr('強化パネルの「おすすめ」とトーストのヒントが、いま効く強化を教えてくれます'), tr('設定の難易度で、客の多さや受注抑制の強さが変わります（いつでも変更可）'), tr('設定の経済モード「ロングラン」はコインが貯まりにくく、ロボや設備が高く、昇格に要る出荷数も多い。しっかり調整して自動化まで約 1 時間、メガDC まで約 6 時間をじっくり遊ぶ向け（難易度と組み合わせ可）'), tr('フォトモード（設定、または P）: カメラを自由に置いて、焦点距離・絞り（ボケ）・シャッター（動きのブレ）・エフェクトを決めて撮影。画面をタップでピント、Enter で撮影、Esc で戻る。撮った写真は保存／共有でき、「起動画面にする」で次の起動から起動画面になる'), tr('特別ロボ（iOS 版の特別ロボパック）: ドローン搬送ロボは棚の上を飛んで渋滞を避け、ポートやステーションの真上に着く（上限 4 台）。ダブルデッカー棚ロボはビンを 2 段持ち、1 個掘れば届くビンを退避なしで取り出す。ドローンは搬送ロボが横付けで順番待ちする大きな倉庫で効き、買い時は「おすすめ」が教えてくれる。ダブルデッカーは序盤から活躍'), tr('ロボ一覧の「運んだ」は各ロボが目的地に下ろしたビンの数。強化パネルの「全ロボを最大強化」で全機の速度・リフト・積載を一気に最大にできる'), tr('倉庫を広げてスタックを増やしたら、強化パネルの「おすすめのビン数まで追加」で空ビンをまとめ買い（棚のスロットの 75% まで。残りは掘り出しの退避先）。「全ロボを最大強化」はコインが足りなくても押せて、安い段階から足りるぶんだけ強化する'), tr('設定の「入荷トラック」で頻度（毎日／週 2／週 1／月 1）と積載量（標準／多め／たっぷり／倉庫いっぱい）を変えられる。頻度はリズムと音の好み（週あたりの量は同じ）。倉庫を広げて空ビンが余っているなら積載量を上げると在庫が増える。「倉庫いっぱい」はビンの 7 割が埋まるまで入荷し続ける'), tr('下部バーの「実績」に金銀銅のアチーブメントと、ため込みすぎ・欠品王などのネガティブ称号。計測はゲーム内の時間（倍速で早くはならない）。総移動距離は 100 km（東京〜山梨）から月までの 384,400 km まで')),
  );
  return root;
}
