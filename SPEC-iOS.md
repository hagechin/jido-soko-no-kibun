# 箱庭！ディストリビューション iOS 版 仕様

Web 版（[SPEC.md](./SPEC.md)）を WKWebView で包み、iOS 版だけの機能と買い切り課金を載せる。開発は Web 版と同じリポジトリの `ios/` で行う。

## 0. 方針

- **同梱配信**: `npm run build` の `dist/` をアプリに同梱し、独自スキーム `hakoniwa://app/` で配信する（`file://` は絶対パスと localStorage の扱いが不安定なため）。初回起動後もネットワークは使わない
- **薄いネイティブ層**: 依存ライブラリ無し。SwiftUI + WKWebView + StoreKit 2 を数百行で。Xcode プロジェクトは XcodeGen（`ios/project.yml`）から生成し、`.xcodeproj` はコミットしない
- **Web 版を止めない**: JS 側に「プラットフォーム層」（`src/game/platform/`）を 1 枚置き、ネイティブがあればブリッジ経由、無ければ従来どおり動く。機能解放は `hasFeature()` で判定する
- **審査対策**: Web をそのまま包んだだけにしない（iOS 限定機能を持つ）。機能解放は必ず Apple の IAP（非消耗型）。トラッキング無し、外部通信無し

## 1. iOS 限定機能と商品（IAP: 非消耗型・買い切り・ファミリー共有あり）

| 商品 ID | 名前 | 内容 | 価格の目安 |
|---|---|---|---|
| `jp.hatte.hakoniwa.ds.robots` | 特別ロボパック | ドローン搬送ロボ（大きな倉庫向け）、ダブルデッカー棚ロボ（序盤から活躍） | ¥600 |
| `jp.hatte.hakoniwa.ds.limits` | 上限突破パック | ロボ上限 40/60 → 80/120、積載 Lv4（8 ビン）、段数 8 → 12、倉庫 40×28 → 64×48 | ¥500 |
| `jp.hatte.hakoniwa.ds.sandbox` | サンドボックスモード | デバッグ画面を正式機能として解放（コイン、プリセット倉庫、時間ジャンプ、ロボ MAX、停滞診断） | ¥500 |
| `jp.hatte.hakoniwa.ds.supporter` | サポーターパック | 上の 3 つ全部 ＋ 金色ロボスキン ＋ 倉庫カラーテーマ | ¥1,200 |

機能フラグ（JS 側 `hasFeature`）: `specialRobots` / `limits` / `sandbox` / `cosmetics`。サポーターパックは全部を含む。

### 特別ロボ

- **ドローン搬送ロボ**: 空中レイヤーを使う搬送ロボ。棚の上を飛び越えて移動し、地上の渋滞に巻き込まれない。ポート／ステーションへは上から横付けするので「横付けできる台数」の制限を受けない。台数上限 4。経路計画は第 3 の予約表（air）で、通行可能 = 範囲内の全マス
- **ダブルデッカー棚ロボ**: ビンを 2 段持てる棚ロボ。目的ビンの上に 1 個だけ載っているなら、それを持ち上げたまま目的ビンも取り、退避先への往復をしない（上のビンは目的ビンをポートに置いた後、元のスタックへ戻す）
- どちらもショップで購入する（コイン）。購入ボタンは `specialRobots` が無いとロック表示（ストアへ誘導）
- 実装（I5）:
  - `Robot.variant?: 'standard' | 'drone' | 'double'`（省略は標準。古いセーブはそのまま読める）。ドローンは `kind: 'amr'`、ダブルデッカーは `kind: 'shelf'` のまま。仕事（fetch / deliver / return、retrieve / store / relocate）と自動化はそのまま使える
  - `sim/layers.ts`: `layerOf(r)` = floor / rail / air。衝突回避・予約表（`Runtime.air` を追加）・重なり判定・レイアウトエディタの配置は kind ではなく層で分ける。ドローンの通行可能 = 範囲内の全マス（`passableFor`）
  - ドローンはポート／ステーションの **マスの真上** に着く（`dockGoal`）。横付けの枠（`headingTo` / `approachCapacity`）には数えず、順番待ち（staged）もしない。退避（待機スポットへ）もしない。建設の邪魔にもならない。上限 `ROBOT.maxDrones = 4`、価格 900、搬送ロボの上限とは別枠
  - ★ ダブルデッカーの「上のビンを戻す」は、ポートに置いた後ではなく **その場で**（目的ビンを持ち上げた直後に元のスタックへ下ろす）に変更。仕様案より持ち上げ 1 回少なく、ポートから戻る移動も要らない。在庫の位置も変わらない。深さ 2 以上の掘り出しは 2 個ずつ退避して往復を半分に（retrieve のステップ 14〜16、11 の繰り返し、13 → 12）。価格 650、棚ロボの上限に含む
  - 描画: ドローンは棚ロボの 1.1 上の空中（本体・4 本の腕・ローター、ビンは下にぶら下げ）、タップ判定は空中の平面。ダブルデッカーは橙色の本体に四隅の支柱

