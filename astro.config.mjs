// @ts-check
import { defineConfig } from 'astro/config';
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { join, relative } from 'node:path';

/** ビルド後に dist/ を走査して Service Worker（全ファイルの事前キャッシュ一覧つき）を生成する（§11.4） */
function serviceWorkerIntegration() {
  return {
    name: 'jido-soko-service-worker',
    hooks: {
      'astro:build:done': ({ dir }) => {
        const root = fileURLToPath(dir);
        const files = [];
        const walk = (d) => {
          for (const name of readdirSync(d)) {
            const p = join(d, name);
            if (statSync(p).isDirectory()) walk(p);
            else files.push(p);
          }
        };
        walk(root);
        const list = files
          .map((p) => relative(root, p).split('\\').join('/'))
          .filter((p) => p !== 'sw.js' && !p.endsWith('.map'))
          .map((p) => './' + p);
        const hash = createHash('sha1');
        for (const p of files.sort()) hash.update(readFileSync(p));
        const version = hash.digest('hex').slice(0, 10);
        const tpl = readFileSync(new URL('./scripts/sw-template.js', import.meta.url), 'utf8');
        writeFileSync(join(root, 'sw.js'), tpl.replace('__VERSION__', version).replace('__PRECACHE__', JSON.stringify(list, null, 0)));
        console.log(`[sw] generated sw.js (${list.length} files, v${version})`);
      },
    },
  };
}

// ロリポップ！デプロイナウ向け: 完全な静的サイトとして出力する（サーバー処理なし）
export default defineConfig({
  output: 'static',
  outDir: 'dist',
  compressHTML: true,
  build: {
    format: 'file',
    inlineStylesheets: 'auto',
  },
  vite: {
    build: {
      chunkSizeWarningLimit: 1200,
      target: 'es2020',
    },
  },
  devToolbar: { enabled: false },
  integrations: [serviceWorkerIntegration()],
});
