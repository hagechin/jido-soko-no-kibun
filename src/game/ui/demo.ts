/**
 * デモ用のセーブ（スクリーンショット・ストア審査のデモ用、I7）。
 * `?demo`（Web）または起動引数 `-demo`（iOS）で、メガDC のプリセットに特別ロボを足した状態をセーブに書き込んでから起動する。
 * 機能解放の上書き（localStorage `features = all`）も一緒に入れる（審査用のデモ端末だけで使う）
 */
import { SAVE } from '../data/balance';
import { buildPreset } from '../sim/presets';
import { initAchievementsSilently } from '../sim/achievements';
import { serialize } from '../sim/save';
import { addRobot } from '../sim/world';
import { setLimitsExpanded } from '../sim/limits';
import { native, nativeTry } from '../platform/native';

export function isDemoRequested(): boolean {
  if (typeof location !== 'undefined' && /[?&]demo\b/.test(location.search)) return true;
  return !!(native.info as { demo?: boolean } | null)?.demo;
}

export function installDemoSave(): void {
  setLimitsExpanded(true);
  const w = buildPreset('mega', { seed: 20261008 });
  w.coins = 48_200;
  w.reputation = 92;
  // 特別ロボ: ドローン 3 台（待機スポット）、ダブルデッカー 2 台（空いているスタック）
  const occ = new Set(w.robots.map((r) => `${r.pose.x},${r.pose.z}`));
  let n = 0;
  for (const s of w.waitSpots) {
    if (n >= 3) break;
    const d = addRobot(w, 'amr', s.x, s.z, 'drone');
    d.speedLevel = 2; // 地上ロボと同じ Lv（飛行の +1 で実効 Lv3）
    n++;
  }
  n = 0;
  for (const s of w.stacks) {
    if (n >= 2) break;
    if (occ.has(`${s.x},${s.z}`)) continue;
    occ.add(`${s.x},${s.z}`);
    const r = addRobot(w, 'shelf', s.x, s.z, 'double');
    r.liftLevel = 2;
    r.speedLevel = 2;
    n++;
  }
  // デモの倉庫はふつうのセーブとして扱う: 実績の一覧に「サンドボックスのプリセット倉庫では…」の注記を出さず（ストア用の画像に写っていた。第 40 回）、
  // 1.2 の取引先の依頼も届く。すでに達している実績は、起動時にトーストが並ばないよう静かに記録しておく
  w.sandbox = false;
  const a = w.automation;
  if (a.dispatch >= 3 && a.restock && a.relocate) w.stats.fullAutomationTick = w.tick; // 最初の計測で「完全自動化」のトーストが出ないように
  initAchievementsSilently(w);
  const text = serialize(w);
  try {
    localStorage.setItem(SAVE.key, text);
    localStorage.setItem('jido-soko-no-kibun:features', 'all');
  } catch {
    /* ignore */
  }
  if (native.available) nativeTry('save', { key: SAVE.key, data: text });
}
