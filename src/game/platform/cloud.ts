/**
 * iCloud 同期（SPEC-iOS §3、I6）。ネイティブのキー値ストアにセーブを 1 本置く。
 * 方針: 端末のセーブが本体。クラウドは「他の端末から持ってくる」ためのもので、勝手に上書きはしない。
 * - 保存のたびに（60 秒に 1 回まで、背面に回るときは即）クラウドへ送る
 * - 起動時と、他の端末から届いたときに、クラウドのほうが新しければ「読み込みますか？」と聞く（UI 側）
 */
import { native } from './native';

const KEY = 'jido-soko-no-kibun:cloud';
/** これ以上クラウドが新しければ提案する（同じセーブの往復で聞かないための余裕） */
export const CLOUD_NEWER_MS = 2000;
const PUSH_INTERVAL_MS = 60_000;

export interface CloudSave {
  text: string;
  savedAt: number;
}

export function cloudEnabled(): boolean {
  try {
    const v = localStorage.getItem(KEY);
    return v === null ? true : v === '1';
  } catch {
    return true;
  }
}

export function setCloudEnabled(on: boolean): void {
  try {
    localStorage.setItem(KEY, on ? '1' : '0');
  } catch {
    /* ignore */
  }
}

/** iCloud にサインイン済みで使える状態か（Web 版や未サインインは false） */
export async function cloudAvailable(): Promise<boolean> {
  if (!native.available) return false;
  try {
    const r = await native.call<{ available: boolean }>('cloudStatus');
    return !!r.available;
  } catch {
    return false;
  }
}

export async function cloudLoad(): Promise<CloudSave | null> {
  if (!native.available || !cloudEnabled()) return null;
  try {
    const r = await native.call<{ data: string; savedAt: number } | null>('cloudLoad', {}, 30_000);
    if (!r || typeof r.data !== 'string' || !r.data) return null;
    return { text: r.data, savedAt: Number(r.savedAt) || 0 };
  } catch {
    return null;
  }
}

let lastPush = 0;
let pushedAt = 0;

/** クラウドへ送る（間引き）。force は背面に回るときなど。返り値: 送ったか */
export function cloudPush(text: string, savedAt: number, force = false): boolean {
  if (!native.available || !cloudEnabled()) return false;
  const now = Date.now();
  if (!force && now - lastPush < PUSH_INTERVAL_MS) return false;
  lastPush = now;
  pushedAt = savedAt;
  native.call('cloudSave', { data: text, savedAt }, 30_000).catch(() => {});
  return true;
}

/** 最後にこの端末から送ったセーブの時刻（自分の送ったものが戻ってきたときに提案しないため） */
export function lastPushedAt(): number {
  return pushedAt;
}

/** クラウドのセーブを提案するか: 端末より十分新しく、自分が送ったものでもない */
export function shouldOfferCloud(localSavedAt: number | null, cloudSavedAt: number, pushed = pushedAt): boolean {
  if (!cloudSavedAt) return false;
  if (cloudSavedAt === pushed) return false;
  return cloudSavedAt > (localSavedAt ?? 0) + CLOUD_NEWER_MS;
}

export function onCloudChanged(handler: (savedAt: number) => void): void {
  if (!native.available) return;
  native.on('cloudChanged', (p) => handler(Number((p as { savedAt?: number })?.savedAt) || 0));
}
