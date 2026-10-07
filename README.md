# 自動倉庫の気分

物流倉庫を自動化して「眺める」ブラウザゲーム。仕様は [SPEC.md](./SPEC.md)、進捗は [PROGRESS.md](./PROGRESS.md)。

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

ロリポップ！デプロイナウに GitHub 連携でデプロイする（Build: `npm run build` / Output: `dist`）。CLI の場合は `npx lolipop deploy`。
