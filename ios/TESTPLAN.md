# iOS 版 テスト計画（Mac 側の実行者向け）

前提: リポジトリのルートで `git pull` 済み。Xcode 26 以上、XcodeGen、Node.js 22.12 以上（`nvm use 22`）。

## 1. 準備（Web 版を同梱してプロジェクトを生成）

```sh
./ios/sync-web.sh
cd ios && xcodegen generate
```

## 2. 自動テスト（ユニット + StoreKit + UI）

```sh
cd ios
xcrun simctl list devices available | grep -i iphone   # 使えるシミュレータ名を確認
xcodebuild test -project HakoniwaDS.xcodeproj -scheme HakoniwaDS \
  -destination 'platform=iOS Simulator,name=iPhone 17e' \
  -resultBundlePath build/Test.xcresult 2>&1 | tail -60
```

- `-destination` の `name` は上の一覧にあるものに置き換える（iOS 26 系の端末を 1 つ、できれば iPad も 1 つ）。OS を指定するなら `name=iPhone 17e,OS=26.5` のように
- `StoreManagerTests` だけ失敗して、ログに `[SKTestSession] Error ... SKInternalErrorDomain Code=3` が出る場合は次を試して、どれで通ったかを報告する:
  1. 同じコマンドを Xcode の SDK と同じ OS のシミュレータ（例: iOS 27.0）で実行する
  2. Xcode の GUI で HakoniwaDS スキームを選び ⌘U で実行する
  3. `-only-testing:HakoniwaDSTests/StoreManagerTests` で単独実行する
  - 2 回目の実行時はスキームの Test に StoreKit 構成を付けていない（SKTestSession が自前で構成を読む）。それでも Code=3 なら、`xcrun simctl erase <device>` でシミュレータを初期化してから再実行する
- 結果: 最後に `** TEST SUCCEEDED **` / `** TEST FAILED **`。失敗したテスト名とメッセージを報告する
- テストの中身:
  - `SchemeHandlerTests`: 同梱ファイルの MIME と index.html の解決、Web フォルダが同梱されていること（無ければ sync-web.sh 未実行）
  - `SaveStoreTests`: Documents/saves への保存・読み出し・削除
  - `BridgeTests`: JS へ返す JSON とエスケープ
  - `StoreManagerTests`（StoreKitTest、ローカル構成 Products.storekit）: 商品 4 本の取得、購入でサンドボックス解放と通知、アプリ外の購入の復元、返金で権利が消える
  - `LaunchUITests`: 起動して WKWebView と HUD の日付が出る、オーダーの経過秒が進む（スクリーンショットを添付）

## 3. 手動確認（シミュレータまたは実機で Run）

| # | 操作 | 期待 |
|---|---|---|
| M1 | 起動 | 濃紺の起動画面 → Web 版と同じ画面。ノッチ／ホームバーに HUD・下のバーが重ならない。下のバーの「ロボをタップして選択」が切れない |
| M2 | 回転（横向き） | レイアウトが崩れない。コイン表示・オーダーカード・下のボタンがノッチ側のセーフエリア（左右）に食い込まない。オーダー欄が右に出るのは横幅 900px 以上のとき |
| M3 | 強化パネルでロボを買う → アプリを終了（スワイプで kill）→ 再起動 | ロボ台数が保持されている（Documents 保存）。Xcode のログに `Web folder missing` が無い |
| M4 | 眺めるモード → 設定の「画面を点けっぱなし」オン → 眺めモード | 自動ロックまで待っても画面が消えない（実機で確認） |
| M5 | 出荷が起きる | 軽い振動（実機のみ） |
| M6 | ホームに戻って 30 秒後に復帰 | 「離席中の進行を反映しています」の表示が短く出て再開する（または即再開） |
| M7 | Safari → 開発 → シミュレータ → ページ | Web インスペクタが開き、コンソールに赤いエラーが無い。`__game.world.tick` が増える |

## 4. 報告のフォーマット

- 実行環境: Xcode のバージョン、シミュレータ名と iOS バージョン（実機なら機種と iOS）
- 自動テスト: SUCCEEDED / FAILED。失敗分はテスト名と最初のアサーションメッセージ、必要なら `build/Test.xcresult` 内のスクリーンショット
- 手動確認: M1〜M7 の OK / NG と、NG の見え方（スクリーンショット歓迎）
- 起動できない・ビルドできないときは、Xcode の赤いエラー全文（最初の 1 件で十分）とログの最後の 30 行
