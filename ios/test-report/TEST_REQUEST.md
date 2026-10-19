# テスト依頼

- round: 34
- status: requested
- branch: feature/photo-mode （**試験の対象もこのブランチ**。第 24〜27 回と同じ手順。release/1.0 には触らない）
- commit: `feature/photo-mode` の先端（第 33 回の直し。アプリのバージョン表示は 1.0.2 (3) のまま。同梱 Web の commit で見分ける）
- requested-at: 2026-10-20（第 34 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（このブランチ側）

## 今回のねらい

**第 33 回の NG（チュートリアルの 1 行カード）の直しの確認**（15 分）。パネルが開いている間のカードは、浮かせるのをやめて**パネルの見出しの行の下に差し込む**形にしました。ほかの項目はやり直し不要。

## 手順（第 27 回と同じ）

1. `git fetch origin feature/photo-mode && git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode`
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate`。設定の「セーブ」の下が「アプリ 1.0.2 (3)・同梱 Web commit=<HEAD>」
3. 下の項目を実施（画像は `r34-*.png`）。iPhone 縦のシミュレータ 1 台だけ起動（負荷のため）
4. 報告は同じブランチに: `TEST_REPORT.md` の末尾に「# 第34回: feature/photo-mode `<commit>`（1.1 の直しの確認 2）」を追記 → この `TEST_REQUEST.md` の status を `reported` → `ios: round-34 … on feature/photo-mode <commit>` でコミット → `git push origin feature/photo-mode`

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | M56 チュートリアルの 1 行カード | 新しく始める → 5/6 まで飛ばす → 「強化」を開く。パネルの見出し「アップグレード」の行の**すぐ下に**、黄色い枠の 1 行「💡 自動配車AIを買う ×」が入り、パネルの中身（「ロボの強化…」の見出しなど）に重ならない。そのまま「建設」に切り替えても同じ行が残る。パネルを閉じると、元の大きなカード（画面上部の中央）に戻る。6/6 で「建設」を開いたときも同じ。行の × で終えるとカードが消える（第 33 回まではここで消えなかった）。「特大」でも同じ |
| 2 | M24 一時停止チップ | フォトモードで「倉庫: 動作中 一時停止」を押しても、チップの列がずれない（幅が同じ）。列を右にスクロールすると左端もフェードする |

仕様として説明（直していないもの）: 実績の「· Completed in this warehouse」は意図どおり。ロボ一覧の「Upgrade」が機体の欄までスクロールしないのと、「Cancel」で下のバーに名前が残るのは日本語でも同じ（1.1 の後で検討）。`-demo` 付きの起動で再読み込みのたびにデモに戻るのは起動引数の都合（通常の起動では起きない）

## 報告してほしいこと

- NG と気づき。全部 OK なら「1.1 OK」と一言
