# テスト依頼

- round: 30
- status: requested
- branch: release/1.0 （**試験の対象**。この依頼ファイルと報告は feature/photo-mode に置く。第 28・29 回と同じ手順）
- commit: `release/1.0` の先端（1.0.2 / ビルド 3）
- requested-at: 2026-10-19
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（release/1.0 側）

## 今回のねらい

**1.0.2 の提出前の軽い確認**（30 分）。1.0.2 = 1.0.1 + コインの使い道のメニュー + チュートリアルの手助け（自動スクロール・置けるマスの表示）。

## 手順（第 29 回と同じ）

1. `git fetch origin release/1.0 && git checkout release/1.0 && git pull --ff-only origin release/1.0`
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate`。設定の「セーブ」の下が「アプリ **1.0.2 (3)**・同梱 Web commit=<HEAD>」
3. 下の項目を実施（画像は `r30-*.png`）
4. 報告は **feature/photo-mode** に: `git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode` → `TEST_REPORT.md` の末尾に「# 第30回: release/1.0 `<commit>`（1.0.2 の確認）」を追記 → この `TEST_REQUEST.md` の status を `reported` → `ios: round-30 … on release/1.0 <commit>` でコミット → `git push origin feature/photo-mode`。release/1.0 には push しない

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | 自動テスト（§2） | SUCCEEDED / FAILED |
| 2 | M55 コインの使い道 | HUD のコインをタップ → メニュー（おすすめ（あれば）・建設・強化）→ 「強化」で強化パネル、「建設」で建設モード。外をタップで閉じる。眺めモード中は出ない |
| 3 | M56 チュートリアルの手助け | 新しく始める → 5/6 まで（飛ばして可）→ 「強化」を開く → 自動化 AI の見出しまでスクロールしている。6/6 → 「建設」 → 置けるマスが緑に光る → 光ったマスに置くと完了へ、光が消える |
| 4 | M1・M3 | 起動、既存のセーブが残る（1.0.1 のセーブの上に入れる） |
| 5 | M52 特大での M55 | 「特大」でコインのメニューが画面に収まる（iPhone 縦） |

## 報告してほしいこと

- 上の「手順」4 のとおり feature/photo-mode に。全部 OK なら「提出可」と一言
