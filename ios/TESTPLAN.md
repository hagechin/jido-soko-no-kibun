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
# OS は Xcode の SDK と同じものを指定する（Xcode 27 なら 27.0。StoreKit テストの都合、下記）
xcodebuild test -project HakoniwaDS.xcodeproj -scheme HakoniwaDS \
  -destination 'platform=iOS Simulator,name=iPhone 17e,OS=27.0' \
  -resultBundlePath build/Test.xcresult 2>&1 | tail -60
```

- `-destination` の `name` は上の一覧にあるものに置き換える（iOS 26 系の端末を 1 つ、できれば iPad も 1 つ）。OS を指定するなら `name=iPhone 17e,OS=26.5` のように
- **StoreKit のテスト（`StoreManagerTests`）は、Xcode の SDK と同じ OS のシミュレータで実行する**（Xcode 27 なら iOS 27.0）。SDK より古い OS（iOS 26.x）では `SKTestSession` が `SKInternalErrorDomain Code=3` で商品を返さず、4 件とも失敗する（第 1・2 回のレポートで確認済み。環境の問題でアプリの不具合ではない）
- UI テストは起動引数 `-resetSave` で起動する（アプリ側が Documents と localStorage のセーブを消して新規開始）。手動確認で使ったシミュレータのセーブに左右されない
- `simctl erase` の直後は `xcrun simctl bootstatus <device> -b` で起動完了を待ってから実行する
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
| M8 | 設定 → 追加機能 → ストア | 商品 4 本と価格（ローカル StoreKit 構成: ¥600 / ¥480 / ¥320 / ¥1,200）が並ぶ。「解放済みの機能」は 4 つとも未解放 |
| M9 | ストアで「サンドボックスモード」を購入（Run はスキームのローカル StoreKit 構成なので課金されない。確認シートで購入） | ボタンが「購入済み」になり「…を購入しました」のトースト。「解放済みの機能」のサンドボックスにチェック。設定の「追加機能」に「サンドボックス画面」が出る |
| M10 | サンドボックス画面で「+1,000」 | コインが増え、HUD に青い `SB` バッジ。アプリを kill → 再起動しても SB バッジが残る（セーブに記録） |
| M11 | 設定 → 新しく始める（iOS の確認ダイアログ「セーブデータを消して最初から始めますか？」で OK）→ ストア → 「購入を復元」 | 新しいゲームになり SB バッジが消える。「購入を復元しました（1 件）」。サンドボックスが解放されたまま（購入はセーブと無関係）。キャンセルを押したときは何も消えない |
| M12 | Edit Scheme → Run → Arguments で `-storeOffline` にチェック → Run → ストア（ローカル StoreKit 構成は商品をファイルから読むので、Wi-Fi を切っても再現しない。この引数が「商品を取れない」状態を作る） | ゲームは普通に遊べる。ストアは「商品を読み込めませんでした…」と再読み込みボタン。チェックを外して Run し直し、再読み込みで 4 本が出る |
| M14 | 上限突破を未購入のまま、サンドボックスで +100,000 コイン → 強化で搬送ロボを 60 台まで買う | 60 台目でボタンが無効になり「上限突破パック（設定 → 追加機能 → ストア）で 120 台まで」の案内 |
| M15 | ストアで「上限突破パック」を購入 → 強化パネル | 上限が 120 台になり、続けて買える。搬送ロボの積載が「4 → 8 ビン」まで上がる。段数は最終ランク（サンドボックスでランク 5）なら 12 まで。建設の面積拡張が 64×48 まで |
| M13 | Xcode の Debug → StoreKit → Manage Transactions で購入を Refund | 数秒以内に「購入状態を反映しました」のトーストが出て、サンドボックス画面の入口が消える |

## 4. 報告のフォーマット

- 実行環境: Xcode のバージョン、シミュレータ名と iOS バージョン（実機なら機種と iOS）
- 自動テスト: SUCCEEDED / FAILED。失敗分はテスト名と最初のアサーションメッセージ、必要なら `build/Test.xcresult` 内のスクリーンショット
- 手動確認: M1〜M7 の OK / NG と、NG の見え方（スクリーンショット歓迎）
- 起動できない・ビルドできないときは、Xcode の赤いエラー全文（最初の 1 件で十分）とログの最後の 30 行