### 上限突破

- `ROBOT.maxShelfRobots / maxAmrs`、`ROBOT.cargo`（Lv4 追加）、`LEVELS.max`、`GRID.maxWidth / maxHeight` を、`limits` があるとき拡張値に差し替える（`limitsFor(w)` で参照）
- 実装（I4）: `balance.ts` の `LIMITS = { base, expanded }`（台数 40/60 → 80/120、積載 Lv 添字 2 → 3（8 ビン、費用 1,800）、段数 8 → 12（9〜12 段の費用 16,000 / 25,000 / 40,000 / 60,000）、倉庫 40×28 → 64×48）。`sim/limits.ts` の `setLimitsExpanded()` を main が購入状態から切り替え、sim は `limitsFor(w)` だけを見る。段数はランクの解放を超えないが、最終ランクでは上限突破の 12 段まで
- 上限突破を持たない環境でそれを超えたセーブを開いたら（Web 版へ書き出した等）: 既存のロボや段数はそのまま使え、追加だけ止まる
- 強化パネルは上限に達したとき「上限突破パック（設定 → 追加機能 → ストア）で 120 台まで」のように案内（持っていれば出ない）

### サンドボックス

- `?debug` と同じ画面を設定パネルから開ける。セーブには `flags.sandboxUsed` を立て、HUD に「サンドボックス」バッジを出す（記録の区別用）
- 実装（I3）: デバッグ画面は常に登録し、下部バーのボタンは `?debug` のときだけ。`sandbox` があると設定の「追加機能」に「サンドボックス画面」が出る。画面のボタンを押した時点で `flags.sandboxUsed = true`（`?debug` の開発用途では付けない）。HUD は `SB` バッジ

### ストア画面（I3）

- 設定 → 追加機能 → 「ストア」。`ui/store.ts`。商品はネイティブの `products` から（60 秒待つ）。取れなければ「商品を読み込めませんでした。オンラインのときに再読み込み」＋再読み込みボタン。ゲーム本体はオフラインで動く
- 購入は `purchase`（10 分待つ: OS の購入シートをユーザーが操作する）。`purchased` → 即 `setOwnedProducts` して反映、`pending`（ファミリーの承認待ちなど）→ 後で `entitlements` イベントが来たときに反映、`cancelled` → トースト
- 「購入を復元」は `restore`（`AppStore.sync`）。復元件数をトースト
- 解放済み機能の一覧（4 項目のチェック）を設定とストアに表示
- Web 版は同じ画面に商品の案内だけ（購入ボタン無し）。`is-native` でない環境では購入できない旨を表示

### 見た目（サポーター）

- 金色のロボスキン（render の色差し替え）と倉庫カラーテーマ（CSS 変数の差し替え）。設定で切替
- 実装（I6）: `ui/cosmetics.ts`（localStorage `jido-soko-no-kibun:cosmetics`）。スキン: 標準／金色（`WarehouseRenderer.setSkin`、全ロボを金色にし種類は明るさで区別）。テーマ: 標準／ミッドナイト／サンド（`html[data-theme]` で CSS 変数を差し替え、3D ビューの背景と霧の色も合わせる）。`cosmetics` が無ければ標準に戻る（返金）。設定の「見た目」セクション（未購入は案内のみ）

## 1.5 フォトモード（Web 版にもある。feature/photo-mode）

