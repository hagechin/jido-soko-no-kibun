/**
 * ゲーム内の数値をすべてここに集約する（SPEC.md §9 ほか）。
 * ロジック内にマジックナンバーを書かず、必ずこのファイルを参照すること。
 * 時間の単位は特記がない限り「tick」（1秒 = TICKS_PER_SECOND tick）。
 */

// ---- 時間 --------------------------------------------------------------
export const TICKS_PER_SECOND = 10;
export const TICK_SECONDS = 1 / TICKS_PER_SECOND;
export const sec = (s: number): number => Math.round(s * TICKS_PER_SECOND);

/** 1か月 = 実時間6分（1x）。1年 = 72分（§6.1） */
export const CALENDAR = {
  weeksPerMonth: 4,
  monthsPerYear: 12,
  ticksPerMonth: sec(6 * 60),
  get ticksPerWeek() {
    return this.ticksPerMonth / this.weeksPerMonth;
  },
  get ticksPerYear() {
    return this.ticksPerMonth * this.monthsPerYear;
  },
  /** ゲーム開始時点の暦 */
  startYear: 1,
  startMonth: 4, // 4月開始（新生活イベント直後で穏やか。★独自決定）
} as const;

/** 速度ボタン（§2.1）。0 = 一時停止 */
export const SPEED_OPTIONS = [0, 1, 2, 4] as const;

// ---- 倉庫グリッド（§3） ---------------------------------------------------
export const GRID = {
  initialWidth: 16,
  initialHeight: 12,
  /** 面積拡張 1回あたりの増分（幅方向 +4）§9.4 */
  expandStep: 4,
  maxWidth: 40,
  maxHeight: 28,
};

/** セル種別 */
export type CellKind =
  | 'floor'
  | 'stack'
  | 'port'
  | 'pickStation'
  | 'inboundStation'
  | 'waitSpot'
  | 'inboundDock'
  | 'outboundDock';

/**
 * 初期レイアウト（16×12）。★独自決定。
 * 記号: . 床 / S スタック / P ポート / K ピッキングST / I 入荷ST / W 待機スポット / i 入荷口 / o 出荷口
 */
export const INITIAL_LAYOUT: readonly string[] = [
  '................',
  '................',
  '...SSSS....K....',
  '...SSSSP.......o',
  '...SSSS........o',
  '...........K....',
  '................',
  '................',
  'i..I....WWWW....',
  'i...............',
  '................',
  '................',
];

export const LAYOUT_CHARS: Record<string, CellKind> = {
  '.': 'floor',
  S: 'stack',
  P: 'port',
  K: 'pickStation',
  I: 'inboundStation',
  W: 'waitSpot',
  i: 'inboundDock',
  o: 'outboundDock',
};

// ---- ビン・在庫（§3.1） ---------------------------------------------------
export const BIN = {
  /** 1ビンの容量（初期）。アップグレードで +10 ずつ */
  baseCapacity: 20,
  /** 空ビン 1 個の価格（★ 段数を増やしたぶんのビンを買い足す） */
  emptyBinCost: 15,
  capacityUpgradeStep: 10,
  capacityUpgradeCosts: [400, 1000],
  /** 在庫が少ないと色を変える閾値（割合） */
  lowStockRatio: 0.35,
  criticalStockRatio: 0.12,
};

/** 棚の段数（§3.2 / §9.4） */
export const LEVELS = {
  initial: 1,
  max: 8,
  costs: [200, 500, 1200, 2500, 5000, 9000, 15000],
};

/** 面積拡張費用（§9.4） */
export const EXPANSION = {
  costs: [300, 800, 2000, 4500, 9000, 16000],
};

// ---- ロボット（§4） --------------------------------------------------------
export const ROBOT = {
  /** 1マス移動にかかる tick。速度 Lv ごと（§4.4: +20%/Lv を tick に丸めたもの） */
  moveTicksByLevel: [5, 4, 3, 2],
  /** 旋回にかかる tick（1×2 以上） */
  turnTicks: 3,
  maxSpeedLevel: 3,
  /** 棚ロボ: ビンの上げ下ろし 1回にかかる tick。リフト Lv ごと */
  liftTicksByLevel: [sec(1.2), sec(0.9), sec(0.6), sec(0.4)],
  maxLiftLevel: 3,
  /** 搬送ロボ: ビンの積み降ろし 1個あたり tick */
  loadTicksPerBin: sec(0.5),
  /** 1台あたりの指示予約数の上限（§7.2） */
  maxQueuedCommands: 3,
  /** 積載 Lv → 積載ビン数 / 占有マス（§4.2） */
  cargo: [
    { bins: 1, w: 1, l: 1 },
    { bins: 2, w: 1, l: 2 },
    { bins: 4, w: 2, l: 2 },
  ],
  cargoUpgradeCosts: [250, 700],
  speedUpgradeCosts: [150, 350, 800],
  liftUpgradeCosts: [150, 350, 800],
  shelfRobotCost: 400,
  amrCost: 300,
  /** 同時に存在できる台数の上限（描画負荷の安全弁） */
  maxShelfRobots: 12,
  maxAmrs: 16,
};

