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

---

# 再テスト（第2回）: 修正コミット `7fde20e` に対して

- 実施日: 2026-10-08
- 対象コミット: `7fde20e`（`ios/Web/BUILD_INFO`: `commit=7fde20e`, `node=v22.14.0`）
- 実行環境: 第1回と同じです（Xcode 27.0 (27A266a)、SDK iPhoneSimulator 27.0）。
- Node: `nvm use 22` は使えませんでした。`~/.npmrc` に `prefix` の設定があり、nvm が拒否するためです。そこで nvm で入れた v22.14.0 を PATH の先頭に置いて実行しました（`nvm use 22` と同じ状態）。

## 結果まとめ（第2回）

| 項目 | 第1回 | 第2回 |
|---|---|---|
| 準備 (sync-web.sh) | NG | **OK**（Node 22.14 で成功。Node 20.9 では「22.12 以上を使ってください」と表示して止まることも確認） |
| ビルド（テストターゲットの Info.plist） | NG | **OK**（`GENERATE_INFOPLIST_FILE=YES` を渡さなくてもビルドできる） |
| コンパイル（`await` 漏れ） | NG | **OK** |
| 自動テスト iOS 26.5（iPhone 17e / iPad Air 11-inch (M4)） | FAILED | **FAILED**（StoreManagerTests 4件が Code=3 で失敗。ほかは全部パス） |
| 自動テスト iOS 27.0（iPhone 17e） | — | **FAILED**（StoreManagerTests のうち返金テスト 1件だけ失敗） |
| iOS 26 シミュレータで起動 | OK | **OK** |
| M1 起動 | OK（条件付き） | **OK**（ボタンが中央揃えになり、ラベルも付いた） |
| M2 回転（ノッチ） | NG | **OK** |
| M3 保存 | OK | 再確認せず（今回は重点項目外） |
| M4 画面を点けっぱなし | OK | 再確認せず |
| M5 振動 | 未実施 | 未実施（実機のみ） |
| M6 復帰後のカメラ | OK（ズームインが残る） | **OK**（ズームインは解消） |
| M7 Web インスペクタ | 未実施 | 未実施 |

## 自動テスト（第2回）

### iOS 26.5（TESTPLAN どおりのコマンド）

iPhone 17e (26.5) と iPad Air 11-inch (M4) (26.5) で、同じ結果になりました。

| スイート | 結果 |
|---|---|
| BridgeTests (3) / SaveStoreTests (2) / SchemeHandlerTests (3) | 全部パス |
| LaunchUITests (2) | iPad: 全部パス。iPhone: `testTimeAdvancesWhileRunning` が失敗（下の「注意」を参照）。シミュレータを初期化した後は全部パス |
| StoreManagerTests (4) | **4件とも失敗**。内容は第1回と同じで、ログに `SKInternalErrorDomain Code=3` が 20 回出る |

```
StoreManagerTests.swift:25: testLoadsFourNonConsumables : XCTAssertEqual failed: ("[]") is not equal to ("["jp.hakoniwa.ds.robots", ...]")
StoreManagerTests.swift:36: testPurchaseUnlocksSandboxAndNotifies : failed: caught error: "productNotFound"
StoreManagerTests.swift:48: testRestoreFindsTransactionsMadeOutsideTheApp : failed: caught error: "notEntitled"
StoreManagerTests.swift:58: testRefundedPurchaseIsRevoked : failed: caught error: "productNotFound"
```

### StoreManagerTests の切り分け（TESTPLAN 2 節の手順 1〜3）

