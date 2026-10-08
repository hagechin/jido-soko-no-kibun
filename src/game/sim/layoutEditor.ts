/**
 * レイアウトエディタ（★）: 倉庫を止めて、俯瞰でまとめて配置を変える。
 *  beginEdit:  ロボは持っているビンを棚に戻し、全員が倉庫の外へ出て待機する。仕事は全部取り消す
 *  編集中:     スタックは中のビンごと、ポートは置かれたビンごと動かせる。途中は不正な配置（レールの分断など）でもよい
 *  validate:   保存できる配置か（レール 1 本・ポートは棚に隣接し床に面する・ステーションは床に面する・床が分断されない・最低限の設備）
 *  finishEdit: ロボを倉庫に戻して再開。元に戻すなら restoreLayout
 * sim は DOM を知らない。2D の描画・操作は ui/layoutEditor.ts
 */
import { layerOf } from './layers';
import { BUILD } from '../data/balance';
import type { CellKind } from '../data/balance';
import { approachCells, cellAt, inBounds, isAdjacentToStack, isFacingFloor, isFloorWalkable, isRailWalkable, neighbors4 } from './grid';
import { railConnected, wouldDisconnectFloor, type BuildKind, buildCost } from './build';
import { pickStackWithRoom } from './robots';
import type { Port, Stack, Station, Vec2, WorldState } from './types';
import { tr } from '../i18n';

export type EditResult = { ok: true } | { ok: false; reason: string };

/** 元に戻す用のレイアウトの写し（ビンの中身・ロボは含まない） */
export interface LayoutSnapshot {
  width: number;
  height: number;
  cells: CellKind[];
  stacks: Stack[];
  ports: Port[];
  stations: Station[];
  waitSpots: Vec2[];
  inboundDock: Vec2[];
  outboundDock: Vec2[];
  coins: number;
  expansions: number;
}

export function snapshotLayout(w: WorldState): LayoutSnapshot {
  return JSON.parse(
    JSON.stringify({ width: w.width, height: w.height, cells: w.cells, stacks: w.stacks, ports: w.ports, stations: w.stations, waitSpots: w.waitSpots, inboundDock: w.inboundDock, outboundDock: w.outboundDock, coins: w.coins, expansions: w.expansions }),
  ) as LayoutSnapshot;
}

export function restoreLayout(w: WorldState, s: LayoutSnapshot): void {
  const c = JSON.parse(JSON.stringify(s)) as LayoutSnapshot;
  w.width = c.width;
  w.height = c.height;
  w.cells = c.cells;
  w.stacks = c.stacks;
  w.ports = c.ports;
  w.stations = c.stations;
  w.waitSpots = c.waitSpots;
  w.inboundDock = c.inboundDock;
  w.outboundDock = c.outboundDock;
  w.coins = c.coins;
  w.expansions = c.expansions;
}

/** 倉庫を止める: 仕事を取り消し、持っているビンを棚（無ければポート）へ戻し、ロボを倉庫の外へ */
export function beginEdit(w: WorldState): void {
  for (const s of w.stations) s.work = null;
  for (const r of w.robots) {
    r.job = null;
    r.queue = [];
    r.digging = null;
    r.goal = null;
    r.moveTo = null;
    r.phase = 'idle';
    r.actRemaining = 0;
    r.actTotal = 0;
    r.step = 0;
    r.stuckTicks = 0;
    r.retreatUntil = undefined;
    while (r.carrying.length) {
      const id = r.carrying.pop()!;
      const b = w.bins[id];
      if (b) b.purpose = null;
      const stack = pickStackWithRoom(w, r.pose, undefined, undefined, id);
      if (stack) stack.bins.push(id);
      else {
        const port = w.ports.find((p) => p.returns.length < 99) ?? w.ports[0];
        if (port) port.returns.push(id);
        else {
          const any = w.stacks[0];
          any?.bins.push(id);
        }
      }
    }
  }
  parkOutside(w);
  w.flags.layoutEditor = true;
}

