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
