/**
 * ゲーム状態の型。state は丸ごと JSON 化できること（§11.3）。
 * 描画や DOM に依存する値は入れない。
 */
import type { CellKind } from '../data/balance';
import type { RngState } from './rng';

export type { CellKind };

export type Dir = 0 | 1 | 2 | 3; // 0:+x(東) 1:+z(南) 2:-x(西) 3:-z(北)

export interface Vec2 {
  x: number;
  z: number;
}

export interface Bin {
  id: number;
  /** null = 空ビン */
  item: string | null;
  qty: number;
  /** このビンを運んだ先（ビンが棚から出たときに決まる） */
  purpose: 'pick' | 'inbound' | null;
}

export interface Stack {
  id: number;
  x: number;
  z: number;
  /** 下から上の順 */
  bins: number[];
}

export interface Port {
  id: number;
  x: number;
  z: number;
  /** 棚ロボが降ろして搬送ロボ待ちのビン */
  outbound: number[];
  /** 搬送ロボが戻して棚ロボ待ちのビン */
  returns: number[];
}

export type StationKind = 'pick' | 'inbound';

export interface Station {
  id: number;
  kind: StationKind;
  x: number;
  z: number;
  /** ピッカー: 担当商品 */
  assignedItems: string[];
  level: number;
  /** 作業の進行 */
  work: StationWork | null;
}

export interface StationWork {
  robotId: number;
  binId: number;
  /** 残り tick */
  remaining: number;
  /** 今処理している個数 */
  count: number;
}

export type RobotKind = 'shelf' | 'amr';

export interface Pose {
  x: number;
  z: number;
  dir: Dir;
}

/** 棚ロボの仕事 */
export type ShelfJob =
  | { type: 'retrieve'; stackId: number; binId: number; portId: number; manual: boolean }
  | { type: 'store'; portId: number; binId: number | null; stackId: number | null; manual: boolean }
  /** 在庫再配置: 上のビンを退避して目的のビンを頂上にする（§7.3） */
  | { type: 'relocate'; stackId: number; binId: number; manual: boolean };

/** 搬送ロボの仕事 */
export type AmrJob =
  | { type: 'fetch'; portId: number; manual: boolean; stationId: number | null }
  | { type: 'deliver'; stationId: number; manual: boolean }
  | { type: 'return'; portId: number | null; manual: boolean };

/** 両方: 指定セルへ移動して待機（待機スポット・退避） */
export type ParkJob = { type: 'park'; x: number; z: number; manual: boolean };

export type RobotJob = ShelfJob | AmrJob | ParkJob;

export type RobotPhase =
  | 'idle'
  | 'moving'
  | 'waiting' // 経路待ち
  | 'lifting' // 棚ロボ: 上げ下ろし
  | 'loading' // 搬送ロボ: 積み降ろし
  | 'working' // ステーションで作業中（人の作業待ち）
  | 'turning';

export interface Robot {
  id: number;
  kind: RobotKind;
  /** 論理位置（アンカーセル）と向き */
  pose: Pose;
  /** 移動中の目的セル。null なら停止中 */
  moveTo: Pose | null;
  /** 現在の動作の残り tick / 合計 tick（描画補間用） */
  actRemaining: number;
  actTotal: number;
  phase: RobotPhase;
  /** 今の仕事と予約（§7.2: 最大3件） */
  job: RobotJob | null;
  queue: RobotJob[];
  /** 仕事の進行ステップ（各 job 内のサブ状態） */
  step: number;
  /** 運んでいるビン */
  carrying: number[];
  /** 掘り出し中に一時退避したビン（棚ロボ） */
  digging: { targetStackId: number; movedBins: number[]; tempStackId: number } | null;
  speedLevel: number;
  liftLevel: number;
  cargoLevel: number;
  /** 動けていない時間（デッドロック検出用） */
  stuckTicks: number;
  /** 現在の目標（経路計画用）。null = 目標なし */
  goal: Goal | null;
  /** 選択・指示の表示用 */
  name: string;
}

export type Goal =
  | { type: 'cell'; x: number; z: number }
  | { type: 'adjacent'; x: number; z: number } // 対象セルに隣接する床に行く
  | { type: 'any'; cells: Vec2[] };

