# 箱庭！ディストリビューション

物流倉庫を自動化して「眺める」シミュレーションゲーム（旧称: 自動倉庫の気分）。Web 版の仕様は [SPEC.md](./SPEC.md)、iOS 版は [SPEC-iOS.md](./SPEC-iOS.md)、進捗は [PROGRESS.md](./PROGRESS.md)。iOS 版のビルド手順は [ios/README.md](./ios/README.md)。

## 開発

```sh
npm install
npm run dev      # 開発サーバー
npm run build    # dist/ に静的サイトを出力
npm test         # Vitest（sim/ の単体テスト）
npm run check    # tsc --noEmit
```

- Node.js 22（`.nvmrc`）
- Astro `output: 'static'`。サーバー処理・DB・外部 CDN なし
- `src/game/sim/` はブラウザ API と Three.js に依存しない純粋な TypeScript

## デプロイ

ロリポップ！デプロイナウに GitHub 連携でデプロイする。

| 項目 | 値 |
|---|---|
| Framework | Astro |
| Install | `npm ci` |
| Build | `npm run build` |
| Output | `dist` |
| Node.js | 22（`.nvmrc`） |

CLI の場合は `npx lolipop deploy`（ブラウザでのログインが必要）。

## 構成

- `src/game/sim/` — シミュレーション（純粋な TypeScript。固定 10 tick/秒。Vitest でテスト）
- `src/game/render/` — Three.js（ボクセル描画・カメラ・演出）
- `src/game/ui/` — 素の DOM（HUD・オーダーシート・建設・ショップ・設定）
- `src/game/audio/` — WebAudio 合成サウンド
- `src/game/data/` — 数値（`balance.ts`）、商品、ドット絵、季節
- `scripts/` — PWA アイコン生成、Service Worker テンプレート


## ブランチ運用（v1.0 以降）

| ブランチ | 役割 |
|---|---|
| `release/1.0` | リリース候補（v1.0.0-rc1 = `bb64f3d`）。実機確認と提出に使う。直すのは不具合だけ。直したら開発ブランチへも取り込む |
| `claude/nifty-feynman-opfzeb` | 開発の本線。機能ブランチをここへ取り込む |
| `feature/photo-mode` | フォトモード（カメラ配置・画角・絞り・シャッター・エフェクト、撮った写真を起動画面に） |
| `feature/i18n` | 英語対応（日本語をキーにした辞書 `src/game/i18n/en.ts`。`node scripts/wrap-strings.mjs --check --list` で未訳を確認） |

Mac 側のテストは、提出前の確認は `release/1.0`、新機能の確認はその機能ブランチで行う。
