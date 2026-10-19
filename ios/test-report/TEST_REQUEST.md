# テスト依頼

- round: 31
- status: done
- branch: release/1.0 （**試験の対象**。この依頼ファイルと報告は feature/photo-mode に置く。第 28・29 回と同じ手順）
- commit: `release/1.0` の先端 `c01e53a` 以降（1.0.2 / ビルド 3 のまま。第 30 回の NG の直し）
- requested-at: 2026-10-19（第 31 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（release/1.0 側）

## 今回のねらい

**第 30 回の NG の直しの確認**（15 分）。コインのメニューを HUD の下端から下に出すようにし（ステータスバーに隠れない）、「強化（U）」の右ずれを直し、「特大」で説明文も大きくなるようにしました。第 30 回のそれ以外（M56・M1・M3・自動テスト）はやり直し不要です。

## 手順（第 29 回と同じ）

1. `git fetch origin release/1.0 && git checkout release/1.0 && git pull --ff-only origin release/1.0`
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate`。設定の「セーブ」の下が「アプリ **1.0.2 (3)**・同梱 Web commit=<HEAD>」
3. 下の項目を実施（画像は `r31-*.png`）
4. 報告は **feature/photo-mode** に: `git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode` → `TEST_REPORT.md` の末尾に「# 第31回: release/1.0 `<commit>`（1.0.2 の確認 2）」を追記 → この `TEST_REQUEST.md` の status を `reported` → `ios: round-31 … on release/1.0 <commit>` でコミット → `git push origin feature/photo-mode`。release/1.0 には push しない

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | M55 コインの使い道（標準） | HUD のコインをタップ → メニューの先頭の行「コイン N: 出荷の報酬。何に使う？」が **HUD の下端のすぐ下に、ステータスバーに隠れず読める**。「おすすめ」「建設（B）」「強化（U）」の見出しと説明文の左端がそろっている。選ぶとパネルが開く（第 30 回と同じ） |
| 2 | M52 特大での M55 | 「特大」で 1 と同じ。説明文も大きくなっている（標準の約 1.4 倍）。メニューが画面に収まる。終わったら「標準」に戻す |
| 3 | ビンの取り出しのポップアップ | 棚（スタック）をタップ → 「どのビンを取り出す？」が、これまでどおりタップ位置の上に出る（コインのメニュー以外は変えていない。確認だけ） |

仕様の説明（直していないもの）: 眺めモード中にコインを押すと眺めモードが終わるだけでメニューは出ない（眺めモードは「画面をタップで戻る」が優先。意図どおり）。トーストがメニューに重なるのは一時的なので今回は見送り。気づき 1〜3 は 1.0.2 では見送り（記録済み）

## 報告してほしいこと

- 上の「手順」4 のとおり feature/photo-mode に。全部 OK なら「提出可」と一言
