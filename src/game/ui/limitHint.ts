/** 通常の上限に達したとき、上限突破パック（iOS）の案内を付ける（持っていれば何も付けない） */
import { hasFeature } from '../platform/entitlements';
import { native } from '../platform/native';

/** 特別ロボパック（iOS）を持っていないときの案内 */
export function specialRobotsHint(): string {
  if (hasFeature('specialRobots')) return '';
  return native.available ? '。特別ロボパック（設定 → 追加機能 → ストア）で解放' : '。iOS 版の特別ロボパックで解放';
}

export function limitHint(atCap: boolean, what: string): string {
  if (!atCap || hasFeature('limits')) return '';
  return native.available ? `。上限突破パック（設定 → 追加機能 → ストア）で ${what}` : `。iOS 版の上限突破パックで ${what}`;
}