/** 衝突回避（§4.3） */
export const PATHING = {
  /** 経路が無いロボの再試行周期 */
  replanIntervalTicks: 10,
  /** 古い予約を捨てる周期 */
  pruneIntervalTicks: 50,
  /** 空間時間 A* の探索上限（tick）。目的地までの距離に応じて自動で伸ばす */
  horizonTicks: 150,
  /** A* 展開ノード上限（グリッド幅の二乗 × expansionsPerCellSq と大きいほう） */
  maxExpansions: 2500,
  expansionsPerCellSq: 4,
  /** 探索の順位付けで待機に付けるペナルティ（tick 相当。動ける経路を先に試す） */
  waitPenalty: 0.5,
  /** これ以上動けなければ「詰まり」とみなし優先度を上げて退避 */
  stuckTicks: sec(3),
  /** 退避先を探す BFS の最大距離 */
  escapeRadius: 6,
  /** 作業中（ステーション待機など）の予約長 */
  dwellReserveTicks: sec(6),
};

/** ポート（§3）★ */
export const PORT = {
  outboundCapacity: 4,
  returnCapacity: 4,
  cost: 150,
};

// ---- ピッカー・入荷担当（§5） ---------------------------------------------
export const PICKER = {
  /** 1個あたりのピック時間（tick）。Lv で短縮 */
  pickTicksByLevel: [sec(1.0), sec(0.8), sec(0.6), sec(0.45)],
  maxLevel: 3,
  upgradeCosts: [200, 500, 1200],
  /** 担当外の商品は 1/3 の速度 */
  offDutySpeedFactor: 1 / 3,
  stationCost: 250,
};

export const INBOUND_WORKER = {
  /** 1個詰めるのにかかる時間（tick） */
  stuffTicksPerItem: sec(0.3),
  stationCost: 250,
  /** 定期入荷: 週1回（§6.2） */
  trucksPerWeek: 1,
  /** 入荷量 = 先週の出荷実績 × 係数 + 来月の需要係数 × forecastBase。在庫が十分ある商品は入荷しない */
  restockFactor: 1.3,
  forecastBase: 2,
  minRestockPerItem: 2,
  maxRestockPerItem: 40,
  /** この在庫数以上ある商品は定期入荷をスキップ（ビン容量の倍数） */
  skipRestockStockBins: 2,
  /** 入荷口に積める山の上限（これを超えた分は数だけ表示して滞留）★ */
  dockDisplayMax: 6,
};

// ---- オーダー・経済（§9） -------------------------------------------------
export const ORDERS = {
  /** 同時表示件数 */
  visibleMax: 5,
  /** シートの大きさ 横4×縦6 */
  sheetCols: 4,
  sheetRows: 6,
  maxLinesPerOrder: 24,
  /** 到着間隔（tick）。ランクごと */
  intervalByRank: [sec(25), sec(22), sec(19), sec(16), sec(13)],
  /** 商品種類数（ランクごと） */
  itemKindsByRank: [6, 10, 14, 19, 24],
  /** 1オーダーの行数 min/max（ランクごと）。24 行はイベントの倍率で到達する */
  linesByRank: [
    [1, 3],
    [1, 4],
    [2, 5],
    [3, 8],
    [4, 12],
  ],
  /** 1行の数量 min/max（ランクごと） */
  qtyByRank: [
    [1, 2],
    [1, 2],
    [1, 3],
    [1, 4],
    [1, 5],
  ],
  /** キューがこの件数を超えると評判が下がり続ける */
  queuePenaltyThreshold: 10,
  queuePenaltyIntervalTicks: sec(20),
  /** 出荷までの時間がこれを超えると評判 -1 */
  latePenaltyTicks: sec(180),
  latePenaltyRep: 1,
  /** 到着直後のオーダー生成の初回遅延 */
  firstOrderDelayTicks: sec(5),
  /** 表示中が全部欠品待ちのとき、キューから完了できるオーダーを前に出す判定の周期 */
  unblockCheckTicks: sec(5),
};

export const REWARD = {
  coinPerItem: 10,
  /** スピードボーナス（§9.2）: [上限秒, 倍率] */
  speedBonus: [
    [30, 2.0],
    [60, 1.5],
    [90, 1.2],
  ] as const,
  baseMultiplier: 1.0,
  /** 評判倍率 = min + (max-min) * rep/100 */
  repMultiplierMin: 0.6,
  repMultiplierMax: 1.4,
  /** 出荷 1件ごとの評判回復 */
  repGainPerShipment: 1.0,
};

