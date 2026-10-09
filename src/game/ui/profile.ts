/** プレイヤー全体の実績の記録（倉庫のセーブとは別。localStorage とネイティブの両方に保存。段は高い方を残す） */
import type { AchievementProfile } from '../sim/achievements';
import { native, nativeTry } from '../platform/native';

const KEY = 'jido-soko-no-kibun:profile';

interface ProfileFile {
  version: 1;
  achievements: AchievementProfile;
}

function parse(text: string | null): AchievementProfile | null {
  if (!text) return null;
  try {
    const f = JSON.parse(text) as Partial<ProfileFile>;
    return f && typeof f === 'object' && f.achievements && typeof f.achievements === 'object' ? f.achievements : null;
  } catch {
    return null;
  }
}

export function loadProfile(): AchievementProfile {
  try {
    return parse(localStorage.getItem(KEY)) ?? {};
  } catch {
    return {};
  }
}

export function saveProfile(p: AchievementProfile): void {
  const text = JSON.stringify({ version: 1, achievements: p } satisfies ProfileFile);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* ignore */
  }
  if (native.available) nativeTry('save', { key: KEY, data: text });
}

/** ネイティブ側の記録を取り込む（起動後に非同期。段は高い方） */
export async function syncNativeProfile(into: AchievementProfile): Promise<boolean> {
  if (!native.available) return false;
  try {
    const text = await native.call<string | null>('load', { key: KEY });
    const remote = parse(typeof text === 'string' ? text : null);
    if (!remote) return false;
    let changed = false;
    for (const [id, a] of Object.entries(remote)) {
      if ((into[id]?.tier ?? 0) < a.tier) {
        into[id] = a;
        changed = true;
      }
    }
    return changed;
  } catch {
    return false;
  }
}