/** ロボを倉庫の外（北側、x 順）に並べる */
export function parkOutside(w: WorldState): void {
  let i = 0;
  for (const r of w.robots) {
    r.pose = { x: 1 + (i % Math.max(1, w.width - 2)), z: -2 - Math.floor(i / Math.max(1, w.width - 2)) * (r.kind === 'shelf' ? 1 : 1) - (r.kind === 'amr' ? 3 : 0), dir: 2 };
    i++;
  }
}

/** 保存できる配置か。空配列なら OK */
export function validateLayout(w: WorldState): string[] {
  const out: string[] = [];
  if (!w.stacks.length) out.push(tr(tr(tr('スタックがありません'))));
  if (!w.ports.length) out.push(tr(tr(tr('ポートがありません'))));
  if (!w.stations.some((s) => s.kind === 'pick')) out.push(tr(tr(tr('ピッキングステーションがありません'))));
  if (!w.stations.some((s) => s.kind === 'inbound')) out.push(tr(tr(tr('入荷ステーションがありません'))));
  if (w.stacks.length && !railConnected(w)) out.push(tr(tr(tr('レール（スタックとポート）が 1 つにつながっていません'))));
  for (const p of w.ports) {
    if (!isAdjacentToStack(w, p.x, p.z)) out.push(tr(tr(tr('ポート({0},{1}) が棚に隣接していません')), p.x, p.z));
    else if (!isFacingFloor(w, p.x, p.z)) out.push(tr(tr(tr('ポート({0},{1}) が床に面していません')), p.x, p.z));
  }
  for (const s of w.stations) if (!isFacingFloor(w, s.x, s.z)) out.push(tr(tr(tr('{0}ステーション({1},{2}) が床に面していません')), s.kind === 'pick' ? tr(tr(tr('ピッキング'))) : tr(tr(tr('入荷'))), s.x, s.z));
  if (!floorConnected(w)) out.push(tr(tr(tr('床の通路が分断されています（搬送ロボが行けない場所がある）'))));
  const slots = w.stacks.length * w.levels;
  const bins = Object.keys(w.bins).length;
  if (bins > slots) out.push(tr(tr(tr('ビン {0} 個に対して棚のスロットが {1} しかありません')), bins, slots));
  const shelves = w.robots.filter((r) => r.kind === 'shelf').length;
  if (shelves > w.stacks.length + w.ports.length) out.push(tr(tr(tr('棚ロボ {0} 台を置けるレールがありません')), shelves));
  return out;
}

/** 床（搬送ロボが通れるマス）が 1 つにつながっているか */
export function floorConnected(w: WorldState): boolean {
  let start: Vec2 | null = null;
  let total = 0;
  for (let z = 0; z < w.height; z++) for (let x = 0; x < w.width; x++) if (isFloorWalkable(cellAt(w, x, z))) { total++; if (!start) start = { x, z }; }
  if (!start) return true;
  const seen = new Set<number>([start.z * w.width + start.x]);
  const q = [start];
  for (let h = 0; h < q.length; h++) {
    for (const n of neighbors4(w, q[h].x, q[h].z)) {
      const k = n.z * w.width + n.x;
      if (seen.has(k) || !isFloorWalkable(cellAt(w, n.x, n.z))) continue;
      seen.add(k);
      q.push(n);
    }
  }
  return seen.size === total;
}

function movable(kind: CellKind | null): kind is BuildKind {
  return kind === 'stack' || kind === 'port' || kind === 'pickStation' || kind === 'inboundStation' || kind === 'waitSpot';
}