- 入口: 設定の「フォトモードを開く」、ショートカット P。HUD を隠し、下に撮影パネル。カメラは眺めモード MANUAL と同じ操作（ドラッグ・ピンチ、WASD / Q E / R F / Z X）。画面タップでピント（視線の先の物までの距離）、Enter で撮影、Space で一時停止、Esc で戻る（視点は元に戻す）
- パラメータ（`render/photo.ts`、localStorage に保存）: 焦点距離 24/35/50/85/135mm（35mm 換算、縦の画角に変換）、絞り F1.4〜F16（BokehPass の被写界深度）、シャッター 1/250〜1/8（ゲーム内時間。動作中のロボの補間 alpha を少しずつ進めた 4〜16 コマを重ねるモーションブラー。シミュレーションは進めない）、エフェクト なし／フィルム／モノクロ／セピア／ビビッド／夕暮れ（色調シェーダ＋ FilmPass の粒子）、比率 画面／3:2／16:9／4:5／1:1（プレビューは黒帯、撮影は実寸）
- 撮影: 長辺 2400px の JPEG。モーダルで「保存／共有」（iOS は `sharePhoto` → 共有シート、Web はダウンロード）、「起動画面にする」（長辺 1600px に縮めて localStorage `jido-soko-no-kibun:startup-photo` と、iOS では `save` で Documents にも）
- 起動画面: index.astro のインラインスクリプトが localStorage の写真を `--startup-photo` に入れ、HTML のスプラッシュの背景にする。iOS は `ContentView` が Documents の同じ写真を WebView の上に重ね、JS の `ready`（最初の描画後）で消す。これで起動直後から写真が出る
- 後処理は three の examples/jsm（同梱）だけで、CDN や追加依存は無し

## 1.6 多言語対応（feature/i18n）

- gettext 方式: 日本語の文字列そのものをキーに `tr('現在 {0} 台', n)`。英語は `i18n/en.ts` の辞書（約 690 件）、無ければ日本語のまま。`scripts/wrap-strings.mjs` が日本語リテラルを `tr()` で包み、`--check --list` で未訳キーを出す
- 言語は起動時に決める（設定 `jido-soko-no-kibun:locale`、無ければ端末の言語。日本語以外は英語）。モジュール読み込み時の `tr()`（商品名・ランク名・イベント名などの定数）も正しい言語になるので、切替は再読み込みで反映（設定 → 言語 → 自動／日本語／English）
- 静的な HTML（index.astro）は起動時に `translateStaticDom()` が文字ノードと title / aria-label を辞書で置き換える。`<title>`・説明・`lang` も
- 日付: 英語は月を略称（Year 1 · Apr W1 / Y1 Apr W1）。数値の桁区切りは共通
- ★ ロボの名前（「棚ロボ 3」）はセーブに入っているので、作ったときの言語のまま残る（切替後に作ったロボから新しい言語）
- iOS: `CFBundleLocalizations` に ja / en。App Store の英語の説明文は `STORE.md`

## 2. ブリッジ（JS ↔ Swift）

JS → Swift: `window.webkit.messageHandlers.native.postMessage({ id, method, params })`
Swift → JS: `window.__native.reply(id, { ok, result | error })` / `window.__native.emit(event, payload)`

| method | params | result | 用途 |
|---|---|---|---|
| `ping` | – | `{ platform: 'ios', version, build }` | 起動確認 |
| `save` | `{ key, data }` | `true` | セーブをアプリの Documents に保存（localStorage は鏡） |
| `load` | `{ key }` | `string \| null` | 起動時に読み込み |
| `delete` | `{ key }` | `true` | 新しく始める |
| `wakeLock` | `{ on }` | `true` | 眺めモードの画面点けっぱなし（`isIdleTimerDisabled`） |
| `haptic` | `{ kind: 'light' \| 'success' \| 'warning' }` | `true` | 出荷・昇格・警告の触覚 |
| `shareFile` | `{ name, text }` | `true`（シートを閉じたら） | セーブの書き出し。一時ファイルに書いて共有シート（「ファイルに保存」「AirDrop」など）を出す。WKWebView は `blob:` の `<a download>` を扱えない（外部遷移をキャンセルしている）ため |
| `products` | – | `[{ id, title, description, price, purchased }]` | ストア画面 |
| `purchase` | `{ id }` | `{ state: 'purchased' \| 'pending' \| 'cancelled' }` | 購入 |
| `restore` | – | `{ ids }` | 購入の復元 |
| `entitlements` | – | `{ ids }` | 起動時と変化時（`emit('entitlements')`） |

イベント: `entitlements`（購入状態が変わった）、`foreground` / `background`（アプリの前面／背面）

## 3. セーブ

