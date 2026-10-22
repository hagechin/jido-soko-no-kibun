# テスト依頼

- round: 36
- status: requested
- branch: release/1.1 （**試験の対象**。この依頼ファイルと報告は feature/photo-mode に置く。release/1.1 には push しない）
- commit: `release/1.1` の先端（1.1 / ビルド 6 = 1.1 の内容 + 第 35 回の Duo の直し。直しは release/1.0 の `f511f17` と同じ）
- requested-at: 2026-10-23（第 36 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（M59、M24〜M25d）

## 今回のねらい

**第 35 回の NG の直しの確認（iPhone Duo）と、Duo でのフォトモード**（30 分）。Xcode 27.1 の Duo シミュレータ。対象を release/1.1 にしたのは、フォトモードが 1.1 側にしか無いため（Duo の直しは 1.0.3 と同じ内容）。

## 手順（第 35 回と同じ。ブランチだけ release/1.1）

1. `git fetch origin release/1.1 && git checkout release/1.1 && git pull --ff-only origin release/1.1`
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate` → Xcode 27.1 でビルド。設定の「セーブ」の下が「アプリ 1.1 (6)・同梱 Web commit=<HEAD>」
3. iPhone Duo のシミュレータ 1 台だけ。画像は `r36-*.png`
4. 報告は **feature/photo-mode** に: `git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode` → `TEST_REPORT.md` の末尾に「# 第36回: release/1.1 `<commit>`（iPhone Duo の直し + フォト）」→ status を `reported` → `ios: round-36 … on release/1.1 <commit>` → `git push origin feature/photo-mode`

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | 外側 縦: シートの閉じるボタン | 強化パネル・設定を開く → シートが帯（右の縦のステータスバー）の手前（x ≈ 382）で終わり、右上の × が見えて押せる。画像 |
| 2 | 外側 縦: モーダル | 設定 → 操作方法（または文字の大きさ）→ カードが帯の手前の範囲で中央、× が押せる |
| 3 | 外側 縦: 眺めモードのミニ HUD | 眺める → 下の情報バーが帯の手前の範囲の中央で、右端の × が切れていない |
| 4 | 外側 縦: コインのメニュー | HUD のコインをタップ → メニューが帯の手前で収まる |
| 5 | 内側（951×669、タブレットのレイアウト）: HUD | 「4x」がオーダーの列に食い込まず、速度は 1 つのボタン（例「1x」）、倉庫名は無く、日付のアイコンが ★ の数に重ならない。強化パネルを開くと右のシートが帯の手前（x ≈ 867）で終わる |
| 6 | 内側: フォトモード | 眺める → フォト。チップの列と下のバー（歯車・回す｜歩く・●・×）が帯の手前の範囲に収まり、● が中身の中央。チップをタップして選択肢が出る。● で撮れて「撮れました」が収まる。画像 |
| 7 | フォトモード中の開閉 | 外側でフォトに入る → 開く → 内側でチップとバーが収まり直す → 閉じる → 外側に戻る。固まらない。画像 |
| 8 | 開閉の回帰 | ゲーム中に開く／閉じるで続きが遊べる（第 35 回と同じ） |

実機でしか見られない Split View は今回も不要。

## 報告してほしいこと

- 第 35 回の NG 3 件（1・3・5）が直っているか、フォトモードの Duo での見え方。全部 OK なら「Duo OK」と一言
