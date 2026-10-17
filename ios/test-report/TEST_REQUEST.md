# テスト依頼

- round: 28
- status: reported
- branch: release/1.0 （**試験の対象**。この依頼ファイルと報告は feature/photo-mode に置く。下の「手順」のとおり）
- commit: `release/1.0` の先端（`dfe14ed` 以降）
- requested-at: 2026-10-17
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（**release/1.0 側の TESTPLAN.md** に M51〜M53 がある）

## 今回のねらい

**1.0.1 の提出前の軽い回帰**。1.0.1 = 1.0 + ビンの行方不明の修正 + 文字の大きさ（小〜特大）+ チュートリアル（6 段）。実機は不要（シミュレータで可）。1 時間以内で。

## 手順（このラウンドだけ特別: 対象が release/1.0）

1. `git fetch origin release/1.0 && git checkout release/1.0 && git pull --ff-only origin release/1.0`（HEAD が `dfe14ed` 以降）
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate`。設定の「セーブ」の下が「アプリ **1.0.1 (2)**・同梱 Web commit=<HEAD>」であること
3. 下の項目を実施（スクリーンショットは `r28-*.png`）
4. **報告は feature/photo-mode に push する**: `git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode` → `ios/test-report/TEST_REPORT.md` の末尾に「# 第28回: release/1.0 `<commit>`（1.0.1 の回帰）」を追記、画像を同じフォルダへ、この `TEST_REQUEST.md` の status を `reported` に → `ios: round-28 1.0.1 regression on release/1.0 <commit>` でコミット → `git push origin feature/photo-mode`。release/1.0 には何も push しない

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | 自動テスト（§2） | `xcodebuild test`。SUCCEEDED / FAILED と失敗分 |
| 2 | M1 起動・M3 保存 | いつもどおり。既存のセーブ（前のビルドで作ったもの）が残っていること |
| 3 | M52 文字の大きさ | セーブとアプリのデータを消して起動 → 「文字の大きさ」のモーダルが出る → 「特大」→ HUD・オーダー・下のバー・設定パネル・トーストが大きくなる。下のバーの 7 ボタンが切れない（iPhone 縦）。設定 → 文字の大きさで「小」「大」も見る。各サイズで 1 枚ずつスクリーンショット。再起動で保たれ、モーダルは二度と出ない。iPad でも「特大」を 1 枚 |
| 4 | M53 チュートリアル | 設定 → 新しく始める → 1/6 のカードとオーダー欄の点滅 → 実際に操作して 6/6 まで進める（オーダー商品タップ → 棚タップ → 搬送ロボ → ポート → 出荷を待つ → 強化で自動配車AI Lv1（コインが足りなければ出荷を重ねる）→ 建設でスタック）→「完了」。各段でカードの文が合っているか、達成で自動的に次へ進むか。「この手順を飛ばす」「×」「チュートリアルをもう一度」も。チュートリアル中に「おすすめ」のトーストが出ないこと |
| 5 | M51 行方不明のビンの回復 | `src/game/sim/fixtures/orphan-tshirt-save.json` を「ファイルから読み込み」→「行方不明だったビン 2 個を棚に戻しました」→ 3 分で出荷再開 |
| 6 | M44 回帰 | 90 秒放置 → 「眺めモードにする？」 |

## 報告してほしいこと

- 上の「手順」4 のとおり feature/photo-mode に。NG と、文字の大きさ・チュートリアルの文言や配置の気になった点
