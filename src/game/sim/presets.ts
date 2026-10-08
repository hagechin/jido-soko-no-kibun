/**
 * デモ・デバッグ用のプリセット倉庫（★）。
 * レイアウトはプログラムで生成し、在庫・ロボ・アップグレード・自動化をまとめて設定する。
 */
import { ITEMS } from '../data/items';
import { LEVELS, ORDERS, RANKS } from '../data/balance';
import { createRng, rand, randInt } from './rng';
import { addRobot, createBin, createWorld } from './world';
import { reservedSlots } from './shop';
import type { WorldState } from './types';
import { limitsFor } from './limits';
import { tr } from '../i18n';

export type PresetId = 'initial' | 'medium' | 'mega';

export const PRESETS: { id: PresetId; name: string; desc: string }[] = [
  { id: 'initial', name: tr('初期の倉庫'), desc: tr('16×12、スタック 12、ロボ 2 台（ゲーム開始時と同じ）') },
  { id: 'medium', name: tr('地域の倉庫（中規模）'), desc: tr('24×12、スタック 2 ブロック、ポート 2、ロボ 8 台、段数 3、配車AI Lv2＋補充AI') },
  { id: 'mega', name: tr('メガDC'), desc: tr('40×24、棚 30×12（360 スタック）、ポート 14、ロボ 28 台、段数 6、全 AI、24 商品') },
];

interface Grid {
  w: number;
  h: number;
  cells: string[][];
}

function grid(w: number, h: number): Grid {
  return { w, h, cells: Array.from({ length: h }, () => Array.from({ length: w }, () => '.')) };
}
function rect(g: Grid, x: number, z: number, w: number, h: number, ch: string): void {
  for (let dz = 0; dz < h; dz++) for (let dx = 0; dx < w; dx++) g.cells[z + dz][x + dx] = ch;
}
function put(g: Grid, x: number, z: number, ch: string): void {
  g.cells[z][x] = ch;
}
function rows(g: Grid): string[] {
  return g.cells.map((r) => r.join(''));
}

/** 中規模: 16×12 を東へ 8 マス広げ、スタックを 10×3 の 1 ブロック（レールは 1 つにつながっている必要がある）に */
export function mediumLayout(): string[] {
  const g = grid(24, 12);
  rect(g, 3, 2, 10, 3, 'S');
  put(g, 13, 3, 'P'); // 東側
  put(g, 7, 5, 'P'); // 南側
  put(g, 19, 2, 'K');
  put(g, 19, 5, 'K');
  put(g, 19, 8, 'K');
  put(g, 23, 3, 'o');
  put(g, 23, 4, 'o');
  put(g, 0, 8, 'i');
  put(g, 0, 9, 'i');
  put(g, 3, 8, 'I');
  for (let x = 8; x < 16; x++) put(g, x, 9, 'W');
  return rows(g);
}

/** メガDC: 40×24。30×12 の棚 1 バンドを通路が囲み、北・南・東・西にポート 16。ピッカーは東、入荷は西 */
export function megaLayout(): string[] {
  const g = grid(40, 24);
  rect(g, 3, 4, 30, 12, 'S'); // 棚バンド (x 3..32, z 4..15)
  for (const x of [5, 10, 15, 20, 25, 29]) {
    put(g, x, 3, 'P'); // 北側（通路 z 0..2）
    put(g, x, 16, 'P'); // 南側（通路 z 17..23）
  }
  for (const z of [6, 13]) put(g, 33, z, 'P'); // 東側（ピッカー寄り）
  // ピッキングステーション（東側の列）
  for (const z of [2, 5, 8, 11, 14, 17, 20]) put(g, 36, z, 'K');
  // 出荷口（東壁）
  for (const z of [9, 10, 11, 12]) put(g, 39, z, 'o');
  // 入荷口（西壁）と入荷ステーション
  for (const z of [9, 10, 11, 12]) put(g, 0, z, 'i');
  put(g, 1, 6, 'I');
  put(g, 1, 15, 'I');
  // 待機スポット（南端）
  for (let x = 8; x < 32; x++) put(g, x, 22, 'W');
  return rows(g);
}

