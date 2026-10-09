import { tr } from '../i18n';
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
  /**
   * おすすめのビン数: 全スロットのこの割合まで（残りは掘り出しの退避先）。1 段の倉庫は掘り出しが無いので予約ぶん以外すべて。
   * 計測（メガDC 30 分）では充填率 50〜90% で出荷数は 871→841 とほぼ横ばい（埋めるほど僅かに落ちる）なので、在庫量と掘り出しの折衷で 3/4
   */
  recommendedFillRatio: 0.75,
  capacityUpgradeStep: 10,
  capacityUpgradeCosts: [400, 1000],
  /** 在庫が少ないと色を変える閾値（割合） */
  lowStockRatio: 0.35,
  criticalStockRatio: 0.12,
};

/** 棚の段数（§3.2 / §9.4） */
export const LEVELS = {
  initial: 1,
  /** 通常の最大段数（上限突破で 12。LIMITS 参照） */
  max: 8,
  /** 段数 n → n+1 の費用（添字 n-1）。9〜12 段は上限突破パックのみ */
  costs: [150, 400, 900, 1800, 3500, 6000, 10000, 16000, 25000, 40000, 60000],
};

/** 面積拡張費用（§9.4）。costs は「基準マス数ぶん」の費用で、実際は増えるマス数に比例する */
export const EXPANSION = {
  costs: [300, 800, 2000, 4500, 9000, 16000],
  /** 基準マス数（初期 16×12 を東へ +4 列 = 48 マス） */
  baseCells: 48,
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
  /** ビンを置くスタックの選び方: 低さの重み（1 段 = この値ぶんの距離）。返却の格納は平準化を強く、掘り出しの退避は近さを優先 */
  storeLevelWeight: 3,
  digLevelWeight: 1,
  /** 在庫ビンの上に空ビンを置く（またはその逆で空ビンを埋める）ときのペナルティ（距離換算） */
  burialPenalty: 12,
  /** 空ビンを入荷ステーションの近くに集める重み（距離 1 マス = この値） */
  emptyNearInboundWeight: 2.5,
  /**
   * 積載 Lv → 積載ビン数 / 占有マス。
   * ★ 仕様 §4.2 の「底面積が増える」から変更: ビンを積み重ねて運び、占有マスは 1×1 のまま
   * （経路探索は 1×2 / 2×2 にも対応しているので、w/l を変えれば仕様どおりにも戻せる）
   */
  cargo: [
    { bins: 1, w: 1, l: 1 },
    { bins: 2, w: 1, l: 1 },
    { bins: 4, w: 1, l: 1 },
    /** Lv4（8 ビン）は上限突破パック（iOS）のみ。LIMITS.maxCargoLevel で制限 */
    { bins: 8, w: 1, l: 1 },
  ],
  cargoUpgradeCosts: [250, 700, 1800],
  speedUpgradeCosts: [150, 350, 800],
  liftUpgradeCosts: [150, 350, 800],
  shelfRobotCost: 300,
  amrCost: 250,
  /** 特別ロボ（iOS の特別ロボパック）。ドローンは空中を飛ぶ搬送ロボ（上限 maxDrones 台、搬送ロボの上限とは別枠）、ダブルデッカーは 2 段持ちの棚ロボ（棚ロボの上限に含む） */
  droneCost: 900,
  maxDrones: 4,
  /** ドローンは飛ぶので速度 Lv をこれだけ上乗せ（上限は maxSpeedLevel） */
  droneSpeedBonus: 1,
  doubleDeckerCost: 650,
  /** 同時に存在できる台数の上限（描画負荷の安全弁。上限突破パックで LIMITS.expanded に） */
  maxShelfRobots: 40,
  maxAmrs: 60,
};

/**
 * 上限突破（SPEC-iOS §1、I4）: 通常の上限と、購入後の上限。sim は `limitsFor(w)` 経由で読む。
 * maxCargoLevel は ROBOT.cargo の添字（2 = 4 ビン、3 = 8 ビン）
 */
export const LIMITS = {
  base: { maxShelfRobots: 40, maxAmrs: 60, maxCargoLevel: 2, maxLevels: 8, maxWidth: 40, maxHeight: 28 },
  expanded: { maxShelfRobots: 80, maxAmrs: 120, maxCargoLevel: 3, maxLevels: 12, maxWidth: 64, maxHeight: 48 },
};

