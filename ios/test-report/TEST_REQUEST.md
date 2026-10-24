# テスト依頼

- round: 39
- status: requested
- branch: release/1.0 （**撮影の対象**。この依頼ファイル・報告・画像は feature/photo-mode に置く。release/1.0 には push しない）
- commit: `release/1.0` の先端 `3405392` 以降（1.0.3 / ビルド 5。すりガラス入り）
- requested-at: 2026-10-25（第 39 回）
- やりとりの約束: `ios/test-report/PROTOCOL.md`。撮り方の基本: `ios/STORE.md` §6（第 22 回と同じ要領）

## 今回のねらい

**App Store 掲載用の iPhone Duo のスクリーンショット**（40 分）。App Store Connect に「iPhone Duo」の枠ができた（外側 1398×2034、内側 2007×2853。いまは任意だが、出すと商品ページに「iPhone Duo に最適化」のバッジが付く。2027 年 4 月から iOS 27.1 SDK のアプリは必須）。Duo シミュレータのスクリーンショットがちょうどそのピクセル数なので、そのまま使える。テストではなく撮影だけ。

## 手順

1. `git fetch origin release/1.0 && git checkout release/1.0 && git pull --ff-only origin release/1.0` → `./ios/sync-web.sh` → `cd ios && xcodegen generate` → Xcode 27.1 でビルド → Duo シミュレータに入れる
2. `xcrun simctl status_bar <udid> override --time 9:41 --batteryState charged --batteryLevel 100 --cellularBars 4 --wifiBars 3`（終わったら `clear`）
3. `simctl launch … -demo` で起動（メガDC）。各画面で原寸のスクリーンショットを数枚ずつ撮り、トースト・ダイアログ・「SB」バッジが写っていないものを選ぶ。外側は `--display=1`、内側は `--display=3`
4. 保存先: `ios/screenshots/store-duo/`。名前は `outer-01-overview.png` / `inner-01-overview.png` のように「面-番号-内容」
5. 報告は feature/photo-mode に: 画像を add し、`TEST_REPORT.md` の末尾に「# 第39回: release/1.0 `<commit>`（Duo のストア用スクリーンショット）」で一覧（番号・内容・ピクセル数）→ status を `reported` → `ios: round-39 store screenshots (iPhone Duo) …` → push

## 撮る画面

**外側（閉じた状態、縦 1398×2034）** — すりガラスの帯が右に写る状態で:

| # | 画面 | 操作 |
|---|---|---|
| 1 | 倉庫の全景（ロボが動いている、注文票が並ぶ） | 起動直後。照準でリセット、2x |
| 2 | 眺めモード（AUTO カメラが寄っている。ミニ HUD だけ） | 下のバーの炎 → 数秒待つ |
| 3 | 強化パネル | 「強化」。可能なら「おすすめ」が出ている状態 |
| 4 | サイバーウィークの赤い帯の全景 | サンドボックス → 「サイバーウィーク本番へ」→ 全景 |
| 5 | コインのメニュー | HUD のコインをタップ（1.0.2 の機能） |

**内側（開いた状態）** — 縦 2007×2853（アプリは縦の配置）と、横 2853×2007（タブレット配置）の両方を 1 枚目だけ。残りは縦で:

| # | 画面 | 操作 |
|---|---|---|
| 1 | 倉庫の全景 | 縦と横の 2 枚 |
| 2 | 眺めモード | 縦 |
| 3 | 強化パネル | 縦 |
| 4 | レイアウトエディタ（赤い印が 1 つ出ている状態でも、無しでも可） | 縦。内側はタップが届かないので、閉じた状態で開いてから開く |
| 5 | サイバーウィーク | 縦 |

内側の画面はタップが届かないので、「閉じた状態で画面を作ってから開く」の手順で可。無理なものは飛ばして報告に書く。

## 報告してほしいこと

- 撮れた画像の一覧（ピクセル数も）と、撮れなかった画面とその理由