| 手順 | 実行環境 | 結果 |
|---|---|---|
| 1. SDK と同じ OS のシミュレータで同じコマンド | iPhone 17e (iOS 27.0)、xcodebuild | **3件パス / 1件失敗**。Code=3 は 0 回。失敗は `testRefundedPurchaseIsRevoked` |
| 2. Xcode の GUI で ⌘U | iPhone 17e (iOS 27.0)、Xcode のテスト実行 | 手順 1 と同じ（3件パス / `testRefundedPurchaseIsRevoked` が失敗） |
| 3. `-only-testing:HakoniwaDSTests/StoreManagerTests` で単独実行 | iPhone 17e (iOS 26.5)、xcodebuild | **4件とも失敗**（Code=3） |
| 追加: `xcrun simctl erase` で初期化してから全体を再実行 | iPhone 17e (iOS 26.5) | **4件とも失敗**（Code=3）。他のスイートは全部パス |
| 追加: Xcode で返金テストを単独実行 | iPhone 17e (iOS 27.0) | `testRefundedPurchaseIsRevoked` は単独でも失敗。たまたま失敗するのではなく、毎回失敗する |

- Xcode の GUI（手順 2）は、実行先に iOS 27 系のシミュレータしか出ません。そのため iOS 26.5 では ⌘U を試せていません。

**結論**
- Code=3（商品が 0 件になる）は、**Xcode 27 (SDK 27.0) と iOS 26.5 シミュレータの組み合わせで必ず起きます**。CLI と GUI のどちらで実行したか、単独で実行したか、シミュレータを初期化したかは関係ありません。
- **SDK と同じ iOS 27.0 なら、商品の取得・購入・復元は通ります。**
- **iOS 27.0 で残る失敗は 1 件だけ**で、こちらは環境ではなくテストかアプリ側の問題と見られます。

```
StoreManagerTests.swift:63: -[HakoniwaDSTests.StoreManagerTests testRefundedPurchaseIsRevoked] : XCTAssertFalse failed
```

- `session.refundTransaction(identifier:)` の直後に `await store.refreshEntitlements()` を呼んでも、`purchased` に `jp.hakoniwa.ds.limits` が残ったままです。
- `Transaction.currentEntitlements` に、返金がまだ反映されていない（`revocationDate == nil` のまま返ってくる）可能性があります。
- 修正案（どちらか）:
  - 返金のあと、`Transaction.updates` 経由で権利が更新されるのを待つ（期待値付きで数秒ポーリングする）。
  - `refreshEntitlements` で、返金された取引が currentEntitlements からまだ消えていない場合も除外する。

### 注意: `LaunchUITests.testTimeAdvancesWhileRunning` がセーブの状態に左右される

- 失敗箇所: `LaunchUITests.swift:30: XCTAssertTrue failed`（`第1週` の表示を待つ処理）
- 前回の手動確認で使ったシミュレータにはセーブが残っていて、ゲーム内の日付が第1週ではありませんでした。その状態だと失敗します。
- `simctl erase` で初期化した後や、未使用のシミュレータではパスします。
- 修正案（どちらか）:
  - UI テストの起動引数で、セーブを初期化して起動するモードを用意する（例: `-uiTestingReset`）。
  - 「第1週」に頼らず、「年目」を含む日付が出ればよしとする。

### その他（xcodebuild がハングする）

- iOS 27.0 で xcodebuild を実行したとき、全テストが終わって UI テストも `passed` と出たあと、xcodebuild が終了しませんでした。4 分以上待ってから強制終了しています。
- `simctl erase` の直後に実行したときは、`Mach error -308 (ipc/mig) server died` でアプリを起動できずに止まりました。`simctl bootstatus -b` でシミュレータの起動完了を待ってから実行すると問題ありません。
- いずれも環境側の問題と見られます。参考までに書いておきます。

## 手動確認（第2回、M2・M6 を重点に）

- 実行環境: iPhone 17e。iOS 26.5 では起動のみ確認し、操作が必要な項目は iOS 27.0 で行いました。
- 横向きの画面サイズは 844×390pt で、左右のセーフエリアはそれぞれ 47pt です。

### M1 起動: OK

- iOS 26.5 では、シミュレータを初期化した直後の状態で正常に起動しました（`r2-m1-launch-ios26.5.png`）。
- 縦向きでは、HUD は y=48 から始まり、下部ボタンの下端は y=801 です。Dynamic Island やホームインジケータと重なりません。「ロボをタップして選択」も見切れていません。
- 下部の 6 ボタンにラベルが付きました（ロボ一覧 / 建設 / 強化 / 在庫 / 設定 / 眺めモード）。配置も中央揃えになっています（x=55〜335、中心 195）。

