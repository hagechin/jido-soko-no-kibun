/** localStorage のセーブ（§11.2）。失敗しても例外を外に出さない */
import { SAVE } from '../data/balance';
import { deserialize, serialize, type LoadResult } from '../sim/save';
import type { WorldState } from '../sim/types';
import { native, nativeTry } from '../platform/native';
import { cloudPush } from '../platform/cloud';

export function saveToStorage(w: WorldState, cloudNow = false): boolean {
  const savedAt = Date.now();
  const text = serialize(w, savedAt);
  // iOS アプリ: 本体は Documents（localStorage は消されることがある）。失敗しても localStorage には残す。iCloud にも（間引いて）送る
  if (native.available) {
    nativeTry('save', { key: SAVE.key, data: text });
    cloudPush(text, savedAt, cloudNow);
  }
  try {
    localStorage.setItem(SAVE.key, text);
    return true;
  } catch {
    return native.available;
  }
}

/** iOS アプリ: 起動前にネイティブの保存を localStorage へ流し込む（以後は同期の loadFromStorage で読める） */
export async function preloadNativeSave(): Promise<void> {
  if (!native.available) return;
  if (native.info?.reset) {
    // UI テスト（-resetSave）: ネイティブ側はもう消してある。WebView の localStorage も消して新規開始
    try {
      localStorage.removeItem(SAVE.key);
    } catch {
      /* ignore */
    }
    return;
  }
  try {
    const text = await native.call<string | null>('load', { key: SAVE.key });
    if (typeof text === 'string' && text) localStorage.setItem(SAVE.key, text);
  } catch {
    /* ネイティブに無ければ localStorage のまま */
  }
}

/** 端末のセーブの時刻（読まずに取り出す。無ければ null） */
export function localSavedAt(): number | null {
  try {
    const text = localStorage.getItem(SAVE.key);
    const m = text && /"savedAt":\s*(\d+)/.exec(text);
    return m ? Number(m[1]) : null;
  } catch {
    return null;
  }
}

export function loadFromStorage(): LoadResult | null {
  try {
    const text = localStorage.getItem(SAVE.key);
    if (!text) return null;
    return deserialize(text);
  } catch {
    return null;
  }
}

export function clearStorage(): void {
  if (native.available) nativeTry('delete', { key: SAVE.key });
  try {
    localStorage.removeItem(SAVE.key);
  } catch {
    /* ignore */
  }
}

/** セーブをファイルに書き出す（§11.4） */
/** 書き出すファイル名（日時入り） */
export function exportFileName(d = new Date()): string {
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  return `jido-soko-save-${stamp}.json`;
}

/**
 * セーブをファイルに書き出す。iOS アプリは共有シート（「ファイルに保存」など。WKWebView は blob: のダウンロードを扱えない）、
 * Web はブラウザのダウンロード。失敗したら理由を返す（null なら成功、'cancel' は共有シートを閉じただけ）
 */
export async function exportSaveFile(w: WorldState): Promise<string | null> {
  const text = serialize(w);
  const name = exportFileName();
  if (native.available) {
    try {
      // 共有シートを出した時点で返事が来る。10 秒来なければ Swift 側が古い（shareFile 未対応）か、シートを出せなかった
      await native.call('shareFile', { name, text }, 10_000);
      return null;
    } catch (e) {
      return e instanceof Error ? e.message : String(e);
    }
  }
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
  return null;
}

/** セーブをクリップボードへ（iOS で共有シートが使えないときの逃げ道。メモや「ファイル」に貼り付けて保管できる）。失敗したら理由 */
export async function copySaveToClipboard(w: WorldState): Promise<string | null> {
  try {
    await navigator.clipboard.writeText(serialize(w));
    return null;
  } catch (e) {
    return e instanceof Error ? e.message : String(e);
  }
}

/** クリップボードのセーブを読み込む（iOS は貼り付けの許可ダイアログが出る） */
export async function importSaveFromClipboard(): Promise<LoadResult> {
  let text: string;
  try {
    text = await navigator.clipboard.readText();
  } catch (e) {
    return { ok: false, reason: `クリップボードを読めませんでした（${e instanceof Error ? e.message : String(e)}）` };
  }
  if (!text.trim()) return { ok: false, reason: 'クリップボードが空です' };
  return deserialize(text);
}

/** ファイルからセーブを読み込む */
export async function importSaveFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return deserialize(text);
}
