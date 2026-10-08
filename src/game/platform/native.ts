/**
 * ネイティブ（iOS アプリ）との橋渡し（SPEC-iOS §2）。
 * JS → Swift: window.webkit.messageHandlers.native.postMessage({ id, method, params })
 * Swift → JS: window.__native.reply(id, { ok, result | error }) / window.__native.emit(event, payload)
 * ネイティブが無ければ available = false で、呼び出しは即座に失敗（呼ぶ側は Web 版の挙動へ）
 */
export type NativeEvent = 'entitlements' | 'foreground' | 'background';

interface Pending {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
}

interface NativeWindow extends Window {
  __nativeInfo?: { platform: string; version: string; build: string; reset?: boolean };
  webkit?: { messageHandlers?: { native?: { postMessage: (m: unknown) => void } } };
  __native?: { reply: (id: number, r: { ok: boolean; result?: unknown; error?: string }) => void; emit: (event: string, payload: unknown) => void };
}

const w = (typeof window !== 'undefined' ? window : undefined) as NativeWindow | undefined;
const pending = new Map<number, Pending>();
const listeners = new Map<string, Set<(payload: unknown) => void>>();
let seq = 1;

export const native = {
  /** iOS アプリの中で動いているか */
  get available(): boolean {
    return !!w?.__nativeInfo && !!w?.webkit?.messageHandlers?.native;
  },
  get info() {
    return w?.__nativeInfo ?? null;
  },
  /** @param timeoutMs 返事を待つ上限（購入など、ユーザーが OS の画面を操作する呼び出しは長く） */
  call<T = unknown>(method: string, params: Record<string, unknown> = {}, timeoutMs = 15_000): Promise<T> {
    if (!this.available) return Promise.reject(new Error('native unavailable'));
    const id = seq++;
    return new Promise<T>((resolve, reject) => {
      pending.set(id, { resolve: resolve as (v: unknown) => void, reject });
      try {
        w!.webkit!.messageHandlers!.native!.postMessage({ id, method, params });
      } catch (e) {
        pending.delete(id);
        reject(e instanceof Error ? e : new Error(String(e)));
      }
      // 返事が来ない保険
      setTimeout(() => {
        const p = pending.get(id);
        if (p) {
          pending.delete(id);
          p.reject(new Error(`native timeout: ${method}`));
        }
      }, timeoutMs);
    });
  },
  on(event: NativeEvent, handler: (payload: unknown) => void): () => void {
    let set = listeners.get(event);
    if (!set) listeners.set(event, (set = new Set()));
    set.add(handler);
    return () => set!.delete(handler);
  },
};

if (w) {
  w.__native = {
    reply(id, r) {
      const p = pending.get(id);
      if (!p) return;
      pending.delete(id);
      if (r.ok) p.resolve(r.result);
      else p.reject(new Error(r.error ?? 'native error'));
    },
    emit(event, payload) {
      for (const h of listeners.get(event) ?? []) h(payload);
    },
  };
}

/** 失敗を握りつぶして呼ぶ（触覚・画面点灯など、無くても困らないもの） */
export function nativeTry(method: string, params: Record<string, unknown> = {}): void {
  if (!native.available) return;
  native.call(method, params).catch(() => {});
}
