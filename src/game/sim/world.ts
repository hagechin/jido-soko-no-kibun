/**
 * ワールドの生成と 1 tick の進行。
 * 各サブシステム（orders / robots / pickers ...）はここから呼ばれる。
 */
import {
  BIN,
  CALENDAR,
  ECONOMY,
  GRID,
  INITIAL_LAYOUT,
  LAYOUT_CHARS,
  LEVELS,
  ORDERS,
  REPUTATION,
  SAVE,
} from '../data/balance';
import type { CellKind } from '../data/balance';
import { ITEMS } from '../data/items';
import { createRng } from './rng';
import type { Bin, Robot, RobotKind, RobotVariant, Station, StationKind, WorldState } from './types';
import { tr } from '../i18n';

export interface WorldOptions {
  seed?: number;
  layout?: readonly string[];
  /** 初期商品種類数（ランク0のデフォルト） */
  itemKinds?: number;
}

export function createWorld(opts: WorldOptions = {}): WorldState {
  const layout = opts.layout ?? INITIAL_LAYOUT;
  const height = layout.length;
  const width = layout[0].length;
  const w: WorldState = {
    version: SAVE.version,
    rng: createRng(opts.seed ?? 12345),
    tick: 0,
    speed: 1,
    difficulty: 'normal',
    economy: 'standard',
    width,
    height,
    cells: new Array<CellKind>(width * height).fill('floor'),
    levels: LEVELS.initial,
    binCapacity: BIN.baseCapacity,
    bins: {},
    stacks: [],
    ports: [],
    stations: [],
    waitSpots: [],
    inboundDock: [],
    outboundDock: [],
    pallets: [],
    trucks: [],
    robots: [],
    orders: [],
    nextOrderTick: ORDERS.firstOrderDelayTicks,
    nextIds: { bin: 1, stack: 1, port: 1, station: 1, robot: 1, order: 1 },
    coins: ECONOMY.initialCoins,
    reputation: REPUTATION.initial,
    rank: 0,
    expansions: 0,
    automation: { dispatch: 0, restock: false, relocate: false, amrPriority: 'balanced', lastRetrieveTick: 0 },
    season: { active: [], cyberNoticeYear: 0, cyber: null, pendingReport: null },
    calendar: { tick: 0, year: CALENDAR.startYear, month: CALENDAR.startMonth, week: 1 },
    stats: {
      totalShipped: 0,
      totalCoins: 0,
      recentShipments: [],
      stockouts: 0,
      cyberWeekRecords: [],
      shippedByItem: {},
      shippedThisWeek: {},
      shippedLastWeek: {},
      trucks: 0,
    },
    events: [],
    flags: { buildMode: false },
  };

  for (let z = 0; z < height; z++) {
    const row = layout[z];
    if (row.length !== width) throw new Error(`layout row ${z} has wrong width`);
    for (let x = 0; x < width; x++) {
      const kind = LAYOUT_CHARS[row[x]];
      if (!kind) throw new Error(`unknown layout char '${row[x]}' at ${x},${z}`);
      placeCell(w, x, z, kind);
    }
  }

  // 初期在庫: 商品ごとに 1 ビン、スタックへ順に配る（★ 初期は全スタックに 1 段）
  const kinds = opts.itemKinds ?? ORDERS.itemKindsByRank[0];
  const items = ITEMS.slice(0, kinds);
  let si = 0;
  for (const item of items) {
    const stack = w.stacks[si % w.stacks.length];
    const bin = createBin(w, item.id, w.binCapacity);
    stack.bins.push(bin.id);
    si++;
  }
  // 残りのスタックには空ビンを 1 つずつ
  for (; si < w.stacks.length; si++) {
    const bin = createBin(w, null, 0);
    w.stacks[si].bins.push(bin.id);
  }

  // ピッカーの担当を均等に割り当て（★）
  const pickers = w.stations.filter((s) => s.kind === 'pick');
  items.forEach((item, i) => {
    if (pickers.length) pickers[i % pickers.length].assignedItems.push(item.id);
  });

  // 初期ロボ: 棚ロボ 1（最初のスタック上）、搬送ロボ 1（最初の待機スポット）
  if (w.stacks.length) addRobot(w, 'shelf', w.stacks[0].x, w.stacks[0].z);
  const spot = w.waitSpots[0] ?? { x: 0, z: 0 };
  addRobot(w, 'amr', spot.x, spot.z);

  return w;
}

