# テスト依頼

- round: 40
- status: requested
- branch: release/1.1 （**試験と撮影の対象**。この依頼ファイル・報告・画像は feature/photo-mode に置く。release/1.1 には push しない）
- commit: `release/1.1` の先端 `ee034e0` 以降（1.1 / ビルド 6）
- requested-at: 2026-11-10（第 40 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。撮り方の基本: `ios/STORE.md` §6（第 22 回・第 39 回と同じ要領）

## 今回のねらい

**1.1 の提出前の最後の確認と、英語のストア用スクリーンショット**（70 分）。1.1 で英語に対応するので、App Store Connect に English のローカライズを足す。その前に iOS 側の英語の抜けを 2 つ直した（A）。あわせて英語の商品ページ用の画像を撮る（B）。1.1 の目玉のフォトモードは日本語の画像にも無いので 1 枚ずつ足す（C）。

直したもの（`ee034e0`）:

- ストア画面（設定 → 追加機能 → ストア）の 4 商品の名前と説明を、StoreKit の表示名ではなくアプリの辞書から出す（アプリの言語に合う。価格は StoreKit のまま）
- `ios/App/en.lproj/InfoPlist.strings` / `ja.lproj/InfoPlist.strings` を追加（ホーム画面の名前 `Hakoniwa! DS`、写真の保存の許可ダイアログの英文）
- `Products.storekit` に `en_US` のローカライズ

## 手順

1. `git fetch origin release/1.1 && git checkout release/1.1 && git pull --ff-only origin release/1.1` → `./ios/sync-web.sh` → `cd ios && xcodegen generate` → Xcode 27.1 でビルド
   - **`xcodegen generate` の後、プロジェクトに `InfoPlist.strings`（ja / en の 2 言語）が入っていること**を最初に確認。入っていなければ（XcodeGen が `.lproj` を拾わなかったら）そこで止めて、その旨を報告（`project.yml` 側を直す）
2. シミュレータは iPhone 17 Pro Max（6.9"、1320×2868）と iPad Pro 13-inch (M4)（2064×2752）。ステータスバーは `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`（終わったら `clear`）
3. A はシミュレータの**端末の言語**を English にして行う（設定 App → General → Language & Region。ホーム画面の名前と許可ダイアログは端末の言語で決まる）。B の撮影は端末の言語が English のまま `simctl launch … -demo`
4. 報告は feature/photo-mode に: 画像を add、`TEST_REPORT.md` の末尾に「# 第40回: release/1.1 `<commit>`（1.1 の英語の確認とストア用スクリーンショット）」→ status を `reported` → `ios: round-40 …` → push

## A. 確認（TESTPLAN M58b、15 分。iPhone だけで可）

| # | 見るところ | 期待 |
|---|---|---|
| A1 | ホーム画面のアプリ名（端末 English） | `Hakoniwa! DS`。途中で切れない（「…」にならない） |
| A2 | 設定 → Extras → Store | 4 商品の名前と説明が英語（Special Robots Pack / Limit Breaker Pack / Sandbox Mode / Supporter Pack）。価格が出る。「Restore Purchases」がある |
| A3 | 1 商品を購入（StoreKit のローカル設定） | Apple の購入確認シートの商品名が英語。購入後のトーストが `Purchased Special Robots Pack` のような英語で、行が「Purchased」になる |
| A4 | アプリの言語だけ日本語に（設定 → Language → 日本語） | ストア画面の 4 商品が日本語に変わる。English に戻すと英語 |
| A5 | フォトモードで初めて「保存」（写真の許可を消してから: `xcrun simctl privacy <udid> reset photos-add jp.hatte.hakoniwa.ds`） | 許可ダイアログの説明が英語（Used to save the photos you take in Photo Mode to your photo library.） |
| A6 | 端末の言語を日本語に戻して起動 | アプリ名「箱庭！DS」、許可ダイアログの説明が日本語、ストア画面が日本語（今までどおり） |
| A7 | 既存の自動テスト（Unit / UI） | 全部通る |

## B. 英語のストア用スクリーンショット（40 分）

保存先 `ios/screenshots/store-en/`。名前は `01-overview-iphone.png` / `01-overview-ipad.png` のように「番号-内容-端末」。端末の言語 English、`-demo`（メガDC）、原寸。トースト・ダイアログ・「SB」バッジ・一時停止の黄色が写っていないものを選ぶ（数枚ずつ撮って選ぶ）。iPhone と iPad の両方で:

| # | 画面 | 操作 |
|---|---|---|
| 1 | 倉庫の全景（ロボが動いている、注文票が並ぶ） | 起動直後。照準でリセット、2x |
| 2 | 眺めモード（AUTO カメラが寄っている。ミニ HUD だけ） | 下のバーの炎 → 数秒待つ |
| 3 | フォトモード（下にチップの列。「Focal length」か「Effect」の選択肢が開いている状態） | 眺めモード → Photo → チップをタップ |
| 4 | フォトモードで歩く視点（棚の間。パネルは最小表示でも可） | Walk に切り替えて棚の通路へ |
| 5 | 強化パネル（Upgrades） | 「Upgrades」 |
| 6 | サイバーウィークの赤い帯の全景 | サンドボックス → サイバーウィーク本番へ → 全景（一時停止していない状態で撮れれば） |
| 7 | 実績（Achievements）の一覧 | 設定から |

## C. 日本語のフォトモードの画像（10 分）

端末の言語を日本語に戻して、B の 3 と 4 を iPhone と iPad で 1 枚ずつ。保存先は `ios/screenshots/store/`、名前は `10-photo-iphone.png` / `10-photo-ipad.png` / `11-photo-walk-iphone.png` / `11-photo-walk-ipad.png`。

## 報告してほしいこと

- A1〜A7 の OK / NG（NG は画像つき）。A1 は名前が切れていないかをホーム画面の画像で
- 撮れた画像の一覧（ピクセル数も）、撮れなかった画面とその理由
- 英語の画面で、文字が切れている・はみ出している・日本語が残っているところがあれば（撮影のついでに気づいた範囲で）
- 「1.1 提出可」かどうかの一言
