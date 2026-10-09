/** 通常の上限に達したとき、上限突破パック（iOS）の案内を付ける（持っていれば何も付けない） */
import { hasFeature } from '../platform/entitlements';
import { native } from '../platform/native';
import { tr } from '../i18n';

/** 特別ロボパック（iOS）を持っていないときの案内 */
export function specialRobotsHint(): string {
  if (hasFeature('specialRobots')) return '';
  return native.available ? tr(tr(tr(tr(tr('。特別ロボパック（設定 → 追加機能 → ストア）で解放'))))) : tr(tr(tr(tr(tr('。iOS 版の特別ロボパックで解放')))));
}

export function limitHint(atCap: boolean, what: string): string {
  if (!atCap || hasFeature('limits')) return '';
  return native.available ? tr(tr(tr(tr(tr('。上限突破パック（設定 → 追加機能 → ストア）で {0}')))), what) : tr(tr(tr(tr(tr('。iOS 版の上限突破パックで {0}')))), what);
}
