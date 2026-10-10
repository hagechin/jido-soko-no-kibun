# テスト依頼と報告のやりとり（自動化の約束ごと）

開発側（クラウドの Claude Code。以下「開発」）と Mac 側のテスト実行者（Xcode を動かせる Claude Code。以下「テスト」）が、GitHub だけを介して依頼と報告を往復する。人は途中で見守るだけ（承認で止まったら押す）。

## ファイル

| ファイル | 書く側 | 中身 |
|---|---|---|
| `ios/test-report/TEST_REQUEST.md` | 開発 | いまの依頼。先頭のメタ行（round・status・branch・commit）と項目の表。**毎回まるごと書き換える**（過去の依頼は git の履歴） |
| `ios/test-report/TEST_REPORT.md` | テスト | 報告。末尾に「# 第N回: …」の節を**追記**（既存の節は触らない）。スクリーンショット・写真は同じフォルダに `rN-<項目>-<説明>.png|jpg` |
| `ios/TESTPLAN.md` | 開発 | 項目の定義（M1〜、D1〜）。依頼はここの番号で指す |

## 状態（TEST_REQUEST.md の先頭）

```
- round: 24
- status: requested      ← 開発が依頼を書いたら requested、テストが報告を push したら reported
- branch: feature/photo-mode
- commit: この依頼を含むコミット以降の branch の先端（git pull して HEAD を報告に書く）
```

## 流れ（1 ラウンド）

1. **開発**: 直すものを直して push → `TEST_REQUEST.md` を書き換え（round を +1、status: requested）→ コミット `test-request: round N …` → push
2. **テスト**（定期的に `git fetch origin` して見張る）: `TEST_REQUEST.md` の status が `requested` で、round が自分の最後の報告より新しければ
   - `git pull` → `./ios/sync-web.sh` → `cd ios && xcodegen generate` → 依頼の項目を実施
   - `TEST_REPORT.md` の末尾に「# 第N回: <branch> `<commit>`（…）」の節を追記（`TESTPLAN.md` §4 のフォーマット。結果まとめの表 → 項目ごとの詳細 → 気づき）。画像を同じフォルダに置く
   - `TEST_REQUEST.md` の status を `reported` に書き換える
   - コミット `ios: round-N <一言> on <branch> <commit>` → **依頼と同じ branch に push**（push が拒まれたら `git pull --rebase` して再 push）
3. **開発**（定期的に `git fetch origin` して見張る）: `TEST_REQUEST.md` の status が `reported` になっていれば
   - 報告を読み、NG と気づきに対応（直す／仕様として説明する）。`PROGRESS.md` に記録
   - 次の依頼を書いて 1 へ。直すものが無ければ status を `done` にして終わり（「次の依頼は無し」と書く）

## 決めごと

- 依頼と報告は **同じ branch** に積む。開発側が別の branch で作業していても、依頼に書いた branch に push する
- round は通し番号（第 23 回まで release/1.0 で実施済み。第 24 回から feature/photo-mode）
- 報告には必ず「対象コミット」「実行環境」「設定の『セーブ』の下の同梱 Web の commit」を書く（古い Web を同梱したまま試験するのを防ぐ）
- 「できなかった」も報告（シミュレータでは確認できない、ビルドが通らない等）。黙って飛ばさない
- 画像はスクリーンショットは PNG、フォトモードで撮った写真は JPEG のまま（容量のため 1 枚 2 MB 以下）
- 見張りの間隔: 開発側は 1 時間ごとの定期実行（クラウド側の最短）で、変化が無ければ何もしない。テスト側は人の合図（下記）か、CLI なら 15 分おき
- 人への連絡は、依頼／報告のコミットメッセージと `PROGRESS.md` で足りるようにする（チャットで聞かれたら要約する）

## Mac 側の動かし方

Opus は Xcode の中のチャット（エージェント）として動いている。チャットは自分では時計を持たないので、「15 分おきに見張る」という指示は 1 回の返事で終わってしまう（`/loop` のようなスラッシュコマンドも Claude Code CLI のもので、Xcode のチャットには無い）。そこで Mac 側は**ラウンドごとに 1 回、人が合図を貼る**のを基本にする。合図は毎回同じ文でよい:

```
ios/test-report/TEST_REQUEST.md に新しい依頼があります。ios/test-report/PROTOCOL.md の「流れ」2 のとおりに実施して、報告を TEST_REPORT.md に追記し、status を reported にして、依頼と同じ branch に push してください。
```

開発側は依頼を push したら、チャットの返事（と `test-request: round N` のコミット）で人に知らせる。人はその文を Xcode のチャットに貼るだけ。

完全に自動にしたい場合は、Mac の Terminal で Claude Code CLI をリポジトリで起動し、次を貼る（ビルド・自動テスト・`simctl` での起動とスクリーンショットは CLI でもできる。画面を指で操作する項目は Xcode のチャットのほうが得意なので、依頼にその旨を書く）:

```
/loop 15m リポジトリ jido-soko-no-kibun で git fetch origin を実行し、ios/test-report/TEST_REQUEST.md に書かれた branch の先端の同ファイルを読む。status が requested で、round が ios/test-report/TEST_REPORT.md の最後の「第N回」より大きければ、ios/test-report/PROTOCOL.md の「流れ」2 のとおりにテストを実施して報告を追記し、status を reported にして push する。それ以外は何もしない。
```
