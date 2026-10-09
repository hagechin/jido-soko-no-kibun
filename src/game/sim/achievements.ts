/**
 * アチーブメント（★ SPEC-ACHIEVEMENTS.md）。定義は balance.ts の ACHIEVEMENTS。
 * 10 tick ごとに計測を更新して段を判定し、上がったら 'achievement' イベントを出す（UI がトーストにする）。
 * 計測はすべて sim 時間（tick）ベースなので倍速で早くはならない。
 */
import { ACHIEVEMENTS, AUTOMATION_TIERS_MIN, CALENDAR, JAM_STAGED_RATIO, MEDALS, REPUTATION, ROBOT, TICKS_PER_SECOND, type AchievementDef } from '../data/balance';
import { isDoubleDecker, isDrone } from './layers';
import type { WorldState } from './types';

/** 定義の id → 定義 */
export const ACHIEVEMENT_BY_ID: Readonly<Record<string, AchievementDef>> = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a]));

/** sim 分（tick → 分） */
function simMinutes(ticks: number): number {
  return ticks / TICKS_PER_SECOND / 60;
}

/** いまの値（定義の unit の単位） */
export function achievementValue(w: WorldState, id: string): number {
  const st = w.stats;
  switch (id) {
    case 'automation': {
      if (st.fullAutomationTick === null) return 0;
      const min = simMinutes(st.fullAutomationTick);
      return min <= AUTOMATION_TIERS_MIN.gold ? 3 : min <= AUTOMATION_TIERS_MIN.silver ? 2 : 1;
    }
    case 'weekly':
      return Math.max(st.weeklyShippedBest ?? 0, Object.values(st.shippedThisWeek).reduce((a, b) => a + b, 0));
    case 'shipped':
      return st.totalShipped;
    case 'distance':
      return (st.travelCells ?? 0) / 1000;
    case 'carried':
      return w.robots.reduce((a, r) => a + (r.carried ?? 0), 0);
    case 'coins':
      return st.totalCoins;
    case 'rank':
      return w.rank;
    case 'reputation': {
      const cur = st.rep100SinceTick === null ? 0 : w.tick - st.rep100SinceTick;
      return Math.max(st.rep100BestTicks ?? 0, cur) / CALENDAR.ticksPerMonth;
    }
    case 'cyber':
      return st.cyberWeekRecords.reduce((a, r) => Math.max(a, r.shipped), 0);
    case 'stacks':
      return w.stacks.length;
    case 'fleet':
      return w.robots.length;
    case 'trucks':
      return st.trucks;
    case 'special': {
      const drones = w.robots.filter((r) => isDrone(r)).length;
      const doubles = w.robots.filter((r) => isDoubleDecker(r)).length;
      if (drones >= ROBOT.maxDrones && doubles >= ROBOT.maxDrones) return 3;
      if (drones >= 1 && doubles >= 1) return 2;
      return drones >= 1 ? 1 : 0;
    }
    case 'hoarder':
      return st.queueMax ?? 0;
    case 'stockout':
      return st.stockouts;
    case 'late':
      return st.latePenalties ?? 0;
    case 'rockbottom':
      return st.reputationZeroCount ?? 0;
    case 'jam':
      return simMinutes(st.jamTicks ?? 0);
    case 'absent':
      return (st.offlineMsTotal ?? 0) / 86_400_000;
    default:
      return 0;
  }
}

/** 達した段（0 = まだ、1 = 銅 …） */
export function tierOf(def: AchievementDef, value: number): number {
  let t = 0;
  for (const tier of def.tiers) if (value >= tier.value) t++;
  return t;
}

/** プレイヤー全体の記録（倉庫が替わっても残る。UI が localStorage／ネイティブに保存） */
export type AchievementProfile = Record<string, { tier: number; at: number }>;

/** 倉庫の記録をプレイヤー全体の記録に取り込む（段の高い方）。変わったら true */
export function mergeProfile(profile: AchievementProfile, w: WorldState): boolean {
  if (w.sandbox || !w.achievements) return false;
  let changed = false;
  for (const [id, a] of Object.entries(w.achievements)) {
    if ((profile[id]?.tier ?? 0) < a.tier) {
      profile[id] = { tier: a.tier, at: Date.now() };
      changed = true;
    }
  }
  return changed;
}