/** 衝突回避（§4.3） */
export const PATHING = {
  /** 経路が無いロボの再試行周期 */
  replanIntervalTicks: 10,
  /** 古い予約を捨てる周期 */
  pruneIntervalTicks: 50,
  /** 空間時間 A* の探索上限（tick）。目的地までの距離に応じて自動で伸ばす */
  horizonTicks: 150,
  /**
   * 窓付き計画（WHCA*）: 一度に引く経路はこのマス数まで。先は近づいてから引き直す。
   * 遠くまで一気に引くと探索が膨らむので、1 台あたりの計算量を距離によらず一定にする
   */
  windowCells: 10,
  /** 計画の残りがこのステップ数以下になったら続きを引く */
  replanAheadSteps: 3,
  /** 1 tick に経路を引く台数の上限（負荷をならす。詰まっているロボは優先） */
  plansPerTick: 6,
  /** A* 展開ノード上限（グリッド幅の二乗 × expansionsPerCellSq と大きいほう） */
  maxExpansions: 2500,
  expansionsPerCellSq: 4,
  /**
   * 探索の順位付けで待機 1 tick に付けるペナルティ（tick 相当。同じ到着時刻なら動ける経路を先に試す）。
   * 大きくすると「行って戻る」往復が待機より安くなり、ロボ同士が永久に往復し合うライブロックになるので、ごく小さく
   */
  waitPenalty: 0.05,
  /** ゴールから遠ざかる移動に付けるペナルティ（移動 1 回の tick 数に対する倍率）。道を譲るためには遠ざかれるが、無意味な往復はしない */
  awayMovePenalty: 1,
  /** これ以上動けなければ「詰まり」とみなし優先度を上げて退避 */
  stuckTicks: sec(3),
  /** これ以上経路が無ければ、その場に居座らず待機スポットへ退避して通路を空ける */
  retreatTicks: sec(9),
  /** 退避後、目的地へ再挑戦するまでの tick */
  retryAfterRetreatTicks: sec(5),
  /** 退避先を探す BFS の最大距離 */
  escapeRadius: 6,
  /** 同じマスにロボが重なった状態がこの tick 続いたら、片方を隣の空きマスへ移して解消する（本来起きないが、起きても固まらないための保険） */
  overlapHealTicks: sec(3),
  /** 作業中（ステーション待機など）の予約長 */
  dwellReserveTicks: sec(6),
};

/** ポート（§3）★ */
export const PORT = {
  outboundCapacity: 4,
  returnCapacity: 4,
  cost: 150,
  /**
   * ポート選びの重み: 待っているビン 1 個 = この距離ぶん。大きいほど「近さより空き」を優先して全ポートに分散する
   * （最短経路にこだわるとピッカー寄りのポートに集中して詰まる）
   */
  loadWeight: 8,
  /** ポート→ステーション距離の重み（0〜1。小さいほどピッカーからの距離を気にしない） */
  stationDistanceWeight: 0.25,
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
  /** 定期入荷: 週1回（§6.2）。設定の「入荷の頻度」で変えられる（INBOUND_FREQ） */
  trucksPerWeek: 1,
  /** 入荷量の倍率の上限（1 回のトラックの 1 商品の量に掛かる。「倉庫いっぱい」でも 1 回のトラックはこの倍率まで。入荷口の山を際限なく大きくしない） */
  maxLoadFactor: 4,
  /** 「倉庫いっぱい」: 全ビン数のこの割合ぶんを在庫で埋めるのを目標にする（残りは空ビン） */
  fillShare: 0.7,
  /** 入荷量 = 先週の出荷実績 × 係数 + 来月の需要係数 × forecastBase。在庫が十分ある商品は入荷しない */
  restockFactor: 1.3,
  forecastBase: 4,
  minRestockPerItem: 6,
  maxRestockPerItem: 40,
  /** この在庫数以上ある商品は定期入荷をスキップ（ビン容量の倍数） */
  skipRestockStockBins: 2,
  /** 入荷口の山がこれ以上残っている商品も定期入荷をスキップ（ビン容量の倍数） */
  skipRestockDockBins: 1,
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
  /** 評判が高いほど客が増える（間隔が短くなる）: 間隔 × (maxFactor − (maxFactor − minFactor) × 評判/100)。評判 50 で 1 倍（★） */
  reputationDemand: { minFactor: 0.7, maxFactor: 1.3 },
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
  /**
   * 受注の抑制（★）: キュー（表示枠に入りきらないオーダー）が startAt 件を超えると、1 件ごとに到着間隔が perOrder 倍ずつ伸びる（最大 maxFactor 倍）。
   * 現実の倉庫が受注を絞るのと同じで、処理能力を超えた分が際限なく積み上がって評判が下がり続けるのを防ぐ
   */
  backpressure: { startAt: 5, perOrder: 0.15, maxFactor: 3 },
  /** キューがこの件数を超えると評判が下がり続ける */
  queuePenaltyThreshold: 10,
  queuePenaltyIntervalTicks: sec(20),
  /** 出荷までの時間がこれを超えると評判 -1。行数の多いオーダーは 1 行ごとに latePenaltyPerLineTicks ぶん猶予が延びる（★） */
  latePenaltyTicks: sec(180),
  latePenaltyPerLineTicks: sec(15),
  latePenaltyRep: 1,
  /** 到着直後のオーダー生成の初回遅延 */
  firstOrderDelayTicks: sec(5),
  /** 表示中が全部欠品待ちのとき、キューから完了できるオーダーを前に出す判定の周期 */
  unblockCheckTicks: sec(5),
};