### M2 横向きのノッチ: OK（修正を確認）

| 要素 | landscapeLeft | landscapeRight |
|---|---|---|
| 受注抑制バッジ | x=54 | x=54 |
| コイン表示 | x≈55〜73 | x≈55〜73 |
| オーダーカード #1 | x=97 | x=97 |
| 下部ボタン（6 個） | x=282〜562（中央揃え） | 同じ |
| 一時停止 / 速度ボタン | x=696〜791 | x=697〜791 |
| 照準ボタン | x=745〜789 | x=745〜789 |

- 左右どちら向きでも、すべてセーフエリアの内側（x=47〜797）に収まっています（`r2-m2-landscapeLeft-ios27.png`、`r2-m2-landscapeRight-ios27.png`）。修正前は x≈6〜10 でした。
- オーダーカード #5 が右端で切れていますが、横スクロールする行なので想定どおりです。
- 3D ビューの高さは 146pt のままで、倉庫が小さく見えます（第1回と同じで、今回の修正対象外）。

### M6 復帰後のカメラ: OK（修正を確認）

- (a) 通常の構図: 照準でリセットした後、倉庫の床は画面幅の約 44% です（`r2-m6-a-normal-camera-ios27.png`）。
- (b) 眺めモードに入ると拡大されます。× で抜けると (a) と同じ構図に戻りました。
- (c) 通常画面のままホームへ戻り、約 46 秒後に復帰しました（`r2-m6-c-resume-ios27.png`）。
  - **カメラは通常の構図のままで、ズームインしませんでした。**
  - 進行は実時間どおり反映されていました（オーダー秒数は 89s→134s で +45s、日付は 11月第4週→12月第1週）。
  - 「離席中の進行を反映しています」の表示は、復帰直後のキャプチャにも写っていません（即再開と判断）。
- (d) 眺めモードのままホームへ戻り、約 42 秒後に復帰しました（`r2-m6-d-resume-in-calm-ios27.png`）。
  - 眺めモードのまま再開し、× で抜けると通常の構図に戻りました。
  - オーダー秒数は +73s で、実時間の 72 秒と一致しています。

### 第1回で指摘した点の確認

| 指摘 | 結果 |
|---|---|
| 受注抑制バッジが #2 の秒数表示に重なる | **修正済み**。バッジはカード #1 の左（x=7〜48）に移った |
| 空ビン「あと 0 個」でも購入ボタンが押せる | **修正済み**。ボタンが Disabled になった。コインは足りているので、上限による無効化（`r2-upgrades-empty-bin-disabled-ios27.png`） |
| 設定パネルの中身が約 39pt ずれる | **修正済み**。約 26 秒開いたまま 3 回撮影し、要素の位置は 3 回とも同じ |
| 下部ボタンにアクセシビリティラベルが無い・左寄せ | **修正済み** |
| 復帰後にカメラがズームインする | **修正済み**（M6 参照） |
| 横向きでノッチに食い込む | **修正済み**（M2 参照） |

### 新しく気になった点（どれも軽微）

1. **起動直後だけカメラの構図が違う**（`r2-m1-launch-camera-ios27.png`）: 倉庫の床がほぼ画面幅いっぱいに映り、向きも通常と違います。回転させたり照準でリセットしたりすると、通常の構図に戻ります。セーブから再開したとき（お留守番レポートの後）の初期カメラが、通常と違う可能性があります。
2. **眺めモードの下部ピルが左寄り**: x≈10〜294 で、中心が約 152 です（画面の中心は 195）。
3. **同じトーストが 2 枚同時に出る**: 「評判が下がった（オーダーが溜まりすぎ）」が 2 枚同時に表示されていました（`r2-m6-c-resume-ios27.png`）。
4. **「最終セーブ」の時刻が更新されない**: 設定パネルを開いている約 50 秒の間、「最終セーブ 11:11:03」のままでした。30 秒ごとの自動セーブなら少なくとも 1 回は更新されるはずです。表示の更新漏れか、パネルを開いている間は自動セーブが止まっている可能性があります。

