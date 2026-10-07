/**
 * バックグラウンド動作（★）: タブが隠れている間もシミュレーションを進める。
 * ブラウザは隠れたタブの setTimeout / requestAnimationFrame を強く間引くが、Web Worker のタイマーは間引かれないので、
 * Worker から 250ms ごとにメッセージを送ってもらい、メインスレッド側で経過時間ぶんの tick を進める。
 * スマホは OS がアプリごと止めるので効かないことが多い → 既定はポインタの細かい端末（PC）だけオン
 */
const KEY = 'jido-soko-no-kibun:background';

export function loadBackgroundSetting(): boolean {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw === 'on') return true;
    if (raw === 'off') return false;
  } catch {
    /* ignore */
  }
  return typeof matchMedia === 'function' && matchMedia('(pointer: fine)').matches;
}

export function saveBackgroundSetting(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? 'on' : 'off');
  } catch {
    /* ignore */
  }
}

export class BackgroundTicker {
  private worker: Worker | null = null;
  private fallback: number | null = null;
  private onTick: (() => void) | null = null;

  get running(): boolean {
    return this.onTick !== null;
  }

  start(onTick: () => void, intervalMs = 250): void {
    if (this.onTick) return;
    this.onTick = onTick;
    try {
      const code = `let id=null;onmessage=(e)=>{if(e.data==='stop'){clearInterval(id);id=null;close();return;}if(id===null)id=setInterval(()=>postMessage(0),e.data);};`;
      const url = URL.createObjectURL(new Blob([code], { type: 'text/javascript' }));
      this.worker = new Worker(url);
      URL.revokeObjectURL(url);
      this.worker.onmessage = () => this.onTick?.();
      this.worker.postMessage(intervalMs);
    } catch {
      this.worker = null;
      this.fallback = window.setInterval(() => this.onTick?.(), intervalMs);
    }
  }

  stop(): void {
    this.onTick = null;
    if (this.worker) {
      this.worker.postMessage('stop');
      this.worker.terminate();
      this.worker = null;
    }
    if (this.fallback !== null) {
      clearInterval(this.fallback);
      this.fallback = null;
    }
  }
}
