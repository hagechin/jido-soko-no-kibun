# App Store 提出資料（I7）

App Store Connect に入力する文面と、提出前の手順。`<...>` は提出者が埋める。

## 1. 提出前の設定（Xcode）

| 項目 | 値 |
|---|---|
| Bundle ID | `jp.hatte.hakoniwa.ds`（`project.yml`。変えるなら StoreKit の商品 ID と `Products.storekit` も合わせる） |
| 表示名 | 箱庭！DS（ホーム画面）。App Store 上の名前は「箱庭！ディストリビューション」 |
| バージョン / ビルド | `MARKETING_VERSION 1.1` / `CURRENT_PROJECT_VERSION 6`（`project.yml`。アップデートのたびに両方上げる） |
| チーム | `project.yml` の `DEVELOPMENT_TEAM` にチーム ID を入れる（iCloud の KVS 識別子にチーム接頭辞が付く） |
| 対応 OS | iOS 26 以降、iPhone / iPad |
| 向き | iPhone: 縦・横、iPad: 全部 |
| 暗号化 | `ITSAppUsesNonExemptEncryption = false`（独自の暗号化なし） |
| プライバシーマニフェスト | `PrivacyInfo.xcprivacy`: トラッキングなし、収集データなし、必須理由 API なし |
| Capability | iCloud → Key-Value storage（`HakoniwaDS.entitlements`）、In-App Purchase（自動） |
| ファイル App | `UIFileSharingEnabled` + `LSSupportsOpeningDocumentsInPlace`: 「このiPhone内 › 箱庭！DS」に書き出したセーブを置く（本体のセーブは Application Support） |
| 同梱 Web | 提出前に `./ios/sync-web.sh`（`ios/Web/BUILD_INFO` のコミットを確認）→ `xcodegen generate` → Archive |

## 2. App 情報

- **名前**: 箱庭！ディストリビューション
- **サブタイトル**（30 文字以内）: 倉庫を自動化して、眺める
- **カテゴリ**: ゲーム（シミュレーション / ストラテジー）
- **年齢**: 4+（暴力・ギャンブル・医療・成人向け要素なし。「無制限のウェブアクセス」なし）
- **プライバシーポリシー URL**: `https://www.hatte.co.jp/privacy-policy-for-ds`
- **サポート URL**: `https://www.hatte.co.jp/app/hakoniwa`（LP 兼サポートページ。遊び方・進行が止まったときの対処・不具合の報告先）
- **著作権**: `© 2026  hatte Inc.`

### 説明（4000 文字以内）

```
小さな倉庫から始めて、棚ロボと搬送ロボを増やし、自動化AIで回る物流センターを育てるシミュレーションゲームです。

■ 遊び方
・オーダーが届いたら、棚ロボが商品のビンを掘り出してポートへ。搬送ロボがピッキングステーションへ運び、出荷するとコインが入ります。
・コインで棚の段数、ビン容量、ロボの速度や積載量、倉庫の面積を強化。
・自動配車AI・自動補充AI・在庫再配置AIを買うと、手を離しても倉庫が回り始めます。
・季節イベント（新生活、梅雨、サイバーウィーク…）で売れ筋が変わります。
・困ったらアドバイザーが「いま効く強化」を教えてくれます。

■ 眺めモード
全部自動になったら、カメラが倉庫を巡る眺めモードへ。AUTO で自動カメラ、MANUAL で自由視点。画面を点けっぱなしにもできます。

■ レイアウトエディタ
真上から見た 2D 画面で、スタック・ポート・ステーションを範囲選択してドラッグ。3D プレビューで確認してから反映。

■ 放置しても進む（次のサイバーウィークまで）
アプリを閉じている間の進行は、戻ったときにまとめて反映（お留守番レポート）。ただし年に一度の本番「サイバーウィーク」は自分で遊ぶ週なので、その直前で止まります（ゲーム内の 1 年は約 72 分）。

■ iOS 版だけの追加機能（買い切り・広告なし）
・特別ロボパック: 棚の上を飛ぶドローン搬送ロボ（大きな倉庫で特に威力を発揮）、ビンを 2 段持てるダブルデッカー棚ロボ（狭い棚でも棚ロボ 2 台ぶんの働き。序盤から活躍）
・上限突破パック: ロボ 80/120 台、積載 8 ビン、棚 12 段、倉庫 64×48
・サンドボックスモード: コイン、プリセット倉庫、時間ジャンプ、ロボ MAX、停滞診断
・サポーターパック: 上の全部 ＋ 金色ロボスキン ＋ 倉庫カラーテーマ
セーブは iCloud で同期できます。

通信なし、アカウント登録なし、広告なし。オフラインでも遊べます。
```