- 本体: `Documents/saves/<key>.json`（アトミック書き込み）。localStorage は従来どおり書くが、起動時はネイティブの保存を優先して localStorage に流し込む
- 書き出し／読み込み（ファイル）は Web 版と同じ JSON。書き出しは共有シート（`shareFile`）、読み込みは `<input type=file>`（ファイル App から選ぶ）
- iCloud 同期（I6）: `NSUbiquitousKeyValueStore`（キー値ストア）にセーブを 1 本、zlib 圧縮して置く（`CloudStore.swift`。1 キー 1MB の制限。900KB を超えたら送らない）。entitlement `com.apple.developer.ubiquity-kvstore-identifier`（有料の Developer Program が要る。無料の Personal Team なら `project.yml` の entitlements を外す）
  - ★ 方針: 端末のセーブが本体。クラウドは「他の端末から持ってくる」ためで、勝手に上書きしない
  - 保存のたびに送る（60 秒に 1 回まで。背面に回るときは即）。ブリッジ: `cloudStatus` / `cloudLoad` / `cloudSave` / `cloudClear`、イベント `cloudChanged`（他の端末から届いた）
  - 起動時・届いたとき・設定の「iCloud のセーブを確認」で、クラウドのほうが 2 秒以上新しく、自分が送ったものでなければ「iCloud に新しいセーブがあります」のモーダル（両方の要約を並べ、読み込む／この端末のまま）。読み込むと `loadWorld`
  - 設定で同期のオン／オフ。iCloud 未サインインは案内

## 4. 画面・OS まわり

- セーフエリア: `viewport-fit=cover` と CSS の `env(safe-area-inset-*)` を使う（WebView は画面いっぱい、`contentInsetAdjustmentBehavior = .never`）
- 向き: 縦横両対応（Web 版と同じレイアウト）。ステータスバーは表示、ダークスタイル
- 音: `AVAudioSession` を `.ambient`（他アプリの音楽を止めない）。ユーザー操作無しの再生を許可
- バックグラウンド: iOS では OS が WebView を止めるので、Web 版の「お休み（追いつき／お留守番レポート）」の挙動になる。`background` イベントでセーブ
- 外部リンク無し。ズーム・バウンス無効

## 5. マイルストーン

| # | 内容 | 完了条件 |
|---|---|---|
| I1 | 設計書、`ios/` の雛形（XcodeGen・Swift シェル・スキームハンドラ・ブリッジ・StoreKit 2・ローカル StoreKit 構成）、JS プラットフォーム層 | Mac で `xcodegen generate` → ビルド → シミュレータで Web 版が動く。`ping` が返る |
| I2 | セーブのネイティブ保存、画面点けっぱなし、ハプティクス | 再起動してもセーブが残る。眺めモードで画面が消えない |
| I3 | ストア画面（商品一覧・購入・復元）、機能フラグ、サンドボックス解放 | ローカル StoreKit 構成で購入 → デバッグ画面が設定から開ける |
| I4 | 上限突破（定数の差し替え） | 購入後に 80 台／段数 12／64×48 まで広げられる |
| I5 | 特別ロボ（ドローン・ダブルデッカー）: sim・描画・ショップ | 衝突ゼロのテストに空中レイヤーと 2 段持ちが加わる |
| I6 | 見た目（スキン・テーマ）、iCloud 同期 | 設定で切替、別端末でセーブが見える |
| I7 | 提出準備: アイコン、起動画面、プライバシーマニフェスト、スクリーンショット、審査メモ | App Store Connect にアップロードできる |

I7 の成果物: `ios/STORE.md`（App 情報・説明・キーワード・課金 4 本の登録内容・審査メモ・プライバシー回答・スクリーンショットの撮り方・提出チェックリスト）、`src/pages/privacy.astro` / `support.astro`（Web 版と同じドメインで配信するプライバシーポリシーとサポートページ。URL を App Store Connect に入れる）、起動スプラッシュ（`#splash`。WebView が動き出すまでの暗い時間を無くす）、デモ起動（`-demo` / `?demo`。メガDC ＋ 特別ロボ ＋ 全機能解放のセーブで起動。スクリーンショットと審査デモ用）、`developmentLanguage: ja` / `CFBundleDevelopmentRegion: ja`

## 6. 判断（★）

- Capacitor ではなく自前シェル: 依存ゼロの方針と揃え、必要な機能（配信・ブリッジ・課金・触覚・画面点灯）は小さい
- XcodeGen を使う: `.xcodeproj` を手書き・コミットしない。Mac 側に `brew install xcodegen` が 1 回必要
- 独自スキーム配信: 絶対パス（`/_astro/...`）がそのまま動き、安定した origin で localStorage が使える
- 商品は非消耗型 4 本のみ。消耗型・サブスクは置かない
