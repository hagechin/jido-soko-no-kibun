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

---

# 再テスト（第4回）: コミット `1dee8ec`（I3: アプリ内ストア）に対して

- 実施日: 2026-10-08
- 対象コミット: `1dee8ec`（`ios/Web/BUILD_INFO`: `commit=1dee8ec`, `node=v22.14.0`）
- 実行環境: Xcode 27.0 (27A266a)、SDK iPhoneSimulator 27.0、**iPhone 17e (iOS 27.0)**
- 手動確認はすべて Xcode の Run で起動して行いました。スキームのローカル StoreKit 構成（`Products.storekit`）が使われるので、実際の課金は発生しません。
- M13 の返金は、Xcode の Debug → StoreKit → Manage Transactions の画面を AppleScript で操作して行いました（ユーザーに補助アクセスを許可してもらった上で実施）。

## 結果まとめ（第4回）

| 項目 | 結果 |
|---|---|
| 準備 (sync-web.sh / xcodegen) | **OK** |
| 自動テスト（iPhone 17e, iOS 27.0） | **TEST SUCCEEDED**（14件すべてパス） |
| M8 ストアの表示 | **OK** |
| M9 サンドボックスモードの購入 | **OK**（購入確認シートは表示されなかった） |
| M10 サンドボックス画面「+1,000」と SB バッジ | **OK** |
| M11 新しく始める → 購入を復元 | **NG**（「新しく始める」が iOS では動かない）。購入の復元自体は OK |
| M12 オフライン | **未実施**（理由は下記） |
| M13 Xcode からの返金 | **OK**（トーストが約 1 秒後に表示され、サンドボックス画面の入口が消えた） |

## 自動テスト（第4回）: TEST SUCCEEDED

| スイート | 結果 |
|---|---|
| BridgeTests (3) / SaveStoreTests (2) / SchemeHandlerTests (3) | 全部パス |
| StoreManagerTests (4) | 全部パス（`testRefundedPurchaseIsRevoked` は 0.298 秒） |
| LaunchUITests (2) | 全部パス |

## 手動確認（第4回）

### M8 ストアの表示: OK（`r4-m8-store-ios27.png`）

設定 → 追加機能 →「ストア（特別ロボ・上限突破・サンドボックス）」から「追加機能ストア」を開きました。商品 4 本と価格はローカル構成どおりです。

| 商品 | 価格 |
|---|---|
| 特別ロボパック（ドローン搬送ロボとダブルデッカー棚ロボ） | ¥600 |
| 上限突破パック（ロボ上限 80/120、積載 Lv4、段数 12、倉庫 64×48） | ¥480 |
| サンドボックスモード（コイン・プリセット倉庫・時間ジャンプ・ロボ MAX・停滞診断） | ¥320 |
| サポーターパック（全部入り ＋ 金色ロボスキン ＋ 倉庫カラーテーマ） | ¥1,200 |

- 「購入を復元」ボタンがあります。
- 「解放済みの機能」は 4 つとも未解放（⊘）でした。
- 表示崩れはありません。

### M9 サンドボックスモードの購入: OK（`r4-m9-purchased-ios27.png`）

- ¥320 をタップすると、ボタンが「✓ 購入済み」に変わって押せない状態になり、トースト「サンドボックスモード を購入しました」が出ました。
- 「解放済みの機能」のサンドボックスにチェックが付き、設定の「追加機能」に「サンドボックス画面」が増えました。
- **注意:** StoreKit の購入確認シートは、2 回購入して 2 回とも表示されず、そのまま購入が完了しました（1 回目は購入完了まで約 100 秒かかった）。ローカル StoreKit 構成のシミュレータの挙動だと思われます。確認シートが出るかは実機または Sandbox 環境で確認が必要です。

### M10 サンドボックス画面「+1,000」と SB バッジ: OK（`r4-m10-sb-badge-after-relaunch-ios27.png`）

- 「+1,000」を押すと、コインが 300 から 1,300 に増え、トースト「+1000 コイン」が出て、HUD に青い `SB` バッジが付きました。
- 「今すぐセーブ」を押さずにアプリを kill して再起動しても、コイン 1,300 と SB バッジは残っていました。

### M11 新しく始める → 購入を復元: NG（`r4-m11-restore-ios27.png`）

- **NG の理由:** 設定の「新しく始める」を押しても、確認ダイアログが出ず、何も起きません（2 回試して同じ）。
  - 該当箇所は `src/game/ui/settings.ts:111` の `if (confirm('セーブデータを消して最初から始めますか？')) ctx.newGame();` です。
  - iOS 側の Swift コードに `WKUIDelegate` が無い（`uiDelegate` も `runJavaScriptConfirmPanelWithMessage` も未実装）ため、WKWebView では `confirm()` が何も表示せずに false を返します。
  - 同じ理由で、次の 2 か所も iOS では動かないはずです。
    - `src/game/ui/debugPanel.ts:71`（サンドボックス画面でプリセット倉庫を読み込む）
    - `src/game/ui/layoutEditor.ts:174`（レイアウトの編集を破棄する）
  - 修正案（どちらか）:
    - `WebView.swift` で `WKUIDelegate` の `runJavaScriptConfirmPanelWithMessage` / `runJavaScriptAlertPanelWithMessage` を実装して `UIAlertController` を出す。
    - Web 側で `confirm()` を使わず、ゲーム内の確認ダイアログにする。
