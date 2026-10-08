/**
 * 建設モード（§8）と面積拡張（§9.4）。
 * 配置ルール: ポートは棚エリアに隣接、ステーションは床に面する、スタックはレール（棚かポート）に隣接。
 * 撤去は無料、配置は有料。ロボが乗っているセルは触れない。
 */
import { BUILD, EXPANSION, GRID, RANKS } from '../data/balance';
import { price } from './pricing';
import type { CellKind } from '../data/balance';
import { approachCells, cellAt, inBounds, isAdjacentToStack, isFacingFloor, isFloorWalkable, isRailWalkable, neighbors4 } from './grid';
import { footprint } from './footprint';
import { isDrone, shapeOf } from './layers';
import { createBin, placeCell, removeCell } from './world';
import type { WorldState } from './types';
import { limitsFor } from './limits';
import { tr } from '../i18n';

export type BuildKind = 'stack' | 'port' | 'pickStation' | 'inboundStation' | 'waitSpot';
export type BuildResult = { ok: true } | { ok: false; reason: string };

export const BUILD_COST: Record<BuildKind, number> = {
  stack: BUILD.stackCost,
  port: BUILD.portCost,
  pickStation: BUILD.pickStationCost,
  inboundStation: BUILD.inboundStationCost,
  waitSpot: BUILD.waitSpotCost,
};

/** 経済モードを掛けた建設費 */
export function buildCost(w: Pick<WorldState, 'economy'>, kind: BuildKind): number {
  return price(w, BUILD_COST[kind]);
}

export const BUILD_LABEL: Record<BuildKind, string> = {
  stack: tr(tr(tr('スタック'))),
  port: tr(tr(tr('ポート'))),
  pickStation: tr(tr(tr('ピッキングST'))),
  inboundStation: tr(tr(tr('入荷ST'))),
  waitSpot: tr(tr(tr('待機スポット'))),
};

function robotOn(w: WorldState, x: number, z: number): boolean {
  for (const r of w.robots) {
    if (isDrone(r)) continue; // 空中なので建設の邪魔にならない
    const shape = shapeOf(r);
    const cells = footprint(r.pose, shape, []);
    if (r.moveTo) cells.push(...footprint(r.moveTo, shape, []));
    if (cells.some((c) => c.x === x && c.z === z)) return true;
  }
  return false;
}

