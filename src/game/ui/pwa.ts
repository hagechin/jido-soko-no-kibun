/** Service Worker の登録と「更新があります」の控えめな通知（§11.4）。勝手に再読み込みしない */
import { $ } from './layout';

export function registerServiceWorker(): void {
  if (!('serviceWorker' in navigator)) return;
  const banner = $('update-banner');
  let waiting: ServiceWorker | null = null;
  const showUpdate = (sw: ServiceWorker) => {
    waiting = sw;
    banner.hidden = false;
  };
  banner.addEventListener('click', () => {
    if (!waiting) return;
    waiting.postMessage({ type: 'SKIP_WAITING' });
    banner.hidden = true;
  });
  let reloading = false;
  navigator.serviceWorker.addEventListener('controllerchange', () => {
    if (reloading) return;
    reloading = true;
    // ユーザーが更新をタップしたときだけここに来る（初回インストールでは controller が null → 無視）
    if (waiting) location.reload();
  });
  navigator.serviceWorker
    .register('./sw.js')
    .then((reg) => {
      if (reg.waiting && navigator.serviceWorker.controller) showUpdate(reg.waiting);
      reg.addEventListener('updatefound', () => {
        const nw = reg.installing;
        if (!nw) return;
        nw.addEventListener('statechange', () => {
          if (nw.state === 'installed' && navigator.serviceWorker.controller) showUpdate(nw);
        });
      });
      // 起動のたびに更新を確認（通信できなければ黙って失敗）
      reg.update().catch(() => {});
    })
    .catch(() => {});
}
