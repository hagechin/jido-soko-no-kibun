/**
 * プレイヤー全体の記録（倉庫のセーブとは別。localStorage とネイティブの両方に保存）。
 *  - 実績の段（高い方を残す）
 *  - 1.2: 取引先の信用（大きい方を残す）、コインで買った見た目（和集合）、通知を聞いたかどうか
 */
import type { AchievementProfile } from '../sim/achievements';
import { native, nativeTry } from '../platform/native';

const KEY = 'jido-soko-no-kibun:profile';

/** 1.2 で足した、実績以外の記録 */
export interface PlayerRecord {
  /** 取引先の信用: 取引先 id → 信用 */
  trust: Record<string, number>;
  /** コインで買った見た目（cosmetics.ts の ownedKey） */
  owned: string[];
  /** 通知の案内を出した（1 度だけ聞く） */
  notifyAsked?: boolean;
}

interface ProfileFile {
  version: 1;
  achievements: AchievementProfile;
  trust?: Record<string, number>;
  owned?: string[];
  notifyAsked?: boolean;
}

function parseFile(text: string | null): ProfileFile | null {
  if (!text) return null;
  try {
    const f = JSON.parse(text) as Partial<ProfileFile>;
    if (!f || typeof f !== 'object') return null;
    const achievements = f.achievements && typeof f.achievements === 'object' ? f.achievements : {};
    const trust: Record<string, number> = {};
    if (f.trust && typeof f.trust === 'object') for (const [k, v] of Object.entries(f.trust)) if (typeof v === 'number' && Number.isFinite(v) && v > 0) trust[k] = v;
    const owned = Array.isArray(f.owned) ? f.owned.filter((x): x is string => typeof x === 'string') : [];
    return { version: 1, achievements, trust, owned, notifyAsked: f.notifyAsked === true };
  } catch {
    return null;
  }
}

/** いまの記録（起動時に 1 度読み、以降は同じものを書き換えて保存する） */
let achievements: AchievementProfile | null = null;
const player: PlayerRecord = { trust: {}, owned: [] };

function ensureLoaded(): AchievementProfile {
  if (achievements) return achievements;
  let f: ProfileFile | null = null;
  try {
    f = parseFile(localStorage.getItem(KEY));
  } catch {
    f = null;
  }
  achievements = f?.achievements ?? {};
  player.trust = f?.trust ?? {};
  player.owned = f?.owned ?? [];
  player.notifyAsked = f?.notifyAsked;
  return achievements;
}

function write(): void {
  const text = JSON.stringify({ version: 1, achievements: ensureLoaded(), trust: player.trust, owned: player.owned, notifyAsked: player.notifyAsked } satisfies ProfileFile);
  try {
    localStorage.setItem(KEY, text);
  } catch {
    /* ignore */
  }
  if (native.available) nativeTry('save', { key: KEY, data: text });
}

export function loadProfile(): AchievementProfile {
  return ensureLoaded();
}

export function saveProfile(p: AchievementProfile): void {
  achievements = p;
  write();
}

/** 取引先の信用と持っている見た目（書き換えたら savePlayer） */
export function playerRecord(): PlayerRecord {
  ensureLoaded();
  return player;
}

export function savePlayer(): void {
  write();
}

/** ネイティブ側の記録を取り込む（起動後に非同期。段・信用は高い方、見た目は和集合）。変わったら true */
export async function syncNativeProfile(into: AchievementProfile): Promise<boolean> {
  if (!native.available) return false;
  try {
    const text = await native.call<string | null>('load', { key: KEY });
    const remote = parseFile(typeof text === 'string' ? text : null);
    if (!remote) return false;
    ensureLoaded();
    let changed = false;
    for (const [id, a] of Object.entries(remote.achievements)) {
      if ((into[id]?.tier ?? 0) < a.tier) {
        into[id] = a;
        changed = true;
      }
    }
    for (const [id, t] of Object.entries(remote.trust ?? {})) {
      if ((player.trust[id] ?? 0) < t) {
        player.trust[id] = t;
        changed = true;
      }
    }
    for (const k of remote.owned ?? []) {
      if (!player.owned.includes(k)) {
        player.owned.push(k);
        changed = true;
      }
    }
    if (remote.notifyAsked && !player.notifyAsked) {
      player.notifyAsked = true;
      changed = true;
    }
    return changed;
  } catch {
    return false;
  }
}
