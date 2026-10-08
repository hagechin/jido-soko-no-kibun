# iOS 版 テスト結果（TESTPLAN.md 準拠）

- 実施日: 2026-10-08
- 対象コミット: `4dfe5af`（ブランチ `claude/nifty-feynman-opfzeb`）
- 実施者: Mac 側エージェント（Claude Code / Xcode）

## 実行環境

- Xcode 27.0 (27A266a)、SDK は iPhoneSimulator 27.0
- XcodeGen は Homebrew 版
- Node.js: 既定は v20.9.0。ビルドは nvm の v22.14.0 で実施
- シミュレータ
  - 自動テスト: iPhone 17e (iOS 26.5)、iPad Air 11-inch (M4) (iOS 26.5)
  - 手動確認: iPhone 17e (iOS 26.5) で起動確認。操作が必要な項目は iPhone 17e (iOS 27.0)。Xcode の操作ツールが iOS 27 系の端末しか選べなかったため。

## 結果まとめ

| 項目 | 結果 |
|---|---|
| 準備 (sync-web.sh) | **NG**（Node 20 で失敗。Node 22 なら成功） |
| iOS 26 シミュレータで起動 | **OK**（iPhone 17e / iOS 26.5。白画面なし） |
| 自動テスト | **FAILED**（ビルドエラー。回避すると StoreManagerTests 4件が失敗） |
| M1 起動 | OK（条件付き） |
| M2 回転 | **NG**（横向きで左右のセーフエリアに未対応） |
| M3 保存 | OK |
| M4 画面を点けっぱなし | OK（シミュレータで確認できる範囲） |
| M5 振動 | 未実施（実機のみ） |
| M6 バックグラウンド復帰 | OK（オーバーレイは確認できず） |
| M7 Web インスペクタ | 未実施（下記参照） |

---

## 1. 準備（sync-web.sh）: NG

Node v20.9.0 で `./ios/sync-web.sh` を実行すると、`npm run build` で失敗します。

```
Node.js v20.9.0 is not supported by Astro!
Please upgrade Node.js to a supported version: ">=22.12.0"
```

- `sync-web.sh` のバージョン確認は `"$NODE_MAJOR" -lt 20` なので、Node 20 は通ってしまいます。下限は 22（正確には 22.12）にすべきです。
- `set -e` で止まるため、既存の `ios/Web` は消えずに残ります。気付かないまま古い Web を同梱してしまうおそれがあります。
- Node 22.14.0 で再実行すると成功しました（824K）。そのあと `xcodegen generate` も成功しています。
- `xcodegen generate` で `ios/App/Info.plist` が生成されますが、git では未追跡のままです。

## 2. 自動テスト: FAILED

TESTPLAN どおりのコマンドで実行しました。

```sh
xcodebuild test -project HakoniwaDS.xcodeproj -scheme HakoniwaDS \
  -destination 'platform=iOS Simulator,name=iPhone 17e,OS=26.5' \
  -resultBundlePath build/Test.xcresult
```

### 2-1. ビルドエラー（そのまま実行すると最初にこれで止まる）

```
error: Cannot code sign because the target does not have an Info.plist file and one is not being generated automatically. Apply an Info.plist file to the target using the INFOPLIST_FILE build setting or generate one automatically by setting the GENERATE_INFOPLIST_FILE build setting to YES (recommended). (in target 'HakoniwaDSTests' from project 'HakoniwaDS')
```

- `HakoniwaDSUITests` でも同じエラーが出ます。
- 原因: `project.yml` の `HakoniwaDSTests` と `HakoniwaDSUITests` に `GENERATE_INFOPLIST_FILE: YES` がありません。
- 確認のときは、コマンドに `GENERATE_INFOPLIST_FILE=YES` を付けて回避しました。

### 2-2. コンパイルエラー（2-1 を回避した後）

```
Tests/Unit/StoreManagerTests.swift:48:9: error: expression is 'async' but is not marked with 'await'
48 |         try session.buyProduct(identifier: "jp.hakoniwa.ds.supporter")
   |         |   `- note: call is 'async'
