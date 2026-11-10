/**
 * お知らせの通知（1.2、SPEC-1.2 §5）。iOS アプリだけ。端末内のローカル通知で、サーバーは使わない。
 *  - 設定は localStorage（'on' / 'off'。未設定は「まだ聞いていない」）
 *  - 予約は毎回まるごと入れ替える（Swift 側で前の予約を消してから入れる）。繰り返しは使わない:
 *    開かないまま日が過ぎても、最後に予約したぶんが 1 回ずつ出るだけ
 *  - アプリが前面にいる間に時刻が来た通知は OS が出さない（デリゲートを置いていない）ので、前面でも予約を更新してよい
 */
import { native, nativeTry } from '../platform/native';

const KEY = 'jido-soko-no-kibun:notify';

export type NotifyStatus = 'unsupported' | 'notDetermined' | 'authorized' | 'denied';

export interface NotifyItem {
  id: string;
  title: string;
  body: string;
  /** いまから何秒後に出すか */
  inSec: number;
}

export function notifySupported(): boolean {
  return native.available;
}

export function notifySetting(): 'on' | 'off' | null {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'on' || v === 'off' ? v : null;
  } catch {
    return null;
  }
}

export function setNotifySetting(v: 'on' | 'off'): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
  if (v === 'off') nativeTry('notifyCancel');
}

/** OS の許可の状態 */
export async function notifyStatus(): Promise<NotifyStatus> {
  if (!native.available) return 'unsupported';
  try {
    const r = await native.call<{ status: string }>('notifyStatus');
    return r.status === 'authorized' || r.status === 'denied' ? r.status : 'notDetermined';
  } catch {
    return 'unsupported';
  }
}

/** 通知をオンにする: OS の許可を取り（初回はダイアログ）、取れたら設定を on に。取れなければ false */
export async function enableNotifications(): Promise<boolean> {
  if (!native.available) return false;
  try {
    const r = await native.call<{ granted: boolean }>('notifyRequest', {}, 5 * 60_000);
    if (!r.granted) return false;
    setNotifySetting('on');
    return true;
  } catch {
    return false;
  }
}

/** 予約を入れ替える（設定がオンのときだけ。出し終えた通知も消す） */
export function scheduleNotifications(items: NotifyItem[]): void {
  if (!native.available || notifySetting() !== 'on') return;
  nativeTry('notifySchedule', { items: items.filter((i) => i.inSec >= 60).map((i) => ({ ...i, inSec: Math.round(i.inSec) })) });
}

/** いまから翌朝のその時刻までの秒数（端末の現地時刻） */
export function secondsUntilTomorrow(hour: number, now = new Date()): number {
  const t = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, hour, 0, 0, 0);
  return Math.max(0, Math.round((t.getTime() - now.getTime()) / 1000));
}
