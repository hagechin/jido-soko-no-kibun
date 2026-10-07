// @ts-check
import { defineConfig } from 'astro/config';

// ロリポップ！デプロイナウ向け: 完全な静的サイトとして出力する（サーバー処理なし）
export default defineConfig({
  output: 'static',
  outDir: 'dist',
  compressHTML: true,
  build: {
    // 1ページ構成なので index.html 直下に出力
    format: 'file',
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      // three.js を含むため 1 チャンクがやや大きくなるのは想定内
      chunkSizeWarningLimit: 1200,
      target: 'es2020',
    },
  },
  devToolbar: { enabled: false },
});
