# テスト依頼

- round: 35
- status: reported
- branch: release/1.0 （**試験の対象**。この依頼ファイルと報告は feature/photo-mode に置く。第 28〜31 回と同じ手順。release/1.0 には push しない）
- commit: `release/1.0` の先端（1.0.2 のコード + TESTPLAN M59。アプリの表示は 1.0.2 (3)）
- requested-at: 2026-10-22（第 35 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。項目の定義: `ios/TESTPLAN.md`（release/1.0 側の M59）

## 今回のねらい

**iPhone Duo（折りたたみ）での見え方の確認**（45 分）。1.0.3 で Duo 対応を出すための調査。**Xcode 27.1 の iPhone Duo シミュレータ**を使う（Device Hub で開く／閉じる／回転／Split View ができる）。コードの直しはまだ入れていないので、「いまどう見えるか」を姿勢ごとに画像で教えてほしい。

## 手順

1. `git fetch origin release/1.0 && git checkout release/1.0 && git pull --ff-only origin release/1.0`
2. Node 22 で `./ios/sync-web.sh` → `cd ios && xcodegen generate`。**Xcode 27.1 で**ビルド（Settings → Components で iOS 27.1 のランタイムに Update が出ていれば押す）。設定の「セーブ」の下が「アプリ 1.0.2 (3)・同梱 Web commit=<HEAD>」
3. Device Hub で **iPhone Duo** のシミュレータを 1 台だけ起動（ほかのシミュレータは止める。負荷のため）
4. 下の項目を実施（画像は `r35-*.png`。姿勢ごとに画面全体を撮る）
5. 報告は **feature/photo-mode** に: `git checkout feature/photo-mode && git pull --ff-only origin feature/photo-mode` → `TEST_REPORT.md` の末尾に「# 第35回: release/1.0 `<commit>`（iPhone Duo）」を追記 → この `TEST_REQUEST.md` の status を `reported` → `ios: round-35 … on release/1.0 <commit>` でコミット → `git push origin feature/photo-mode`

## 項目

| # | 項目 | 補足 |
|---|---|---|
| 1 | 環境 | Xcode のバージョン（27.1 か）、Duo シミュレータの名前と iOS のバージョン、ビルドに使った SDK。アプリが内側画面で**端まで**広がるか、**右端（ステータスバー側）を避けて**広がるか、**従来サイズのまま中央で周りが余白**か、のどれか |
| 2 | 外側（閉じた状態）縦 | 通常画面（`-demo` 可）。HUD・注文票・下のバーがはみ出していないか。文字やボタンがカメラ／ステータスバーの下に隠れていないか。画像 |
| 3 | 外側 横 | 同上。左右のセーフエリアのぶん内側に寄っているか |
| 4 | 内側（開いた状態）縦 | 同上。縦のステータスバー（右端）の側に、HUD の右端のボタン（一時停止・速度）や下のバーの右端が重なっていないか。注文票の段と 3D の広さ。画像 |
| 5 | 内側 横 | 同上。注文票が上の段に 1 列で出る（スマホのレイアウト）はず。見た目の感想（右の列にしたほうが良さそうか） |
| 6 | ゲーム中の開閉 | 閉じた状態で 30 秒遊ぶ → 開く → 続きが遊べて 3D が画面に合うか（崩れ・固まり・ロボの消失が無いか）→ 閉じる → 同じ。開閉の直後の画像を各 1 枚 |
| 7 | パネル・モーダル中の開閉 | 強化パネルを開いたまま開閉、設定のモーダル（文字の大きさ）を出したまま開閉。パネルが画面に収まり直すか |
| 8 | 眺めモード・フォトモード中の開閉 | 眺める → 開閉。フォト → 開閉（撮影パネル／● の位置が画面の下中央に来るか、比率 3:2 の黒帯が合うか）。画像 |
| 9 | Split View | Device Hub で片側に置く（左右それぞれ）。崩れないか。画像 |
| 10 | 自動テスト（§2） | Xcode 27.1 で SUCCEEDED / FAILED（Duo ではなく iPhone 17e のままで可） |

報告してほしい数値: 可能なら各姿勢の画面のポイント寸法（Device Hub の表示、または画像の大きさ ÷ 倍率）。

## 報告してほしいこと

- 姿勢ごとの画像と、隠れ・はみ出し・崩れの有無。全部問題なければ「Duo OK」と一言。直したほうがよい所は優先度を付けて
