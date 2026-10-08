/** localStorage のセーブ（§11.2）。失敗しても例外を外に出さない */
import { SAVE } from '../data/balance';
import { deserialize, serialize, type LoadResult } from '../sim/save';
import type { WorldState } from '../sim/types';
import { native, nativeTry } from '../platform/native';

export function saveToStorage(w: WorldState): boolean {
  const text = serialize(w);
  // iOS アプリ: 本体は Documents（localStorage は消されることがある）。失敗しても localStorage には残す
  if (native.available) nativeTry('save', { key: SAVE.key, data: text });
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
  try {
    const text = await native.call<string | null>('load', { key: SAVE.key });
    if (typeof text === 'string' && text) localStorage.setItem(SAVE.key, text);
  } catch {
    /* ネイティブに無ければ localStorage のまま */
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
export function exportSaveFile(w: WorldState): void {
  const text = serialize(w);
  const blob = new Blob([text], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  const d = new Date();
  const stamp = `${d.getFullYear()}${String(d.getMonth() + 1).padStart(2, '0')}${String(d.getDate()).padStart(2, '0')}-${String(d.getHours()).padStart(2, '0')}${String(d.getMinutes()).padStart(2, '0')}`;
  a.href = url;
  a.download = `jido-soko-save-${stamp}.json`;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

/** ファイルからセーブを読み込む */
export async function importSaveFile(file: File): Promise<LoadResult> {
  const text = await file.text();
  return deserialize(text);
}