export interface PresetOptions {
  seed?: number;
}

/** プリセットの倉庫を作る。コインは十分に持たせる */
export function buildPreset(id: PresetId, opts: PresetOptions = {}): WorldState {
  const seed = opts.seed ?? 777;
  if (id === 'initial') return createWorld({ seed });
  const rng = createRng(seed + 1);
  const mega = id === 'mega';
  const rank = mega ? RANKS.length - 1 : 2;
  const kinds = ORDERS.itemKindsByRank[rank];
  const w = createWorld({ seed, layout: mega ? megaLayout() : mediumLayout(), itemKinds: kinds });
  w.rank = rank;
  w.levels = mega ? 6 : 3;
  w.levels = Math.min(w.levels, limitsFor(w).maxLevels, RANKS[rank].maxLevels);
  w.binCapacity = mega ? 40 : 30;
  w.expansions = mega ? 6 : 2;
  w.coins = mega ? 50_000 : 5_000;
  w.reputation = mega ? 90 : 70;
  w.stats.totalShipped = RANKS[rank].shipped;
  w.automation = { dispatch: mega ? 3 : 2, restock: true, relocate: mega, amrPriority: 'balanced', lastRetrieveTick: 0 };

  // ロボを増やす（既定の 1+1 に追加）
  const shelfTarget = mega ? 12 : 3;
  const amrTarget = mega ? 16 : 5;
  const occ = new Set(w.robots.map((r) => `${r.pose.x},${r.pose.z}`));
  const stacks = [...w.stacks];
  for (let i = w.robots.filter((r) => r.kind === 'shelf').length; i < shelfTarget; i++) {
    const s = stacks.find((s) => !occ.has(`${s.x},${s.z}`) && !w.ports.some((p) => Math.abs(p.x - s.x) + Math.abs(p.z - s.z) === 1));
    if (!s) break;
    occ.add(`${s.x},${s.z}`);
    addRobot(w, 'shelf', s.x, s.z);
  }
  for (let i = w.robots.filter((r) => r.kind === 'amr').length; i < amrTarget; i++) {
    const spot = w.waitSpots.find((s) => !occ.has(`${s.x},${s.z}`));
    if (!spot) break;
    occ.add(`${spot.x},${spot.z}`);
    const r = addRobot(w, 'amr', spot.x, spot.z);
    // 1×2 は尾が南（z+1）に出る向きで置き、その床も占有扱いにする
    const tail = `${spot.x},${spot.z + 1}`;
    if (mega && i % 3 === 0 && spot.z + 1 < w.height && w.cells[(spot.z + 1) * w.width + spot.x] === 'floor' && !occ.has(tail)) {
      r.cargoLevel = 1;
      r.pose.dir = 3;
      occ.add(tail);
    }
    r.speedLevel = mega ? 2 : 1;
  }
  for (const r of w.robots) {
    if (r.kind === 'shelf') r.liftLevel = mega ? 2 : 1;
    if (mega) r.speedLevel = Math.max(r.speedLevel, 2);
  }
  for (const s of w.stations) if (s.kind === 'pick') s.level = mega ? 2 : 1;

  // 在庫: 各スタックに段数いっぱい近くまでビンを積む（掘り出し用の空きは残す）
  const items = ITEMS.slice(0, kinds).map((i) => i.id);
  const reserve = reservedSlots(w);
  let slotsLeft = w.stacks.length * w.levels - Object.keys(w.bins).length - reserve;
  for (const s of w.stacks) {
    const target = Math.max(1, w.levels - 1);
    while (s.bins.length < target && slotsLeft > 0) {
      const item = items[Math.floor(rand(rng) * items.length)];
      const empty = rand(rng) < 0.1;
      s.bins.push(createBin(w, empty ? null : item, empty ? 0 : randInt(rng, Math.floor(w.binCapacity * 0.3), w.binCapacity)).id);
      slotsLeft--;
    }
  }
  // 担当を均等に割り当て直す
  const pickers = w.stations.filter((s) => s.kind === 'pick');
  for (const p of pickers) p.assignedItems = [];
  items.forEach((item, i) => pickers[i % pickers.length].assignedItems.push(item));
  return w;
}
