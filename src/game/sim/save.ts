/**
 * セーブ／ロード（§11.2）。純粋関数のみ（localStorage は ui 側）。
 * state は丸ごと JSON。version を見て移行する。
 */
import { SAVE } from '../data/balance';
import { createWorld } from './world';
import { rehomeOrphans } from './integrity';
import { initAchievementsSilently } from './achievements';
import type { WorldState } from './types';

export interface SaveFile {
  version: number;
  savedAt: number; // 実時間 ms（放置計算 §10.2 用）
  world: WorldState;
}

export function serialize(w: WorldState, savedAt = Date.now()): string {
  const file: SaveFile = { version: SAVE.version, savedAt, world: w };
  return JSON.stringify(file);
}

export type LoadResult = { ok: true; world: WorldState; savedAt: number; migrated: boolean } | { ok: false; reason: string };

export function deserialize(text: string): LoadResult {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, reason: 'セーブデータを読めません（JSON ではない）' };
  }
  if (!raw || typeof raw !== 'object') return { ok: false, reason: 'セーブデータの形式が違います' };
  const file = raw as Partial<SaveFile>;
  if (typeof file.version !== 'number' || !file.world) return { ok: false, reason: 'セーブデータに version がありません' };
  if (file.version > SAVE.version) return { ok: false, reason: '新しいバージョンのセーブデータです' };
  let world = file.world;
  let migrated = false;
  if (file.version < SAVE.version) {
    world = migrate(world, file.version);
    migrated = true;
  }
  const check = validate(world);
  if (check) return { ok: false, reason: check };
  world.version = SAVE.version;
  // 実行時に作り直すもの
  world.events = [];
  world.flags = { ...createWorld().flags, ...world.flags };
  rehomeOrphans(world); // 行方不明のビンがあれば棚に戻す（読み込み直後にお知らせが出る）
  return { ok: true, world, savedAt: file.savedAt ?? Date.now(), migrated };
}

/** 旧バージョンからの移行。新しいフィールドは初期状態から補う */
export function migrate(world: WorldState, _from: number): WorldState {
  const fresh = createWorld();
  const out = { ...fresh, ...world } as WorldState;
  out.stats = { ...fresh.stats, ...(world.stats ?? {}) };
  out.automation = { ...fresh.automation, ...(world.automation ?? {}) };
  out.season = { ...fresh.season, ...(world.season ?? {}) };
  out.nextIds = { ...fresh.nextIds, ...(world.nextIds ?? {}) };
  out.trucks = world.trucks ?? [];
  out.pallets = world.pallets ?? [];
  // 古いセーブ: すでに達している実績はトーストを出さずに記録する
  if (!world.achievements) initAchievementsSilently(out);
  return out;
}

function validate(w: WorldState): string | null {
  if (!Array.isArray(w.cells) || !Array.isArray(w.robots) || !Array.isArray(w.stacks)) return 'セーブデータが壊れています';
  if (w.cells.length !== w.width * w.height) return 'セーブデータの倉庫サイズが不正です';
  if (typeof w.tick !== 'number') return 'セーブデータの時刻が不正です';
  return null;
}