export const REWARD = {
  /** 商品 1 個あたりのコイン。ランクが上がると取引先が大きくなり単価が上がる（★ インフレの軸） */
  coinPerItemByRank: [10, 14, 19, 26, 36],
  /** ランク 1 の単価（テスト・表示用の基準） */
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
/**
 * 昇格条件（出荷数・面積）と昇格ボーナス（★）。
 * bonusCoins は昇格時にもらえるコイン。新しく解放された商品の数だけ空ビンも無料でもらえる（棚に空きがあれば）。
 * 以前は 40 / 150 / 400 / 1000 件で、完全自動化まで 2 時間以上かかって苦行だった → 1 年（72 分）以内を目安に短縮
 */
export const RANKS = [
  { name: tr('町の小さな倉庫'), shipped: 0, area: 0, maxLevels: 2, maxExpansions: 0, bonusCoins: 0 },
  { name: tr('地域の倉庫'), shipped: 20, area: 0, maxLevels: 3, maxExpansions: 1, bonusCoins: 300 },
  { name: tr('配送センター'), shipped: 80, area: 16 * 12 + 4 * 12, maxLevels: 5, maxExpansions: 3, bonusCoins: 800 },
  { name: tr('物流センター'), shipped: 250, area: 16 * 12 + 8 * 12, maxLevels: 7, maxExpansions: 5, bonusCoins: 2000 },
  { name: tr('メガDC'), shipped: 700, area: 16 * 12 + 12 * 12, maxLevels: 8, maxExpansions: 99, bonusCoins: 5000 },
] as const;

/** 自動化AI（§7.3 / §9.4） */
export const AUTOMATION = {
  dispatchCosts: [250, 600, 2000],
  restockCost: 800,
  relocateCost: 1500,
  /** 自動化のアンロックランク（0始まり） */
  unlockRank: { dispatch1: 0, dispatch2: 1, dispatch3: 2, restock: 1, relocate: 2 },
  /** 在庫再配置AIが動く「暇」判定の tick */
  relocateIdleTicks: sec(8),
  /** 再配置する最小の人気差 */
  relocateMinGain: 3,
  /** 同時に再配置する棚ロボの台数 */
  maxRelocating: 1,
  /** これ以上動けていないロボが持っているビンは「向かっている在庫」とみなさない（他のビンを取りに行く） */
  staleCarryTicks: sec(90),
  /** これ以上動けていない、まだビンを持っていない自動の取り出し指示は取り消して他のロボに譲る */
  staleRetrieveTicks: sec(60),
  /**
   * 入荷作業の配分（★）: 入荷口に山があるとき、棚ロボ・搬送ロボのうちこの割合を入荷作業（空ビン／詰め足せるビンを入荷STへ）に回す。
   * 搬送ロボの優先設定で変わる。ピック待ちが無ければ全員で補充する
   */
  restockShareByPriority: { balanced: 1 / 3, pick: 1 / 6, restock: 2 / 3 },
  /**
   * 入荷モード（★）: 倉庫の容量（スロット × ビン容量）に対する在庫の割合がこれ未満、または入荷口の滞留が棚の在庫数より多いとき、
   * 配分を lowStockRestockShare まで引き上げる。「商品がたくさんある倉庫からロボが探し出してくる」状態を保つため
   */
  lowStockFill: 0.25,
  lowStockRestockShare: 2 / 3,
  /** 自動補充の同時ビン数の下限（配分で 0 台にならないように） */
  maxInboundInFlight: 1,
  /** 入荷口の滞留がビン容量の何倍以上なら空ビンを優先して補充するか */
  preferEmptyBacklogBins: 2,
  /** 自動補充がポートに残しておく出庫枠 */
  restockPortHeadroom: 2,
  /** 入荷専任の搬送ロボを最低 1 台置くのは、搬送ロボがこの台数以上あるときだけ */
  dedicatedAmrMinFleet: 2,
  /**
   * ★ 入荷専任の搬送ロボは入荷ステーションの処理能力で頭打ちにする（サイバーウィークの事前入荷で全搬送ロボが入荷ステーションの列に並び、
   * ピックが何週間も止まった対策）。ステーション 1 つにつきこの台数まで。残りの搬送ロボはピックのビンを先に運ぶ
   */
  amrsPerInboundStation: 2,
  /** 緊急の補充（入荷口の商品が欠品）のとき、入荷ビンがポートの出庫枠をいくつ残して使うか（ピックと同じ 1） */
  urgentPortHeadroom: 1,
  /** 入荷口にある商品の棚の在庫がビン何杯分を下回ったら「欠品しそう」として緊急の補充に含める（0 = 欠品してからだけ） */
  urgentStockBins: 0.25,
};

/** アドバイザー（★）: ボトルネック判定のしきい値。サンプルは 1 秒ごと、直近 1 分程度の移動平均 */
export const ADVISOR = {
  smoothing: 1 / 60,
  /** 提案を出し始めるまでのサンプル数（開始直後のノイズを避ける） */
  minSamples: 45,
  /** 全ポートの出庫枠が満杯だった時間の割合がこれ以上なら「ポート増設」 */
  portsFullRatio: 0.4,
  pickersBusyRatio: 0.8,
  lowIdleRatio: 0.15,
  highIdleRatio: 0.5,
  /** キューがこの件数以上なら底上げを提案 */
  queueHint: 6,
  /** 地上の搬送ロボのうち、ポート／ステーションの横付けの順番待ち（staged）をしている割合がこれ以上なら「ドローンの買い時」 */
  stagedRatio: 0.2,
  /** 空ビンが全ビンのこの割合以上（かつ全ビンが emptyBinsMin 個以上）で入荷口が空なら「入荷の積載量を上げる」 */
  emptyBinsShare: 0.4,
  emptyBinsMin: 60,
  /** 同じヒントを再表示するまでの間隔（ms）／ヒントの確認間隔（ms） */
  repeatMs: 180_000,
  checkMs: 30_000,
};

/**
 * 難易度（★）: 受注まわりだけを変える。途中で変えても倉庫の状態には影響しない。
 *  - intervalFactor: 到着間隔の倍率（小さいほど客が多い）
 *  - backpressure: 受注抑制（キューが startAt 件を超えると 1 件ごとに間隔が perOrder 倍ずつ伸びる、最大 maxFactor。maxFactor 1 = 抑制なし）
 *  - lateGraceFactor: 遅延になるまでの猶予の倍率
 *  - latePenaltyRep: 遅延 1 件の評判ペナルティ
 *  - queuePenaltyThreshold: キューがこの件数を超えると評判が下がり続ける
 *  - coinFactor: 報酬の倍率（難しいほど実入りが良い）
 * イージー／ノーマルは小さな倉庫でも自動化を眺めて楽しめる。ハード以上は受注抑制がほぼ効かず、こまめなメンテナンスが要る
 */
export type DifficultyId = 'easy' | 'normal' | 'hard' | 'superhard';
export const DIFFICULTY: Record<DifficultyId, { name: string; desc: string; intervalFactor: number; backpressure: { startAt: number; perOrder: number; maxFactor: number }; lateGraceFactor: number; latePenaltyRep: number; queuePenaltyThreshold: number; coinFactor: number }> = {
  easy: { name: tr('イージー'), desc: tr('客は少なめ。溜まるとすぐ受注を絞る。遅延にも寛容。報酬 ×0.9。小さな倉庫で自動化を眺める向け'), intervalFactor: 1.25, backpressure: { startAt: 3, perOrder: 0.25, maxFactor: 4 }, lateGraceFactor: 1.5, latePenaltyRep: 0.5, queuePenaltyThreshold: 15, coinFactor: 0.9 },
  normal: { name: tr('ノーマル'), desc: tr('標準。キューが 5 件を超えると受注を絞る'), intervalFactor: 1.0, backpressure: { startAt: 5, perOrder: 0.15, maxFactor: 3 }, lateGraceFactor: 1.0, latePenaltyRep: 1, queuePenaltyThreshold: 10, coinFactor: 1.0 },
  hard: { name: tr('ハード'), desc: tr('客が多く、受注抑制は弱い（最大 1.6 倍まで）。遅延の猶予短め。報酬 ×1.15。レイアウトとロボ配分の見直しが要る'), intervalFactor: 0.85, backpressure: { startAt: 8, perOrder: 0.08, maxFactor: 1.6 }, lateGraceFactor: 0.8, latePenaltyRep: 1.5, queuePenaltyThreshold: 8, coinFactor: 1.15 },
  superhard: { name: tr('スーパーハード'), desc: tr('受注抑制なし。客は 1.4 倍、遅延の猶予は 2/3、遅延 1 件で評判 −2。報酬 ×1.3。シミュレーターに慣れた人向け'), intervalFactor: 0.7, backpressure: { startAt: 0, perOrder: 0, maxFactor: 1 }, lateGraceFactor: 0.65, latePenaltyRep: 2, queuePenaltyThreshold: 5, coinFactor: 1.3 },
};
export const DIFFICULTY_ORDER: DifficultyId[] = ['easy', 'normal', 'hard', 'superhard'];

/**
 * 経済モード（★）: 難易度（受注まわり）とは別の軸。コインの貯まりやすさと値段を変える。
 *  - coinFactor: 報酬の倍率（難易度の coinFactor と掛け合わせ）
 *  - coinPerItemByRank: 商品 1 個の単価（null なら REWARD.coinPerItemByRank）。ロングランはランクで単価がほぼ上がらない（インフレの軸を切る）
 *  - costFactor: ロボ・建設・面積拡張・段数・ビン・機体とピッカーの強化、すべての値段の倍率
 *  - automationCostFactor: 自動化 AI の値段の倍率（自動化は遠ざけすぎない）
 *  - rankShippedFactor: 昇格に要る累計出荷数の倍率
 *  - rankBonusFactor: 昇格ボーナスのコインの倍率
 * ロングランの目安（1x・自動化が揃った倉庫の収入 rank0 ≈ 35、rank2 ≈ 250、rank4 ≈ 1,100 コイン/分）:
 * 自動化（配車 Lv2）まで約 1 時間、メガDC まで約 6 時間。★ 実測で調整すること
 */
export type EconomyId = 'standard' | 'longrun';
export const ECONOMY_MODES: Record<EconomyId, { name: string; desc: string; coinFactor: number; coinPerItemByRank: readonly number[] | null; costFactor: number; automationCostFactor: number; rankShippedFactor: number; rankBonusFactor: number }> = {
  standard: { name: tr('標準'), desc: tr('コインはどんどん貯まり、ランクが上がると単価も上がる。自動化を眺めるまでが早い'), coinFactor: 1, coinPerItemByRank: null, costFactor: 1, automationCostFactor: 1, rankShippedFactor: 1, rankBonusFactor: 1 },
  longrun: { name: tr('ロングラン'), desc: tr('コインが貯まりにくく（報酬 ×0.4、単価はランクでほぼ上がらない）、ロボと設備は 3 倍、自動化 AI は 1.5 倍、昇格に要る出荷数は 1.5 倍。しっかり調整すれば自動化まで約 1 時間、メガDC まで約 6 時間'), coinFactor: 0.4, coinPerItemByRank: [10, 11, 12, 13, 14], costFactor: 3, automationCostFactor: 1.5, rankShippedFactor: 1.5, rankBonusFactor: 0.5 },
};
export const ECONOMY_ORDER: EconomyId[] = ['standard', 'longrun'];

/**
 * 入荷トラックの設定（設定パネル。いつでも変更できる）★
 *  - 頻度: トラックが来る間隔。1 回に積む量はその間隔ぶん（週 1 の量 × 週数）なので、週あたりの入荷量と在庫の目標は変わらない。頻度はリズムと音の好み
 *  - 積載量: 1 回に積む量と、入荷を止める在庫の目標（標準は 1 商品につきビン 2 杯）の倍率。倉庫を広げて空ビンが余っているなら上げる
 *  - 倉庫いっぱい: 全ビンの fillShare ぶんを在庫で埋めるのを目標にする（倉庫の大きさに合わせて目標が伸びる。1 回のトラックは maxLoadFactor 倍まで）
 */
export type InboundFreqId = 'daily' | 'twice' | 'weekly' | 'monthly';
export const INBOUND_FREQ: Record<InboundFreqId, { name: string; desc: string; perWeek: number }> = {
  daily: { name: tr('毎日'), desc: tr('小さなトラックが週 7 回（約 13 秒おき）。入荷口の山が小さく保たれる代わりに、トラックの音が頻繁'), perWeek: 7 },
  twice: { name: tr('週 2'), desc: tr('週の半ばにもトラックが来る'), perWeek: 2 },
  weekly: { name: tr('週 1'), desc: tr('週の初めに 1 回（標準）'), perWeek: 1 },
  monthly: { name: tr('月 1'), desc: tr('月の初めに 4 週ぶんをまとめて 1 回。静かだが入荷口の山が大きく、月末に欠品しやすい'), perWeek: 0.25 },
};
export const INBOUND_FREQ_ORDER: InboundFreqId[] = ['daily', 'twice', 'weekly', 'monthly'];
export type InboundLoadId = 'standard' | 'large' | 'huge' | 'fill';
export const INBOUND_LOAD: Record<InboundLoadId, { name: string; desc: string; factor: number | null }> = {
  standard: { name: tr('標準'), desc: tr('在庫の目標は 1 商品につきビン 2 杯。売れたぶんを補充する'), factor: 1 },
  large: { name: tr('多め'), desc: tr('1 回の量と在庫の目標が 2 倍（ビン 4 杯）'), factor: 2 },
  huge: { name: tr('たっぷり'), desc: tr('1 回の量と在庫の目標が 4 倍（ビン 8 杯）'), factor: 4 },
  fill: { name: tr('倉庫いっぱい'), desc: tr('倉庫のビンの 7 割が在庫で埋まるまで、たっぷり（4 倍）の量で入荷し続ける。倉庫を広げてビンを増やすほど在庫が増える'), factor: null },
};
export const INBOUND_LOAD_ORDER: InboundLoadId[] = ['standard', 'large', 'huge', 'fill'];

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
  /** バックグラウンド動作: Worker からの 1 メッセージ（250ms）で進める tick の上限（超えたぶんは追いつき計算へ） */
  backgroundTicksPerMessage: 300,
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
  version: 2, // 2: difficulty を追加
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
  /** キーボード操作（眺めモード MANUAL）: 移動は距離 × この値 / 秒、回転・見下ろしは rad / 秒、ズームは倍率の対数 / 秒 */
  keyPanSpeed: 0.8,
  keyRotateSpeed: 1.0,
  keyTiltSpeed: 0.8,
  keyZoomSpeed: 0.9,
};

/** サウンド（★）: マスター音量と、オン／オフ切替のフェード秒数（ﾌｯと消えて、ﾌｯと聞こえてくる） */
export const AUDIO = {
  masterVolume: 0.5,
  fadeOutSec: 0.6,
  fadeInSec: 0.9,
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