export const REPUTATION = {
  initial: 50,
  min: 0,
  max: 100,
};

export const ECONOMY = {
  initialCoins: 300,
};

/** 倉庫ランク（§9.3） */
export const RANKS = [
  { name: '町の小さな倉庫', shipped: 0, area: 0, maxLevels: 2, maxExpansions: 0 },
  { name: '地域の倉庫', shipped: 40, area: 0, maxLevels: 3, maxExpansions: 1 },
  { name: '配送センター', shipped: 150, area: 16 * 12 + 4 * 12, maxLevels: 5, maxExpansions: 3 },
  { name: '物流センター', shipped: 400, area: 16 * 12 + 8 * 12, maxLevels: 7, maxExpansions: 5 },
  { name: 'メガDC', shipped: 1000, area: 16 * 12 + 12 * 12, maxLevels: 8, maxExpansions: 99 },
] as const;

/** 自動化AI（§7.3 / §9.4） */
export const AUTOMATION = {
  dispatchCosts: [500, 1500, 4000],
  restockCost: 1200,
  relocateCost: 2500,
  /** 自動化のアンロックランク（0始まり） */
  unlockRank: { dispatch1: 0, dispatch2: 1, dispatch3: 2, restock: 1, relocate: 2 },
  /** 在庫再配置AIが動く「暇」判定の tick */
  relocateIdleTicks: sec(8),
  /** 再配置する最小の人気差 */
  relocateMinGain: 3,
  /** 同時に再配置する棚ロボの台数 */
  maxRelocating: 1,
  /** 自動補充の同時ビン数の下限（ピック待ちがあるときは棚ロボの 1/3 かこの値の大きいほう。無ければ全員） */
  maxInboundInFlight: 1,
  /** 入荷口の滞留がビン容量の何倍以上なら空ビンを優先して補充するか */
  preferEmptyBacklogBins: 2,
  /** 自動補充がポートに残しておく出庫枠 */
  restockPortHeadroom: 2,
};

/** 建設コスト（§9.4） */
export const BUILD = {
  stackCost: 30,
  portCost: PORT.cost,
  pickStationCost: PICKER.stationCost,
  inboundStationCost: INBOUND_WORKER.stationCost,
  waitSpotCost: 0,
};

// ---- 放置中の進行（§10.2） -----------------------------------------------
export const OFFLINE = {
  /** これ以下の離席は tick を追いつき計算する */
  catchUpMaxMs: 5 * 60_000,
  /** 追いつき計算の 1 フレームあたり上限 tick */
  catchUpTicksPerFrame: 600,
  /** まとめて計算する上限（8 時間） */
  maxOfflineMs: 8 * 60 * 60_000,
  /** ペースを見る窓（直近 10 分） */
  windowTicks: sec(10 * 60),
  /** 出荷実績が無いときの最低ペース（1分あたり）: 自動化が揃っていなければ 0 */
  fallbackShipmentsPerMinute: 0,
};

// ---- セーブ（§11.2） -----------------------------------------------------
export const SAVE = {
  key: 'jido-soko-no-kibun:save',
  version: 1,
  autosaveIntervalMs: 30_000,
};

// ---- 描画・カメラ（§2.3 / §10.3） -----------------------------------------
export const CAMERA = {
  minDistance: 6,
  maxDistanceFactor: 2.2, // × グリッド対角
  minPolar: 0.2,
  maxPolar: 1.35,
  rotateSpeed: 0.006,
  panSpeed: 1.0,
  zoomWheelFactor: 0.0012,
  /** タップとドラッグの境目（px）§2.3 */
  tapThresholdPx: 8,
  initialPolar: 0.95,
  initialAzimuth: -0.6,
  /** 全体表示のときの余白（1.0 でぴったり） */
  fitMargin: 0.95,
};

export const RENDER = {
  maxPixelRatio: 2,
  lowQualityPixelRatio: 1.5,
  /** セルの大きさ（ワールド単位） */
  cell: 1,
  binHeight: 0.45,
  binSize: 0.82,
  floorThickness: 0.1,
  railBaseHeight: 0.35,
  wallHeight: 1.0,
  /** 1秒あたりの描画上限（通常 / 眺めモード）*/
  normalFps: 60,
  calmFps: 30,
  calmFpsLow: 15,
};

export const UI = {
  mobileBreakpointPx: 900,
  minTapPx: 44,
  /** 眺めモードを提案するまでの無操作時間（ms） */
  idleSuggestMs: 90_000,
};