/** レール（棚＋ポート）が 1 つにつながっているか */
export function railConnected(w: WorldState, ignore?: { x: number; z: number }): boolean {
  const rail = (x: number, z: number) => !(ignore && ignore.x === x && ignore.z === z) && isRailWalkable(cellAt(w, x, z));
  let start: { x: number; z: number } | null = null;
  let total = 0;
  for (let z = 0; z < w.height; z++)
    for (let x = 0; x < w.width; x++)
      if (rail(x, z)) {
        total++;
        if (!start) start = { x, z };
      }
  if (!start) return true;
  const seen = new Set<string>([`${start.x},${start.z}`]);
  const q = [start];
  while (q.length) {
    const c = q.pop()!;
    for (const n of neighbors4(w, c.x, c.z)) {
      const k = `${n.x},${n.z}`;
      if (seen.has(k) || !rail(n.x, n.z)) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen.size === total;
}

/** 配置できるか。null なら OK、文字列は理由 */
export function canPlace(w: WorldState, kind: BuildKind, x: number, z: number, free = false): string | null {
  if (!inBounds(w, x, z)) return tr(tr(tr('倉庫の外です')));
  const cur = cellAt(w, x, z);
  if (cur !== 'floor') return tr(tr(tr('そこには何かがあります')));
  if (robotOn(w, x, z)) return tr(tr(tr('ロボがいます')));
  if (!free && w.coins < buildCost(w, kind)) return tr(tr(tr('コインが足りません（{0} 必要）')), buildCost(w, kind));
  // 床でなくなるものを置くとき、隣のポート／ステーションが床に面しなくなる（搬送ロボが横付けできなくなる）なら拒否。
  // 床の通路が分断される（袋小路の島ができて、そこにしか面していないポートへ行けなくなる）置き方も拒否
  if (kind !== 'waitSpot') {
    if (wouldDisconnectFloor(w, x, z)) return tr(tr(tr('床の通路が分断されます（搬送ロボが通れない場所ができる）')));
    for (const p of w.ports) if (approachCells(w, p.x, p.z).some((c) => c.x === x && c.z === z) && approachCells(w, p.x, p.z).length <= 1) return tr(tr(tr('ポートが床に面しなくなります（搬送ロボが横付けできません）')));
    for (const s of w.stations) if (approachCells(w, s.x, s.z).some((c) => c.x === x && c.z === z) && approachCells(w, s.x, s.z).length <= 1) return tr(tr(tr('ステーションが床に面しなくなります（搬送ロボが横付けできません）')));
  }
  switch (kind) {
    case 'port':
      if (!isAdjacentToStack(w, x, z)) return tr(tr(tr('ポートは棚（スタック）に隣接させてください')));
      if (!isFacingFloor(w, x, z)) return tr(tr(tr('ポートは床にも面している必要があります')));
      break;
    case 'pickStation':
    case 'inboundStation':
      if (!isFacingFloor(w, x, z)) return tr(tr(tr('ステーションは床に面している必要があります')));
      break;
    case 'stack': {
      const hasRail = w.stacks.length + w.ports.length > 0;
      const adj = neighbors4(w, x, z).some((n) => isRailWalkable(cellAt(w, n.x, n.z)));
      if (hasRail && !adj) return tr(tr(tr('スタックは他のスタックかポートに隣接させてください')));
      break;
    }
    case 'waitSpot':
      break;
  }
  return null;
}

/** (x,z) を床でなくしたとき、床（搬送ロボが通れるマス）が 2 つ以上の島に分かれるか */
export function wouldDisconnectFloor(w: WorldState, x: number, z: number): boolean {
  const walk = (cx: number, cz: number) => !(cx === x && cz === z) && inBounds(w, cx, cz) && isFloorWalkable(cellAt(w, cx, cz));
  let total = 0;
  let start: { x: number; z: number } | null = null;
  for (let cz = 0; cz < w.height; cz++) {
    for (let cx = 0; cx < w.width; cx++) {
      if (!walk(cx, cz)) continue;
      total++;
      if (!start) start = { x: cx, z: cz };
    }
  }
  if (!start) return false;
  const seen = new Set<number>([start.z * w.width + start.x]);
  const queue = [start];
  for (let head = 0; head < queue.length; head++) {
    const c = queue[head];
    for (const n of neighbors4(w, c.x, c.z)) {
      const k = n.z * w.width + n.x;
      if (seen.has(k) || !walk(n.x, n.z)) continue;
      seen.add(k);
      queue.push(n);
    }
  }
  return seen.size < total;
}

export function place(w: WorldState, kind: BuildKind, x: number, z: number, free = false): BuildResult {
  const why = canPlace(w, kind, x, z, free);
  if (why) return { ok: false, reason: why };
  if (!free) w.coins -= buildCost(w, kind);
  placeCell(w, x, z, kind as CellKind);
  if (kind === 'stack' && !free) {
    // 「スタック 1 基（空ビン付き）」§9.4
    const st = w.stacks.find((s) => s.x === x && s.z === z);
    if (st) st.bins.push(createBin(w, null, 0).id);
  }
  return { ok: true };
}

export function canRemove(w: WorldState, x: number, z: number): string | null {
  if (!inBounds(w, x, z)) return tr(tr(tr('倉庫の外です')));
  const cur = cellAt(w, x, z);
  if (cur === 'floor') return tr(tr(tr('何もありません')));
  if (cur === 'inboundDock' || cur === 'outboundDock') return tr(tr(tr('入荷口・出荷口は動かせません')));
  if (robotOn(w, x, z)) return tr(tr(tr('ロボが乗っています')));
  if (cur === 'stack') {
    const s = w.stacks.find((s) => s.x === x && s.z === z);
    if (s && s.bins.length) return tr(tr(tr('ビンが入っているスタックは撤去できません（先に空にする）')));
    if (!railConnected(w, { x, z })) return tr(tr(tr('撤去するとレールが分断されます')));
    // 撤去後も各ポートがどこかのスタックに隣接していること
    const portOrphaned = w.ports.some((p) => !neighbors4(w, p.x, p.z).some((n) => cellAt(w, n.x, n.z) === 'stack' && !(n.x === x && n.z === z)));
    if (portOrphaned) return tr(tr(tr('ポートが棚から離れてしまいます')));
  }
  if (cur === 'port') {
    const p = w.ports.find((p) => p.x === x && p.z === z);
    if (p && (p.outbound.length || p.returns.length)) return tr(tr(tr('ビンが置かれているポートは撤去できません')));
    if (w.ports.length <= 1) return tr(tr(tr('最後のポートは撤去できません')));
    if (!railConnected(w, { x, z })) return tr(tr(tr('撤去するとレールが分断されます')));
  }
  if (cur === 'pickStation') {
    const s = w.stations.find((s) => s.x === x && s.z === z);
    if (s?.work) return tr(tr(tr('作業中のステーションは撤去できません')));
    if (w.stations.filter((s) => s.kind === 'pick').length <= 1) return tr(tr(tr('最後のピッキングステーションは撤去できません')));
  }
  if (cur === 'inboundStation') {
    const s = w.stations.find((s) => s.x === x && s.z === z);
    if (s?.work) return tr(tr(tr('作業中のステーションは撤去できません')));
    if (w.stations.filter((s) => s.kind === 'inbound').length <= 1) return tr(tr(tr('最後の入荷ステーションは撤去できません')));
  }
  return null;
}

/** 撤去（無料）。ピッカーの担当は他のピッカーへ引き継ぐ */
export function remove(w: WorldState, x: number, z: number): BuildResult {
  const why = canRemove(w, x, z);
  if (why) return { ok: false, reason: why };
  const st = w.stations.find((s) => s.x === x && s.z === z);
  const orphan = st?.kind === 'pick' ? [...st.assignedItems] : [];
  const ok = removeCell(w, x, z);
  if (!ok) return { ok: false, reason: tr(tr(tr('撤去できませんでした'))) };
  if (orphan.length) {
    const other = w.stations.find((s) => s.kind === 'pick');
    if (other) other.assignedItems.push(...orphan);
  }
  // 消えた設備を指していた仕事は各ロボが次の tick で自然に終了する
  return { ok: true };
}

/** 移動（無料）: 撤去して置き直す。スタックは中のビンごと動く */
export function move(w: WorldState, fromX: number, fromZ: number, toX: number, toZ: number): BuildResult {
  const kind = cellAt(w, fromX, fromZ);
  if (!kind || kind === 'floor' || kind === 'inboundDock' || kind === 'outboundDock') return { ok: false, reason: tr(tr(tr('動かせるものがありません'))) };
  if (fromX === toX && fromZ === toZ) return { ok: true };
  if (robotOn(w, fromX, fromZ)) return { ok: false, reason: tr(tr(tr('ロボが乗っています'))) };
  const bk = kind as BuildKind;
  // 置き直せるか先に確認（元のセルを床にした状態で判定）
  const stack = w.stacks.find((s) => s.x === fromX && s.z === fromZ);
  const port = w.ports.find((p) => p.x === fromX && p.z === fromZ);
  const station = w.stations.find((s) => s.x === fromX && s.z === fromZ);
  if (port && (port.outbound.length || port.returns.length)) return { ok: false, reason: tr(tr(tr('ビンが置かれているポートは動かせません'))) };
  if (station?.work) return { ok: false, reason: tr(tr(tr('作業中のステーションは動かせません'))) };
  const saved = w.cells[fromZ * w.width + fromX];
  w.cells[fromZ * w.width + fromX] = 'floor';
  const why = canPlace(w, bk, toX, toZ, true);
  if (!why && (bk === 'stack' || bk === 'port')) {
    // 移動後もレールがつながっているか
    w.cells[toZ * w.width + toX] = bk;
    const connected = railConnected(w);
    w.cells[toZ * w.width + toX] = 'floor';
    if (!connected) {
      w.cells[fromZ * w.width + fromX] = saved;
      return { ok: false, reason: tr(tr(tr('移動するとレールが分断されます'))) };
    }
  }
  w.cells[fromZ * w.width + fromX] = saved;
  if (why) return { ok: false, reason: why };
  // 実体を動かす（ID と中身を保つ）
  w.cells[fromZ * w.width + fromX] = 'floor';
  w.cells[toZ * w.width + toX] = bk;
  if (stack) {
    stack.x = toX;
    stack.z = toZ;
  } else if (port) {
    port.x = toX;
    port.z = toZ;
  } else if (station) {
    station.x = toX;
    station.z = toZ;
  } else if (bk === 'waitSpot') {
    const ws = w.waitSpots.find((s) => s.x === fromX && s.z === fromZ);
    if (ws) {
      ws.x = toX;
      ws.z = toZ;
    }
  }
  return { ok: true };
}

export type ExpandDir = 'east' | 'south';

/** 拡張で増えるマス数 */
export function expansionCells(w: WorldState, dir: ExpandDir): number {
  return dir === 'east' ? GRID.expandStep * w.height : GRID.expandStep * w.width;
}

/** 費用 = 基準費用（拡張回数で上がる） × 増えるマス数 / 基準マス数。広げられなければ null */
export function expansionCost(w: WorldState, dir: ExpandDir = 'east'): number | null {
  if (dir === 'east' && w.width + GRID.expandStep > limitsFor(w).maxWidth) return null;
  if (dir === 'south' && w.height + GRID.expandStep > limitsFor(w).maxHeight) return null;
  const base = EXPANSION.costs[Math.min(w.expansions, EXPANSION.costs.length - 1)];
  return price(w, Math.round((base * expansionCells(w, dir)) / EXPANSION.baseCells));
}

export function maxExpansionsForRank(w: WorldState): number {
  return RANKS[Math.min(w.rank, RANKS.length - 1)].maxExpansions;
}

/** 面積拡張: 東へ +4 列（出荷口は新しい東壁へ移す）または南へ +4 行 */
export function expand(w: WorldState, dir: ExpandDir = 'east'): BuildResult {
  const cost = expansionCost(w, dir);
  if (cost === null) return { ok: false, reason: dir === 'east' ? tr(tr(tr('これ以上東へは広げられません'))) : tr(tr(tr('これ以上南へは広げられません'))) };
  if (w.expansions >= maxExpansionsForRank(w)) return { ok: false, reason: tr(tr(tr('面積拡張はランクアップで解放（あと {0} 回）')), maxExpansionsForRank(w) - w.expansions) };
  if (w.coins < cost) return { ok: false, reason: tr(tr(tr('コインが足りません（{0} 必要）')), cost) };
  w.coins -= cost;
  if (dir === 'east') {
    const oldW = w.width;
    const newW = oldW + GRID.expandStep;
    const cells: CellKind[] = new Array(newW * w.height).fill('floor');
    for (let z = 0; z < w.height; z++) {
      for (let x = 0; x < oldW; x++) cells[z * newW + x] = w.cells[z * oldW + x];
    }
    // 東壁の出荷口を移す
    for (const d of w.outboundDock) {
      if (d.x === oldW - 1) {
        cells[d.z * newW + d.x] = 'floor';
        d.x = newW - 1;
        cells[d.z * newW + d.x] = 'outboundDock';
      }
    }
    w.cells = cells;
    w.width = newW;
  } else {
    const add = GRID.expandStep;
    const cells: CellKind[] = [...w.cells, ...new Array<CellKind>(w.width * add).fill('floor')];
    w.cells = cells;
    w.height += add;
  }
  w.expansions++;
  return { ok: true };
}

/** ピッカーの担当を変更（他のピッカーからは外す）§5.1 */
export function assignItem(w: WorldState, stationId: number, item: string, on: boolean): BuildResult {
  const st = w.stations.find((s) => s.id === stationId && s.kind === 'pick');
  if (!st) return { ok: false, reason: tr(tr(tr('ピッキングステーションがありません'))) };
  for (const s of w.stations) if (s.kind === 'pick') s.assignedItems = s.assignedItems.filter((i) => i !== item);
  if (on) st.assignedItems.push(item);
  return { ok: true };
}