## 修正のお願い（第2回、優先度順）

1. `testRefundedPurchaseIsRevoked`: iOS 27.0 で、返金のあとも権利が残る問題（上記の修正案を参照）。
2. StoreKit テストの実行先を TESTPLAN に明記する: Xcode 27 では、iOS 27.0 のシミュレータで実行する。iOS 26.x では Code=3 で動かない。
3. `LaunchUITests.testTimeAdvancesWhileRunning` が、残っているセーブに左右されないようにする。
4. 起動直後のカメラ構図、眺めモードのピルの位置、トーストの重複、「最終セーブ」の時刻（いずれも軽微）。

---

# 再テスト（第3回）: 修正コミット `b6f6d21` に対して

- 実施日: 2026-10-08
- 対象コミット: `b6f6d21`（`ios/Web/BUILD_INFO`: `commit=b6f6d21`, `node=v22.14.0`）
- 実行環境: Xcode 27.0 (27A266a)、SDK iPhoneSimulator 27.0。自動テストと手動確認はどちらも **iPhone 17e (iOS 27.0)** で実施しました。
- Node は第2回と同じく、nvm で入れた v22.14.0 を PATH の先頭に置いて実行しました。

## 結果まとめ（第3回）

| 項目 | 第2回 | 第3回 |
|---|---|---|
| 準備 (sync-web.sh / xcodegen) | OK | **OK** |
| 自動テスト iOS 27.0（iPhone 17e） | FAILED（返金テスト 1件と UI テスト 1件） | **TEST SUCCEEDED**（14件すべてパス） |
| StoreManagerTests (4) | 3件パス / 1件失敗 | **4件ともパス** |
| LaunchUITests (2) | セーブの状態によって失敗 | **2件ともパス**（セーブが残ったシミュレータでもパス） |
| M1 起動直後のカメラ構図 | 照準でリセットした後の構図と違う | **OK**（新規起動・セーブからの起動・お留守番レポートの後、すべて照準リセット後と同じ） |
| 眺めモードのピルの位置 | 左寄り（中心 152 / 画面中心 195） | **OK**（中央に表示） |
| 設定パネルの「最終セーブ」の更新 | 更新されない | **OK**（30 秒ごとに更新される） |
| 同じトーストが 2 枚出る | あり | 今回の観察中は出なかった |

## 自動テスト（第3回）: TEST SUCCEEDED

```sh
xcodebuild test -project HakoniwaDS.xcodeproj -scheme HakoniwaDS \
  -destination 'platform=iOS Simulator,name=iPhone 17e,OS=27.0' \
  -resultBundlePath build/Test.xcresult
```

| スイート | 結果 |
|---|---|
| BridgeTests (3) / SaveStoreTests (2) / SchemeHandlerTests (3) | 全部パス |
| StoreManagerTests (4) | **全部パス**。`testRefundedPurchaseIsRevoked` は 0.307 秒。Code=3 は 0 回 |
| LaunchUITests (2) | **全部パス**（`testLaunchShowsTheWarehouseHud` 8.985 秒、`testTimeAdvancesWhileRunning` 20.580 秒） |

- たまたまパスしたのではないことを確かめるため、Xcode の GUI からも StoreManagerTests と LaunchUITests を再実行しました。6件ともパスしています。
- テストに使ったシミュレータには、手動確認で遊んだセーブ（1年目 12月まで進んだもの）が残っていました。それでも LaunchUITests はパスしたので、`-resetSave` で新規開始できていることも確認できました。
- 第2回で起きた「テストが終わっても xcodebuild が終了しない」現象は、今回は起きませんでした（正常に終了）。
- iOS 26.x では、TESTPLAN に書かれたとおり StoreKit テストを実行していません。

## 手動確認（第3回）

### M1 起動直後のカメラ構図: OK

