/* 自動倉庫の気分 — Service Worker（§11.4）。ビルド時に PRECACHE と VERSION が差し込まれる。
 * 全ファイルを事前キャッシュし、2 回目以降は機内モードでも起動できる。
 * 更新は勝手に適用しない（ページ側が SKIP_WAITING を送ったときだけ切り替える）。 */
const VERSION = '__VERSION__';
const CACHE = `jido-soko-${VERSION}`;
const PRECACHE = __PRECACHE__;

self.addEventListener('install', (event) => {
  event.waitUntil(caches.open(CACHE).then((c) => c.addAll(PRECACHE)));
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()),
  );
});

self.addEventListener('message', (event) => {
  if (event.data && event.data.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;
  // ナビゲーションは index.html（キャッシュ優先、無ければネットワーク）
  if (req.mode === 'navigate') {
    event.respondWith(caches.match('./index.html').then((r) => r || fetch(req).catch(() => caches.match('./index.html'))));
    return;
  }
  event.respondWith(
    caches.match(req).then((cached) => {
      if (cached) return cached;
      return fetch(req).then((res) => {
        if (res && res.ok && url.pathname.startsWith(self.registration.scope.replace(self.location.origin, ''))) {
          const copy = res.clone();
          caches.open(CACHE).then((c) => c.put(req, copy));
        }
        return res;
      });
    }),
  );
});