```

- 修正案: `try await session.buyProduct(identifier: "jp.hakoniwa.ds.supporter")`
- 確認のときは一時的にこの修正を入れてテストを実行し、その後元に戻しました。

### 2-3. テスト結果（2-1・2-2 を回避した後。iPhone 17e と iPad Air 11-inch (M4) で同じ結果）

| スイート | 結果 |
|---|---|
| BridgeTests (3) | 全部パス |
| SaveStoreTests (2) | 全部パス |
| SchemeHandlerTests (3) | 全部パス |
| LaunchUITests (2) | 全部パス |
| StoreManagerTests (4) | **4件とも失敗** |

StoreManagerTests の失敗内容:

```
StoreManagerTests.swift:25: testLoadsFourNonConsumables : XCTAssertEqual failed: ("[]") is not equal to ("["jp.hakoniwa.ds.robots", "jp.hakoniwa.ds.limits", "jp.hakoniwa.ds.sandbox", "jp.hakoniwa.ds.supporter"]")
StoreManagerTests.swift:27: testLoadsFourNonConsumables : XCTAssertEqual failed: ("0") is not equal to ("4")
StoreManagerTests.swift:36: testPurchaseUnlocksSandboxAndNotifies : failed: caught error: "productNotFound"
StoreManagerTests.swift:58: testRefundedPurchaseIsRevoked : failed: caught error: "productNotFound"
StoreManagerTests.swift:48: testRestoreFindsTransactionsMadeOutsideTheApp : failed: caught error: "notEntitled"
```

実行中のログ（抜粋）:

```
[SKTestSession] Error saving configuration file: Error Domain=SKInternalErrorDomain Code=3 "(null)"
[SKTestSession] Error clearing overrides: Error Domain=SKInternalErrorDomain Code=3 "(null)"
[SKTestSession] Error setting value to 1 for identifier 2 for jp.hakoniwa.ds: Error Domain=SKInternalErrorDomain Code=3 "(null)"
[SKTestSession] Error deleting all transactions: Error Domain=SKInternalErrorDomain Code=3 "(null)"
```

確認できたこと:

- `Products.storekit` はテストバンドル（`HakoniwaDSTests.xctest/Products.storekit`）に入っています。
- `Products.storekit` の productID 4 本は、`StoreManager.productIDs` と一致しています。
- SKTestSession が構成の保存・設定に失敗（Code=3）しており、`Product.products(for:)` は 0 件を返します。
- 原因は、xcodebuild の CLI から実行したときの環境の問題か、Xcode 27 での挙動かで、まだ特定できていません。Xcode の GUI から Test を実行して同じ結果になるかは未確認です。

## 3. 手動確認

スクリーンショットはこのフォルダにあります。

### M1 起動: OK（条件付き）

- iOS 26.5 でも iOS 27.0 でも、Web 版と同じ画面が出ます（`m1-launch-ios26.5.png`）。
- 縦向き（390×844pt）では、HUD・下部バーともステータスバー、Dynamic Island、ホームインジケータと重なりません。「ロボをタップして選択」も欠けていません。
- 気になった点:
  - 再起動の直後、2〜6 秒ほど真っ暗な画面が続きます。
  - 下部のアイコンボタン 6 個にアクセシビリティラベルがありません（VoiceOver で読み上げられません）。
  - 下部ボタンは中央揃えではなく左寄せになっています。

### M2 回転（横向き）: NG

- 横幅 844pt は 900px 未満なので、オーダー欄は上のままでした（仕様どおり）。レイアウト自体は崩れていません。
- **NG の理由:** 左右のセーフエリアに対応していません。コイン表示、オーダーカード（x≈6pt）、下部ボタン（x≈10pt）が画面の左端ぎりぎりにあり、ノッチのある端末の横向きではノッチに隠れます（`m2-landscape-ios27.png`）。
  - `index.html` は `viewport-fit=cover` を指定していて、`WebView.swift` も `contentInsetAdjustmentBehavior = .never` です。
  - 一方、CSS は `safe-area-inset-top/bottom` しか使っておらず、`safe-area-inset-left/right` がありません。
- 横向きでは 3D ビューの高さが約 146pt しかなく、かなり狭いです。

### M3 保存: OK

- 強化パネル（3 番目の右肩上がりアイコン）で搬送ロボを購入し、1 台→2 台 になりました（コイン 300→50）。
- アプリスイッチャーでスワイプして kill し、再起動しても 2 台・コイン 50 のままでした。
- コンソールに `Web folder missing` はありません。exception もありません。
  - error として出ていたのは、WebKit Media Playback の RBS assertion が entitlement 不足で取得できないというログだけです。シミュレータでよく出るもので、問題ないと考えています。
- アプリスイッチャーに、旧バンドル ID `jp.hatte.hakoniwa.ds` の「箱庭！DS」も残っていました（シミュレータに残った古いビルドで、今回の不具合ではありません）。

### M4 画面を点けっぱなし: OK（シミュレータで確認できる範囲）

- 設定（歯車）の「眺めモード」の欄に「画面を点けっぱなし」があり、オンにできます（`m4-settings-keep-awake-ios27.png`）。
- 眺めモード（6 番目の炎アイコン）にも正常に入れます。
- 自動ロックで画面が消えないかは、実機でないと確認できないため未確認です。

### M5 振動: 未実施

実機でしか確認できません。

### M6 バックグラウンド復帰: OK

- ホームに戻って約 30 秒後に復帰すると、経過分の進行が反映されていました。オーダー #1 の秒数は 260s→324s、日付は第3週→第4週です（`m6-resume-ios27.png`）。
- 「離席中の進行を反映しています」の表示は、復帰直後のキャプチャには写っていません。一瞬で消えたのか、表示されなかったのかは分かりません。
- 復帰後、カメラが大きくズームインした状態になっていました。眺めモードを終了した影響かもしれません。

### M7 Web インスペクタ: 未実施

- Safari の開発メニューは GUI 操作になるため、この環境では自動化できませんでした。
- `WebView.swift` で `webView.isInspectable = true` が設定されていることは確認済みです。
- ゲームのティックが進むことは、間接的に確認できています（LaunchUITests の `testTimeAdvancesWhileRunning` がパスし、M6 でオーダー秒数も進んでいた）。

## 4. その他の表示・動作の気になる点

- 「+6 受注抑制 ×1.1」「+9 受注抑制 ×1.6」のバッジが、オーダーカード #2 の右上の秒数表示に重なって隠しています（`m4-settings-keep-awake-ios27.png`、`m6-resume-ios27.png`）。
- 設定パネルを開いている間に、中身が約 39pt 上下にずれる場面がありました。
- 強化パネルで「空ビン あと 0 個」と出ているのに、15 コインの購入ボタンが押せる状態のままです。

## 5. 修正のお願い（優先度順）

1. `project.yml` のテストターゲット 2 つに `GENERATE_INFOPLIST_FILE: YES` を追加する。
2. `StoreManagerTests.swift:48` の `session.buyProduct` に `await` を付ける。
3. StoreManagerTests が商品 0 件になる（SKTestSession Code=3）原因を調べる。
4. CSS で `safe-area-inset-left/right` に対応する（横向きのノッチ対策）。
5. `sync-web.sh` の Node バージョンの下限を 22 に上げる。
6. 受注抑制バッジとオーダー秒数の重なりを直す。空ビンが上限のときは購入ボタンを無効にする。