- そのため、「新しく始めた後に SB バッジが消えるか」は確認できていません。
- 「購入を復元」は OK です。トースト「購入を復元しました（1 件）」が出て、サンドボックスは解放されたまま（「購入済み」、チェックあり、「サンドボックス画面」の入口あり）でした。

### M12 オフライン: 未実施

- Mac の Wi-Fi を切ると、テストを実行しているエージェント自身の接続も切れて、オフラインの間は操作も観察もできません。ユーザーと相談のうえ、未実施にしました。
- Network Link Conditioner は、この Mac には入っていません（Additional Tools for Xcode に含まれ、GUI で設定するもの）。
- **Fable 向けの注意:** TESTPLAN の M12 は、Xcode の Run（スキームのローカル StoreKit 構成）で起動する前提になっています。ローカル構成では商品情報を `.storekit` ファイルから読むので、オフラインでも商品が読み込める可能性が高く、「商品を読み込めませんでした…」が出るという期待が成り立たないかもしれません。オフライン時の表示を確かめるには、次のどれかが必要と考えています。
  - StoreKit 構成を外して Run する（Sandbox 環境を使う）。
  - 実機で機内モードにする。
  - デバッグ用に、商品の読み込みを失敗させるフラグを用意する。

### M13 Xcode からの返金: OK（`r4-m13-refund-toast-ios27.png`、`r4-m13-after-refund-settings-ios27.png`、`r4-m13-after-refund-store-ios27.png`）

返金は 2 回行いました。

| 回 | 返金した取引 | 返金したときの画面 | 結果 |
|---|---|---|---|
| 1 回目 | ID 18（12:20:13 の購入） | お留守番レポートが表示中 | トーストは撮れなかった。権利の取り消しは反映された |
| 2 回目 | ID 19（12:38:26 に再購入したもの） | ダイアログもパネルも無いゲーム画面 | **返金の約 1 秒後に「購入状態を反映しました」のトーストが出た**。約 3 秒後には消えていた |

- 返金の後、設定の「追加機能」から「サンドボックス画面」の入口が消え、ストアのサンドボックスモードは ¥320 の購入ボタンに戻り、「解放済みの機能」も未解放（⊘）に戻りました。
- HUD の `SB` バッジは返金後も残ります（セーブデータに残る記録なので、仕様どおりと判断）。
- Xcode の Manage Transactions の画面では、取引が「HakoniwaDS」という名前のアプリの下に出ました（箱庭！DS という名前の項目は 2 つありましたが、どちらも「No Transactions」でした）。そのため Manage Transactions で取引を探すときは、「HakoniwaDS」の項目を選ぶ必要があります。
- トーストは約 2 秒で消えるので、見逃しやすいです。もう少し長く表示してもよいかもしれません（軽微）。

## その他の気になる点（第4回）

1. **HUD が横幅に収まらない**（`r4-hud-overflow-ios27.png`）: SB バッジと受注数が並ぶと、iPhone 17e の縦向き（390pt）で HUD がはみ出します。
   - 受注数「144」が日付アイコンに重なっています。
   - 日付「1年目 6月 第2週」が一時停止ボタンの下に潜っています。
   - 「1x」ボタンが画面の右端で切れています。
2. **設定やストアを開いている間もゲームが止まらない**: テストの間に 4月から 8月まで進み、受注がすべて遅延（赤）、評判は 50 から 0 まで下がりました。仕様かもしれませんが、購入の操作中にもゲームが進む点は確認をお願いします。
3. **サンドボックス画面の「読み込む」ボタンが「読み込 / む」と 2 行に折り返しています。**
4. **デバイス操作のセッションが数分で切れ、そのたびにアプリが終了します**（SIGTERM、`workspace client connection invalidated`）。テスト環境（Xcode）側の問題で、アプリのクラッシュではありません。

## 修正のお願い（第4回、優先度順）

1. `confirm()` が iOS で動かない問題（M11 の NG）を直す。`WKUIDelegate` を実装するか、ゲーム内の確認ダイアログに置き換える。「新しく始める」「プリセット倉庫の読み込み」「レイアウト編集の破棄」の 3 か所が該当します。
2. SB バッジが付いたときに HUD がはみ出す問題を直す（iPhone 17e の縦向き）。
3. M12 の手順を、ローカル StoreKit 構成でもオフラインの表示を確かめられる形に見直す。
4. （確認）設定やストアを開いている間にゲームを一時停止するかどうか。
5. （軽微）「読み込む」ボタンの折り返し、返金トーストの表示時間。