export function createBin(w: WorldState, item: string | null, qty: number): Bin {
  const bin: Bin = { id: w.nextIds.bin++, item, qty, purpose: null };
  w.bins[bin.id] = bin;
  return bin;
}

/** セルを配置する（建設モードも同じ関数を使う）。既存の設備は撤去される。 */
export function placeCell(w: WorldState, x: number, z: number, kind: CellKind): void {
  removeCell(w, x, z);
  w.cells[z * w.width + x] = kind;
  switch (kind) {
    case 'stack':
      w.stacks.push({ id: w.nextIds.stack++, x, z, bins: [] });
      break;
    case 'port':
      w.ports.push({ id: w.nextIds.port++, x, z, outbound: [], returns: [] });
      break;
    case 'pickStation':
      addStation(w, 'pick', x, z);
      break;
    case 'inboundStation':
      addStation(w, 'inbound', x, z);
      break;
    case 'waitSpot':
      w.waitSpots.push({ x, z });
      break;
    case 'inboundDock':
      w.inboundDock.push({ x, z });
      break;
    case 'outboundDock':
      w.outboundDock.push({ x, z });
      break;
    default:
      break;
  }
}

/** セルを床に戻し、紐づく設備を取り除く。ビンがあるスタックは撤去できない（戻り値 false） */
export function removeCell(w: WorldState, x: number, z: number): boolean {
  const kind = w.cells[z * w.width + x];
  switch (kind) {
    case 'stack': {
      const i = w.stacks.findIndex((s) => s.x === x && s.z === z);
      if (i >= 0) {
        if (w.stacks[i].bins.length) return false;
        w.stacks.splice(i, 1);
      }
      break;
    }
    case 'port': {
      const i = w.ports.findIndex((s) => s.x === x && s.z === z);
      if (i >= 0) {
        const p = w.ports[i];
        if (p.outbound.length || p.returns.length) return false;
        w.ports.splice(i, 1);
      }
      break;
    }
    case 'pickStation':
    case 'inboundStation': {
      const i = w.stations.findIndex((s) => s.x === x && s.z === z);
      if (i >= 0) {
        if (w.stations[i].work) return false;
        w.stations.splice(i, 1);
      }
      break;
    }
    case 'waitSpot':
      w.waitSpots = w.waitSpots.filter((s) => !(s.x === x && s.z === z));
      break;
    case 'inboundDock':
      w.inboundDock = w.inboundDock.filter((s) => !(s.x === x && s.z === z));
      break;
    case 'outboundDock':
      w.outboundDock = w.outboundDock.filter((s) => !(s.x === x && s.z === z));
      break;
    default:
      break;
  }
  w.cells[z * w.width + x] = 'floor';
  return true;
}

function addStation(w: WorldState, kind: StationKind, x: number, z: number): Station {
  const s: Station = { id: w.nextIds.station++, kind, x, z, assignedItems: [], level: 0, work: null };
  w.stations.push(s);
  return s;
}

export function addRobot(w: WorldState, kind: RobotKind, x: number, z: number, variant: RobotVariant = 'standard'): Robot {
  const id = w.nextIds.robot++;
  const count = w.robots.filter((r) => r.kind === kind && (r.variant ?? 'standard') === variant).length + 1;
  const r: Robot = {
    id,
    kind,
    ...(variant !== 'standard' ? { variant } : {}),
    pose: { x, z, dir: 0 },
    moveTo: null,
    actRemaining: 0,
    actTotal: 0,
    phase: 'idle',
    job: null,
    queue: [],
    step: 0,
    carrying: [],
    digging: null,
    speedLevel: 0,
    liftLevel: 0,
    cargoLevel: 0,
    stuckTicks: 0,
    goal: null,
    name: variant === 'drone' ? tr(tr('ドローン {0}'), count) : variant === 'double' ? tr(tr('ダブルデッカー {0}'), count) : kind === 'shelf' ? tr(tr('棚ロボ {0}'), count) : tr(tr('搬送ロボ {0}'), count),
  };
  w.robots.push(r);
  return r;
}

export function stackAt(w: WorldState, x: number, z: number) {
  return w.stacks.find((s) => s.x === x && s.z === z) ?? null;
}
export function portAt(w: WorldState, x: number, z: number) {
  return w.ports.find((s) => s.x === x && s.z === z) ?? null;
}
export function stationAt(w: WorldState, x: number, z: number) {
  return w.stations.find((s) => s.x === x && s.z === z) ?? null;
}
export function robotById(w: WorldState, id: number) {
  return w.robots.find((r) => r.id === id) ?? null;
}