/** 選択したマスの設備をまとめて (dx, dz) ずらす。移動先が全部「範囲内の空き床（または選択内のマス）」でなければ何もしない */
export function moveCells(w: WorldState, cells: Vec2[], dx: number, dz: number): EditResult {
  if (!dx && !dz) return { ok: true };
  const sel = cells.filter((c) => movable(cellAt(w, c.x, c.z)));
  if (!sel.length) return { ok: false, reason: tr(tr(tr('動かせる設備が選ばれていません'))) };
  const selKeys = new Set(sel.map((c) => `${c.x},${c.z}`));
  for (const c of sel) {
    const nx = c.x + dx;
    const nz = c.z + dz;
    if (!inBounds(w, nx, nz)) return { ok: false, reason: tr(tr(tr('倉庫の外にはみ出します'))) };
    const k = cellAt(w, nx, nz);
    if (k !== 'floor' && !selKeys.has(`${nx},${nz}`)) return { ok: false, reason: tr(tr(tr('移動先に他の設備があります'))) };
  }
  // いったん全部床にして、ずらした位置へ置き直す（設備オブジェクトは id・中身ごと座標だけ変える）
  const kinds = new Map<string, CellKind>();
  for (const c of sel) {
    kinds.set(`${c.x},${c.z}`, w.cells[c.z * w.width + c.x]);
    w.cells[c.z * w.width + c.x] = 'floor';
  }
  for (const c of sel) w.cells[(c.z + dz) * w.width + (c.x + dx)] = kinds.get(`${c.x},${c.z}`)!;
  const shift = (o: { x: number; z: number }) => {
    if (selKeys.has(`${o.x},${o.z}`)) {
      o.x += dx;
      o.z += dz;
      return true;
    }
    return false;
  };
  // 同じ座標に複数の設備が重なることはないので、各リストを 1 回ずつ
  const moved = new Set<object>();
  for (const s of w.stacks) if (!moved.has(s) && shift(s)) moved.add(s);
  for (const p of w.ports) if (!moved.has(p) && shift(p)) moved.add(p);
  for (const s of w.stations) if (!moved.has(s) && shift(s)) moved.add(s);
  for (const s of w.waitSpots) if (!moved.has(s) && shift(s)) moved.add(s);
  return { ok: true };
}

/** エディタでの配置: 範囲内の床なら置ける（配置の正しさは保存時に validate で見る）。新設はコインがかかる */
export function paintCell(w: WorldState, kind: BuildKind, x: number, z: number): EditResult {
  if (!inBounds(w, x, z)) return { ok: false, reason: tr(tr(tr('倉庫の外です'))) };
  if (cellAt(w, x, z) !== 'floor') return { ok: false, reason: tr(tr(tr('そこには何かがあります'))) };
  const cost = buildCost(w, kind);
  if (w.coins < cost) return { ok: false, reason: tr(tr(tr('コインが足りません（{0} 必要）')), cost) };
  w.coins -= cost;
  w.cells[z * w.width + x] = kind;
  switch (kind) {
    case 'stack':
      w.stacks.push({ id: w.nextIds.stack++, x, z, bins: [] });
      break;
    case 'port':
      w.ports.push({ id: w.nextIds.port++, x, z, outbound: [], returns: [] });
      break;
    case 'pickStation':
      w.stations.push({ id: w.nextIds.station++, kind: 'pick', x, z, assignedItems: [], level: 0, work: null });
      break;
    case 'inboundStation':
      w.stations.push({ id: w.nextIds.station++, kind: 'inbound', x, z, assignedItems: [], level: 0, work: null });
      break;
    case 'waitSpot':
      w.waitSpots.push({ x, z });
      break;
  }
  return { ok: true };
}


