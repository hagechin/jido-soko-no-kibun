/** localStorage のセーブ（§11.2）。失敗しても例外を外に出さない */
import { SAVE } from '../data/balance';
import { deserialize, serialize, type LoadResult } from '../sim/save';
import type { WorldState } from '../sim/types';

export function saveToStorage(w: WorldState): boolean {
  try {
    localStorage.setItem(SAVE.key, serialize(w));
    return true;
  } catch {
    return false;
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
