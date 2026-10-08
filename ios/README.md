# 箱庭！ディストリビューション iOS

Web 版（`dist/`）を WKWebView で包んだアプリ。仕様は [../SPEC-iOS.md](../SPEC-iOS.md)。

## 必要なもの（Mac）

- Xcode 15 以上
- XcodeGen: `brew install xcodegen`
- Node.js 22（Web 版のビルド用）

## 手順

```sh
# 1. Web 版をビルドして ios/Web に同梱用コピーを作る（dist → ios/Web）
./ios/sync-web.sh

# 2. Xcode プロジェクトを生成（ios/HakoniwaDS.xcodeproj。コミットしない）
cd ios && xcodegen generate && open HakoniwaDS.xcodeproj
```

3. Xcode で Signing & Capabilities の Team を選ぶ（`project.yml` の `DEVELOPMENT_TEAM` に Team ID を書いてもよい）
4. スキーム HakoniwaDS を選んでシミュレータか実機で Run

- 課金のテスト: スキームに `App/Products.storekit`（ローカルの StoreKit 構成）が設定済み。シミュレータでそのまま購入フローを試せる。実機の Sandbox テストは App Store Connect で商品を作ってから
- Web 版を直したら `./ios/sync-web.sh` を再実行して Run

## 構成

```
ios/
  project.yml          XcodeGen の定義（ターゲット・Info.plist・スキーム）
  sync-web.sh          dist → ios/Web（gitignore 対象）
  App/
    HakoniwaDSApp.swift   エントリ（SwiftUI）
    ContentView.swift     WebView を全画面に
    WebView.swift         WKWebView、独自スキーム hakoniwa://app/ で同梱ファイルを配信、JS ブリッジの受け口
    Bridge.swift          JS ↔ Swift のメッセージ処理（save/load/wakeLock/haptic/products/purchase/restore/entitlements）
    StoreManager.swift    StoreKit 2（商品・購入・権利・トランザクション監視）
    SaveStore.swift       Documents/saves へのセーブ保存
    Products.storekit     ローカルの StoreKit 構成（商品 4 本）
    PrivacyInfo.xcprivacy プライバシーマニフェスト（トラッキング無し）
    Assets.xcassets       アプリアイコン
```

## テスト

自動テストと手動確認の手順は [TESTPLAN.md](./TESTPLAN.md)。要約:

```sh
cd ios && xcodebuild test -project HakoniwaDS.xcodeproj -scheme HakoniwaDS -destination 'platform=iOS Simulator,name=iPhone 17e'
```