export interface OrderLine {
  item: string;
  qty: number;
  picked: number;
}

export interface Order {
  id: number;
  lines: OrderLine[];
  arrivedTick: number;
  /** 表示開始 tick（キューから出た時刻） */
  shownTick: number | null;
  /** 遅延ペナルティを適用済み */
  penalized: boolean;
}

export interface Pallet {
  item: string;
  qty: number;
  arrivedTick: number;
}

/** 入荷の予定（トラックは少し遅れて着く演出用） */
export interface Truck {
  arriveTick: number;
  pallets: { item: string; qty: number }[];
  kind: 'weekly' | 'prestock';
}

export interface Calendar {
  tick: number;
  year: number;
  month: number; // 1-12
  week: number; // 1-4
}

export interface Stats {
  totalShipped: number;
  totalCoins: number;
  /** 直近の出荷の時刻リスト（放置計算用に短く保つ） */
  recentShipments: { tick: number; coins: number; items: number }[];
  stockouts: number;
  /** サイバーウィークの成績（年ごと） */
  cyberWeekRecords: CyberWeekRecord[];
  /** 商品ごとの出荷数（累計） */
  shippedByItem: Record<string, number>;
  /** 今週・先週の商品ごとの出荷数（入荷量の自動決定に使う） */
  shippedThisWeek: Record<string, number>;
  shippedLastWeek: Record<string, number>;
  /** 入荷トラックの到着回数 */
  trucks: number;
}

export interface CyberWeekRecord {
  year: number;
  shipped: number;
  avgLeadSec: number;
  stockouts: number;
  coins: number;
}

/** 季節イベントの進行状態（§6.3 / §6.4） */
export interface SeasonState {
  /** 今アクティブなイベント ID */
  active: string[];
  /** サイバーウィークの予告・事前入荷を出した年 */
  cyberNoticeYear: number;
  /** サイバーウィーク中の集計 */
  cyber: {
    year: number;
    startShipped: number;
    startCoins: number;
    startStockouts: number;
    leadSum: number;
    leadCount: number;
  } | null;
  /** 直近の成績表（UI が表示したら消す） */
  pendingReport: CyberWeekRecord | null;
}

export interface Automation {
  dispatch: number; // 0-3
  restock: boolean;
  relocate: boolean;
  /** 最後に取り出し仕事を割り当てた tick（再配置 AI の「暇」判定） */
  lastRetrieveTick: number;
}

export interface WorldState {
  version: number;
  rng: RngState;
  tick: number;
  speed: number;
  width: number;
  height: number;
  cells: CellKind[];
  levels: number;
  binCapacity: number;
  bins: Record<number, Bin>;
  stacks: Stack[];
  ports: Port[];
  stations: Station[];
  waitSpots: Vec2[];
  inboundDock: Vec2[];
  outboundDock: Vec2[];
  pallets: Pallet[];
  trucks: Truck[];
  robots: Robot[];
  orders: Order[]; // 表示中 + キュー（先頭 visibleMax 件が表示）
  nextOrderTick: number;
  nextIds: { bin: number; stack: number; port: number; station: number; robot: number; order: number };
  coins: number;
  reputation: number;
  rank: number;
  expansions: number;
  automation: Automation;
  season: SeasonState;
  calendar: Calendar;
  stats: Stats;
  /** 直近のイベント（UI 通知用）。描画側が読んで消す */
  events: SimEvent[];
  flags: {
    buildMode: boolean;
  };
}

export type SimEvent =
  | { type: 'orderArrived'; orderId: number }
  | { type: 'shipped'; orderId: number; coins: number; bonus: number; stationId: number }
  | { type: 'coinChange'; delta: number; x: number; z: number }
  | { type: 'repChange'; delta: number; reason: string }
  | { type: 'truckArrived'; kind: 'inbound' | 'outbound' }
  | { type: 'rankUp'; rank: number }
  | { type: 'notice'; text: string }
  | { type: 'eventStart'; id: string; banner: string }
  | { type: 'eventEnd'; id: string }
  | { type: 'cyberWeekReport'; record: CyberWeekRecord }
  | { type: 'pick'; stationId: number; item: string; count: number };