| 起動のしかた | 起動直後 | 約 3 秒後 | 照準でリセットした後 |
|---|---|---|---|
| 新規起動（`-resetSave` 直後） | 床 x≈0〜390, y≈348〜612 | 同じ | 同じ |
| セーブから起動（15 秒離れた後） | 同じ | 同じ | 同じ |
| お留守番レポートの後（約 5 分半アプリを終了してから起動） | ダイアログの裏から見える構図も同じ。閉じた直後も同じ | 同じ | 同じ |

- スクリーンショット: `r3-m1-fresh-launch-ios27.png`、`r3-m1-fresh-recentered-ios27.png`、`r3-m1-launch-from-save-ios27.png`、`r3-m1-away-report-ios27.png`、`r3-m1-after-away-report-ios27.png`
- どの起動のしかたでも、照準でリセットした後と同じ構図になりました。第2回のように起動のときだけ構図が違う、ということはなくなっています。
- **確認のお願い:** そろった先の構図は、床が画面幅いっぱい（x≈0〜390）に映るものです。第2回で「通常」としていた構図（照準リセット後、床が画面幅の約 44%）とは違います。照準リセットの構図自体が変わったことになるので、これが意図どおりかを確認してください。
- お留守番レポートの内容: 「お留守番の時間: 9分」「出荷: 0 件」「稼いだコイン: 0」「入荷トラック: 5 回」「欠品なし」「季節イベント: 梅雨」。
- 再起動の直後は、WebView が読み込まれるまで 1〜2 秒ほど暗い画面が続きます（第1回から変わらず）。
- お留守番レポートを閉じた直後、閉じるボタンがあった位置に半透明の四角が一瞬残って見えました。3 秒後には消えていたので、閉じるときのフェードの途中を写しただけと判断しています。
- HUD は y=48〜93、下部ボタンは y=756〜801 で、Dynamic Island やホームインジケータと重なりません。「ロボをタップして選択」も見切れていません。

### 眺めモードのピルの位置: OK（修正を確認）

| 向き | ピルの範囲 | ピルの中心 | 画面の中心 |
|---|---|---|---|
| 縦向き | x≈52〜338 | ≈195 | 195 |
| 横向き（landscapeLeft） | x≈279〜565 | ≈422〜424 | 422 |

- スクリーンショット: `r3-calm-pill-portrait-ios27.png`、`r3-calm-pill-landscape-ios27.png`
- 第2回は縦向きで x≈10〜294（中心 152）でした。縦・横とも中央に表示されるようになっています。

### 設定パネルの「最終セーブ」: OK（修正を確認）

設定パネルを開いたまま、時間をおいて表示を読み取りました。

| キャプチャした時刻 | 表示された「最終セーブ」 |
|---|---|
| 11:40:37（開いた直後） | 11:40:13 |
| 11:41:01（+24 秒） | 11:40:43 |
| 11:41:27（+50 秒） | 11:41:13 |
| 11:42:00（+83 秒） | 11:41:43 |

- パネルを開いたままでも、30 秒ごとに表示が更新されています。
- 「今すぐセーブ」を押すと、すぐ「最終セーブ 11:42:06」に変わりました（`r3-settings-last-saved-ios27.png`）。その次の自動セーブは 11:42:13 で、手動でセーブしても 30 秒の周期はリセットされません（不具合ではなく、仕様の確認として記録します）。

### その他

- 同じトーストが 2 枚同時に出ることは、今回の観察中にはありませんでした。
- **軽微:** 設定パネルで「今すぐセーブ」を押したときに出る「セーブしました」のトーストが、設定パネルの裏に隠れて見えません。表示ツリーには `{152,691,86,17}` として存在しています。
- クラッシュはありません。コンソールに出ていたのは WebKit Media Playback の RBS assertion エラー（シミュレータでよく出るもので、問題ないと判断）だけでした。

## 修正のお願い（第3回）

1. （確認）照準でリセットしたときの構図が、床を画面幅いっぱいに映すものに変わっています。これが意図どおりか確認してください。
2. （軽微）設定パネルを開いているときの「セーブしました」トーストを、パネルより手前に表示する。