### 説明（英語、App Store Connect の English ローカライズ用）

```
Start with a tiny warehouse, add shelf robots and AMRs, and grow an automated logistics center that runs on its own.

■ How it works
- Orders arrive. Shelf robots dig out the right bins and drop them at a port. AMRs carry them to the picking station, and every shipment earns coins.
- Spend coins on shelf levels, bin capacity, robot speed and cargo, and floor space.
- Buy the Dispatch, Restock and Relocation AIs and the warehouse keeps running without you.
- Seasonal events (fresh start, rainy season, Cyber Week…) change what sells.
- An advisor tells you which upgrade helps right now.

■ Calm mode
Once everything is automated, sit back and let the camera tour the warehouse. AUTO or free MANUAL camera, with keep-screen-on.

■ Layout editor
Rearrange stacks, ports and stations from a top-down 2D view with box selection and drag, then check the 3D preview.

■ Photo mode
Place a camera anywhere, pick focal length, aperture, shutter and effect, and shoot. Use your photo as the startup screen.

■ Keeps going while you are away
Progress made while the app was closed is applied when you return (away report).

■ iOS-only extras (one-time purchases, no ads)
- Special Robots Pack: a drone AMR that flies over the shelves and a double-decker shelf robot
- Limit Breaker Pack: 80/120 robots, 8-bin cargo, 12 shelf levels, 64×48 warehouse
- Sandbox Mode: coins, preset warehouses, time jumps, Robot MAX, stall diagnosis
- Supporter Pack: all of the above + gold robot skin + warehouse color themes
Saves sync through iCloud.

No network, no account, no ads. Works offline. Japanese and English.
```

- **英語のサブタイトル**: Build and watch an automated warehouse
- **英語のキーワード**: `warehouse,logistics,simulation,idle,automation,robot,tycoon,AMR,picking,sandbox`

- **キーワード**（100 文字以内、カンマ区切り）: `倉庫,物流,シミュレーション,放置,自動化,ロボット,箱庭,経営,ピッキング,AMR`
- **プロモーションテキスト**（170 文字以内）: 棚ロボと搬送ロボで回る自動倉庫を育てて、眺める。通信なし・広告なしの買い切り型シミュレーション。
- **新機能（1.0.0）**: 初回リリース
- **新機能（1.0.1）**（App Store Connect の「このバージョンの新機能」に貼る）:

```
・文字の大きさを選べるようになりました（小／標準／大／特大）。初回に選べるほか、設定からいつでも変えられます
・はじめての方向けに、最初の 6 ステップを案内するチュートリアルを追加しました（設定からやり直せます）
・まれに在庫のビンが行方不明になり、出荷が止まることがある不具合を修正しました。すでに起きている倉庫も、起動時に自動で元に戻します
・並べ替えAIが 2 つの棚の間で同じビンを動かし続けることがある不具合を修正しました
・セーブデータを本体（ファイル App の「箱庭！DS」フォルダ）に保存できるようになりました
・長いお知らせが読みやすくなりました
```

- **新機能（1.0.2）**:

```
・画面上のコインをタップすると、コインの使い道（おすすめ・建設・強化）への近道が出るようになりました
・チュートリアルで、強化パネルが自動化AIの行まで自動でスクロールし、建設では置けるマスが緑に光るようになりました
```

- **新機能（1.0.3）**:

```
・iPhone Duo に対応しました。閉じた画面・開いた画面のどちらでも遊べ、遊んでいる途中で開いたり閉じたりしても続きます
・パネルや設定の閉じるボタンがステータスバーに隠れないようにしました
```

- **新機能（1.1）**:

```
・フォトモード: 眺めモードの「フォト」から、倉庫の中を歩いたり飛んだりして写真が撮れます。焦点距離・ボケ・シャッター・露出・エフェクトを選び、長押しの連写から 1 枚を現像。撮った写真はカメラロールに保存・共有でき、起動画面にもできます
・眺めモードに WALK カメラを追加。倉庫の中を歩いて眺められます
・英語に対応しました。端末の言語が日本語以外なら英語で表示されます（設定で切り替え可）
```

- **What's New（1.1、English）**:

```
- Photo Mode: tap "Photo" in Calm Mode to walk or fly through your warehouse and take pictures. Choose focal length, bokeh, shutter, exposure and effects, hold the shutter to burst and develop the best frame. Save photos to your Camera Roll, share them, or use one as the startup screen.
- Calm Mode gets a WALK camera: stroll through the warehouse.
- English localization. The app follows your device language (switch anytime in Settings).
```

## 3. アプリ内課金（App Store Connect → 機能 → App 内課金）

4 本とも **非消耗型**。`Products.storekit` と同じ ID・表示名・説明を登録し、**最初のバージョンと一緒に審査に提出する**（商品を作っただけでは審査されない）。

| 商品 ID | 参照名 | 表示名 | 説明 | 価格帯の目安 |
|---|---|---|---|---|
| `jp.hatte.hakoniwa.ds.robots` | Special Robots | 特別ロボパック | ドローン搬送ロボ（大きな倉庫向け）とダブルデッカー棚ロボ（序盤から活躍） | ¥600 |
| `jp.hatte.hakoniwa.ds.limits` | Limit Breaker | 上限突破パック | ロボ上限 80/120、積載 Lv4、段数 12、倉庫 64×48 | ¥500 |
| `jp.hatte.hakoniwa.ds.sandbox` | Sandbox | サンドボックスモード | コイン・プリセット倉庫・時間ジャンプ・ロボ MAX・停滞診断 | ¥500 |
| `jp.hatte.hakoniwa.ds.supporter` | Supporter | サポーターパック | 全部入り ＋ 金色ロボスキン ＋ 倉庫カラーテーマ | ¥1,200 |

- 各商品に審査用スクリーンショット（ストア画面 `r4-m8-store-ios27.png` のような、商品が並んだ画面）を付ける
- ファミリー共有: オン（`Products.storekit` と同じ）
- 「購入を復元」ボタンはストア画面にある（審査ガイドライン 3.1.1）

## 4. 審査メモ（App Review Information → メモ）

```
このアプリはアカウント不要で、起動するとすぐ遊べます。

アプリ内課金の確認手順:
1. 下のバーの「設定」(歯車) → 「追加機能」 → 「ストア（特別ロボ・上限突破・サンドボックス）」
2. 4 つの買い切り商品が並びます。「購入を復元」ボタンも同じ画面にあります。
3. 購入後の確認: 「強化」(右肩上がりのアイコン) の「特別ロボ」の行が購入できるようになります。
   サンドボックスモードを購入すると「設定 → 追加機能 → サンドボックス画面」が増えます。
   サポーターパックを購入すると「設定 → 見た目」でロボのスキンとカラーテーマを切り替えられます。

iCloud 同期は「設定 → iCloud 同期」でオン/オフできます。端末のセーブを勝手に上書きせず、
別の端末のセーブがあるときだけ「読み込みますか？」と確認します。

デモ用の進んだ倉庫を見たい場合: 本アプリにはデモアカウントはありませんが、
サンドボックスモードを購入（Sandbox 環境）すると、プリセット倉庫の読み込みと時間ジャンプが使えます。

通信: App Store（課金）と iCloud 以外にネットワーク接続はありません。
```

- 連絡先: 名前・電話・メール（審査中に連絡が来ることがある）
- Sandbox テスターのアカウントを 1 つ作り、実機で 4 商品の購入・復元を一度通しておく（`ios/TESTPLAN.md` D3）

## 5. App のプライバシー（App Privacy）

- 「データを収集しない」を選ぶ（Data Not Collected）。iCloud KVS はユーザー自身のアカウント、課金は Apple が処理するため、開発者が収集するデータは無い
- トラッキング: いいえ

## 6. スクリーンショット

必須サイズ（2026 年時点の App Store Connect の要件に合わせる。足りなければ Connect が指示するサイズに）:

| 端末 | シミュレータ | サイズ |
|---|---|---|
| iPhone 6.9" | iPhone 17 Pro Max | 1320×2868（縦） |
| iPad 13" | iPad Pro 13-inch (M4) | 2064×2752（縦） |

撮り方（シミュレータ）:

```sh
# Edit Scheme → Run → Arguments で -demo にチェック（メガDC ＋ 特別ロボ ＋ 全機能解放のセーブで起動）→ Run
xcrun simctl io booted screenshot ios/screenshots/01-main.png
```

撮る画面（この順で並べる。1〜3 枚目が一覧に出る）:

| # | 画面 | 操作 |
|---|---|---|
| 1 | 倉庫の全景（ロボが動いている） | 起動直後。照準でリセット、2x |
| 2 | 眺めモード（AUTO カメラが寄っている） | 下のバーの炎アイコン → 数秒待つ |
| 3 | ドローンとダブルデッカー（寄り） | ロボ一覧でダブルデッカーを選んでから眺めモード（選んだロボを追う）。ダブルデッカーはスタックの上に居るので、ドローンがポートやステーションへ飛ぶ瞬間を待つと両方写る。難しければ MANUAL でピンチして棚の一角に寄る |
| 4 | 強化パネル | 「強化」を開く。「おすすめ」は倉庫が詰まったときだけ出るので、無ければ無いままでよい（出したいときは搬送ロボを数台減らして 4x で 1〜2 分回す） |
| 5 | レイアウトエディタ | 「建設」→ L（レイアウトエディタ） |
| 6 | ストア | 設定 → 追加機能 → ストア |
| 7 | サイバーウィーク | サンドボックス画面 → 「サイバーウィーク本番へ」→ 全景 |

- `-demo` はデモ用にセーブを上書きするので、自分のセーブがあるシミュレータでは使わない（`-resetSave` と同じ扱い）
- `-demo` は購入ではなく「機能の上書き」で解放するので、ストアの商品は価格のまま（購入済みにならない）。6 枚目はそれで撮る（価格が並んだ画面のほうが審査にも向く）
- iPad の縦向きは幅が広いので倉庫が横幅いっぱい・縦は中央に小さめに写る（仕様。寄りの画面は眺めモードで）
- 文字入りの加工（タイトル帯）は任意。無加工でも審査は通る

## 7. 提出チェックリスト

### アップデート（1.0.1 以降）の手順

1. リリースのブランチ（1.0.x は `release/1.0`、1.1 は `release/1.1`）を `git pull`。`project.yml` のバージョンとビルド番号が上がっていることを確認（1.1 / 6。**Xcode 27.1 でビルドする**: iOS 27.1 SDK でないと iPhone Duo の内側画面で端まで使えない）
2. `./ios/sync-web.sh` → `ios/Web/BUILD_INFO` の commit がそのブランチの先端 → `cd ios && xcodegen generate`
3. 実機で（1.1）: 起動（M1）、既存のセーブが残っている（M3）、設定の「セーブ」の下の表示が「アプリ 1.1 (6)」、M24〜M25d（フォトモード。特に実機でしか見られない 3 件: 写真の保存を許可しなかったときの「設定を開く」が本アプリの設定ページに行く、「現像中…」の表示、ボケ オンのプレビューのカクつき・発熱）、M57（眺めモードの WALK）、M58（英語。iPhone の言語を English にして起動）、M56（チュートリアル 5/6 で強化を開くと見出しの下に 1 行）、M59（iPhone Duo: 4 姿勢・開閉・パネルの閉じるボタン。実機があれば）。1.0.2 の M55・M51〜M54 は軽く
4. Product → Archive → Distribute → App Store Connect にアップロード
5. App Store Connect → アプリ → 「＋」で新しいバージョン（1.1）→ ビルドを選ぶ → 「このバージョンの新機能」に上の文面（日本語と English の両方のローカライズに）→ 審査に提出。1.1 は English のローカライズを追加する（説明・サブタイトル・キーワードは §2 の英語版。スクリーンショットは日本語のものを流用可）。フォトモードの写真保存で `NSPhotoLibraryAddUsageDescription` を使うので、審査メモに「写真はユーザーが撮った倉庫の画像の保存のみ」と一言
6. 審査が通ったらリリースのブランチに `v1.1` のタグを打ち、`PROGRESS.md` に記録。Web 版（main）にも同じ内容を反映


- [ ] `DEVELOPMENT_TEAM` を設定し、実機で起動・課金（Sandbox）・iCloud を確認（`TESTPLAN.md` の D1〜D8）
- [ ] `./ios/sync-web.sh` → `BUILD_INFO` が最新コミット
- [ ] `xcodegen generate` → `HakoniwaDS.entitlements` に KVS の識別子が残っている
- [ ] Product → Archive → Distribute → App Store Connect
- [ ] App 情報・説明・キーワード・スクリーンショット・プライバシーポリシー URL・サポート URL
- [ ] App 内課金 4 本を作成し、バージョンに関連付けて一緒に提出
- [ ] App のプライバシー: データ収集なし
- [ ] 審査メモ（上の文面）と連絡先