/** 撤去（無料）。ビンの入ったスタック、ビンの置かれたポート、入荷口・出荷口は撤去できない */
export function eraseCell(w: WorldState, x: number, z: number): EditResult {
  const k = cellAt(w, x, z);
  if (!k || k === 'floor') return { ok: true };
  if (k === 'inboundDock' || k === 'outboundDock') return { ok: false, reason: tr(tr(tr('入荷口・出荷口は動かせません'))) };
  if (k === 'stack') {
    const s = w.stacks.find((s) => s.x === x && s.z === z);
    if (s?.bins.length) return { ok: false, reason: tr(tr(tr('ビンが入ったスタックは撤去できません（空にするか動かしてください）'))) };
    w.stacks = w.stacks.filter((o) => o !== s);
  } else if (k === 'port') {
    const p = w.ports.find((p) => p.x === x && p.z === z);
    if (p && (p.outbound.length || p.returns.length)) return { ok: false, reason: tr(tr(tr('ビンが置かれているポートは撤去できません'))) };
    w.ports = w.ports.filter((o) => o !== p);
  } else if (k === 'pickStation' || k === 'inboundStation') {
    const st = w.stations.find((s) => s.x === x && s.z === z);
    if (st?.kind === 'pick' && st.assignedItems.length) {
      const other = w.stations.find((s) => s.kind === 'pick' && s !== st);
      if (other) other.assignedItems.push(...st.assignedItems);
    }
    w.stations = w.stations.filter((o) => o !== st);
  } else if (k === 'waitSpot') {
    w.waitSpots = w.waitSpots.filter((s) => !(s.x === x && s.z === z));
  }
  w.cells[z * w.width + x] = 'floor';
  return { ok: true };
}

/**
 * 再開: 配置が正しければロボを倉庫へ戻す（棚ロボはポートに隣接しないスタック → 任意のレール、搬送ロボは待機スポット → 床）。
 * 戻せなければ理由を返し、何も変えない
 */
export function finishEdit(w: WorldState): EditResult {
  const problems = validateLayout(w);
  if (problems.length) return { ok: false, reason: problems[0] };
  const used = new Set<string>();
  const shelfCells: Vec2[] = [];
  const preferred = w.stacks.filter((s) => !w.ports.some((p) => Math.abs(p.x - s.x) + Math.abs(p.z - s.z) === 1));
  const rest = [...w.stacks.filter((s) => !preferred.includes(s)), ...w.ports];
  for (const c of [...preferred, ...rest]) shelfCells.push({ x: c.x, z: c.z });
  const floorCells: Vec2[] = [...w.waitSpots];
  for (let z = 0; z < w.height; z++) for (let x = 0; x < w.width; x++) if (cellAt(w, x, z) === 'floor' && !w.ports.some((p) => approachCells(w, p.x, p.z).some((a) => a.x === x && a.z === z))) floorCells.push({ x, z });
  for (let z = 0; z < w.height; z++) for (let x = 0; x < w.width; x++) if (cellAt(w, x, z) === 'floor') floorCells.push({ x, z });
  const place = (r: WorldState['robots'][number], cells: Vec2[]) => {
    const c = cells.find((c) => !used.has(`${layerOf(r)}:${c.x},${c.z}`));
    if (!c) return false;
    used.add(`${layerOf(r)}:${c.x},${c.z}`);
    r.pose = { x: c.x, z: c.z, dir: 0 };
    return true;
  };
  const poses = w.robots.map((r) => ({ ...r.pose }));
  for (const r of w.robots) {
    const ok = r.kind === 'shelf' ? place(r, shelfCells) : place(r, floorCells);
    if (!ok) {
      w.robots.forEach((r, i) => (r.pose = poses[i]));
      return { ok: false, reason: r.kind === 'shelf' ? tr(tr(tr('棚ロボを置けるスタックが足りません'))) : tr(tr(tr('搬送ロボを置ける床が足りません'))) };
    }
  }
  for (const r of w.robots) {
    r.job = null;
    r.queue = [];
    r.goal = null;
    r.moveTo = null;
    r.phase = 'idle';
  }
  w.flags.layoutEditor = false;
  return { ok: true };
}

/** 参考: 選択範囲の設備の数 */
export function countSelection(w: WorldState, cells: Vec2[]): { stacks: number; ports: number; stations: number; waitSpots: number } {
  const n = { stacks: 0, ports: 0, stations: 0, waitSpots: 0 };
  for (const c of cells) {
    const k = cellAt(w, c.x, c.z);
    if (k === 'stack') n.stacks++;
    else if (k === 'port') n.ports++;
    else if (k === 'pickStation' || k === 'inboundStation') n.stations++;
    else if (k === 'waitSpot') n.waitSpots++;
  }
  return n;
}

export { isRailWalkable, wouldDisconnectFloor };