export interface AchievementStatus {
  def: AchievementDef;
  value: number;
  tier: number;
  /** 次の段（全部達していれば null） */
  next: { value: number; label: string } | null;
  /** 次の段までの進み（0〜1。全部達していれば 1） */
  progress: number;
  medal: string | null;
}

/** 一覧用 */
export function achievementStatuses(w: WorldState, profile: AchievementProfile = {}): AchievementStatus[] {
  return ACHIEVEMENTS.map((def) => {
    const value = achievementValue(w, def.id);
    // 段はプレイヤー全体の記録も見る（サンドボックスの倉庫はその倉庫の記録だけ）
    const tier = Math.max(tierOf(def, value), w.achievements?.[def.id]?.tier ?? 0, w.sandbox ? 0 : (profile[def.id]?.tier ?? 0));
    const next = def.tiers[tier] ?? null;
    const prev = tier > 0 ? def.tiers[tier - 1].value : 0;
    const progress = next ? Math.min(1, Math.max(0, (value - prev) / (next.value - prev))) : 1;
    return { def, value, tier, next, progress, medal: tier > 0 ? MEDALS[Math.min(tier, MEDALS.length) - 1] : null };
  });
}

/** 値の表示（単位ごと） */
export function formatAchievementValue(def: AchievementDef, value: number): string {
  switch (def.unit) {
    case 'km':
      return `${value < 10 ? value.toFixed(1) : Math.round(value).toLocaleString('ja-JP')} km`;
    case 'coins':
      return `${Math.round(value).toLocaleString('ja-JP')} コイン`;
    case 'simMin':
      return value >= 60 ? `${(value / 60).toFixed(1)} 時間` : `${Math.round(value)} 分`;
    case 'calMonths':
      return value >= 12 ? `${(value / 12).toFixed(1)} 年` : `${value.toFixed(1)} か月`;
    case 'realDays':
      return value >= 1 ? `${value.toFixed(1)} 日` : `${(value * 24).toFixed(1)} 時間`;
    case 'rank':
      return `ランク ${Math.round(value) + 1}`;
    case 'step':
      return def.tiers[Math.min(def.tiers.length, Math.max(0, Math.round(value))) - 1]?.label ?? '未達成';
    default:
      return Math.round(value).toLocaleString('ja-JP');
  }
}

/** 10 tick ごとの計測（キューの最大・評判 100 の継続・渋滞・完全自動化の瞬間） */
function sampleStats(w: WorldState): void {
  const st = w.stats;
  st.queueMax = Math.max(st.queueMax ?? 0, w.orders.length);
  if (w.reputation >= REPUTATION.max) {
    if (st.rep100SinceTick === null || st.rep100SinceTick === undefined) st.rep100SinceTick = w.tick;
    st.rep100BestTicks = Math.max(st.rep100BestTicks ?? 0, w.tick - st.rep100SinceTick);
  } else st.rep100SinceTick = null;
  const ground = w.robots.filter((r) => r.kind === 'amr' && !isDrone(r));
  if (ground.length >= 2) {
    const staged = ground.filter((r) => (r.job?.type === 'fetch' || r.job?.type === 'deliver') && r.job.staged).length;
    if (staged >= ground.length * JAM_STAGED_RATIO) st.jamTicks = (st.jamTicks ?? 0) + 10;
  }
  const a = w.automation;
  if ((st.fullAutomationTick === null || st.fullAutomationTick === undefined) && a.dispatch >= 3 && a.restock && a.relocate) st.fullAutomationTick = w.tick;
}

/** 段が上がった実績を記録してイベントを出す（silent なら記録だけ。古いセーブの移行用） */
function settle(w: WorldState, silent: boolean): void {
  if (!w.achievements) w.achievements = {};
  for (const def of ACHIEVEMENTS) {
    const tier = tierOf(def, achievementValue(w, def.id));
    const had = w.achievements[def.id]?.tier ?? 0;
    if (tier > had) {
      w.achievements[def.id] = { tier, at: w.tick };
      // サンドボックスのプリセット倉庫ではトーストを出さない（読み込むたびに同じ実績が出るので）
      if (!silent && !w.sandbox) w.events.push({ type: 'achievement', id: def.id, tier });
    }
  }
}

/** 毎 10 tick */
export function updateAchievements(w: WorldState): void {
  sampleStats(w);
  settle(w, false);
}

/** 古いセーブの移行: すでに達している段をトーストなしで記録 */
export function initAchievementsSilently(w: WorldState): void {
  settle(w, true);
}
