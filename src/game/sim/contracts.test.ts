import { describe, expect, it } from 'vitest';
import { CONTRACTS, HQ, OFFLINE, TICKS_PER_SECOND } from '../data/balance';
import { CLIENT_BY_ID, clientLevel, levelRewardFactor, nextLevelTrust } from '../data/clients';
import { ITEM_BY_ID } from '../data/items';
import { achievementValue } from './achievements';
import { acceptContract, availableClients, claimContract, contractBadge, contractCoins, contractKeys, contractPace, contractsOffline, dayKeyOf, niceNumber, rerollContract, rerollCost, syncContracts, weekKeyOf } from './contracts';
import { shipOrder } from './economy';
import { buyHq, dailySlots, hqCost, hqLevel, offlineCapMs, salesFactor } from './hq';
import { applyOffline } from './offline';
import { buildPreset } from './presets';
import { deserialize, serialize } from './save';
import { createRuntime, stepSim } from './sim';
import type { Contract, Order, WorldState } from './types';
import { createWorld } from './world';

const DAY1 = { dayKey: '2026-11-10', weekKey: 'W2026-11-09' };
const DAY2 = { dayKey: '2026-11-11', weekKey: 'W2026-11-09' };
const NEXT_WEEK = { dayKey: '2026-11-16', weekKey: 'W2026-11-16' };

function order(w: WorldState, lines: [string, number][], extra: Partial<Order> = {}): Order {
  const o: Order = { id: w.nextIds.order++, lines: lines.map(([item, qty]) => ({ item, qty, picked: qty })), arrivedTick: w.tick, shownTick: w.tick, penalized: false, ...extra };
  w.orders.push(o);
  return o;
}

function setOnly(w: WorldState, c: Partial<Contract> & Pick<Contract, 'kind' | 'target'>): Contract {
  const full: Contract = { id: 900, period: 'daily', key: w.contracts!.dayKey, client: 'marufuku', progress: 0, state: 'active', reward: { coins: 500, trust: 10 }, ...c };
  w.contracts!.list = [full];
  return full;
}

describe('1.2 取引先の依頼', () => {
  it('日付と週のキー（週は月曜始まり、端末の現地時刻）', () => {
    expect(dayKeyOf(new Date(2026, 10, 10))).toBe('2026-11-10');
    expect(weekKeyOf(new Date(2026, 10, 10))).toBe('W2026-11-09'); // 火曜 → 月曜
    expect(weekKeyOf(new Date(2026, 10, 15))).toBe('W2026-11-09'); // 日曜 → その週の月曜
    expect(weekKeyOf(new Date(2026, 10, 16))).toBe('W2026-11-16');
    expect(weekKeyOf(new Date(2027, 0, 1))).toBe('W2026-12-28'); // 年またぎ
    expect(contractKeys(new Date(2026, 10, 10))).toEqual(DAY1);
  });

  it('毎日 3 件・毎週 1 件。同じ日に呼び直しても増えない。取引先は扱う商品があるところだけ', () => {
    const w = createWorld({ seed: 1 });
    expect(syncContracts(w, DAY1).added).toBe(CONTRACTS.dailySlots + CONTRACTS.weeklySlots);
    const st = w.contracts!;
    expect(st.list.filter((c) => c.period === 'daily')).toHaveLength(3);
    expect(st.list.filter((c) => c.period === 'weekly')).toHaveLength(1);
    expect(syncContracts(w, DAY1).added).toBe(0);
    const ok = new Set(availableClients(w).map((c) => c.id as string));
    expect(ok.has('popo')).toBe(false); // ランク 0 におもちゃは無い
    for (const c of st.list) {
      expect(ok.has(c.client)).toBe(true);
      expect(c.target).toBeGreaterThan(0);
      expect(c.reward.coins).toBeGreaterThanOrEqual(CONTRACTS.rewardFloorByRank[0]);
      expect(c.state).toBe(c.kind === 'bulk' ? 'offered' : 'active');
    }
    // 毎日の 3 件は種類が重ならず、特注は 1 件まで
    const kinds = st.list.filter((c) => c.period === 'daily').map((c) => c.kind);
    expect(new Set(kinds).size).toBe(kinds.length);
    expect(st.list.find((c) => c.period === 'weekly')!.kind).not.toBe('bulk');
  });

  it('日付が変わると入れ替わる。達成して受け取っていない依頼は残り、時計が戻っても入れ替わらない', () => {
    const w = createWorld({ seed: 2 });
    syncContracts(w, DAY1);
    const st = w.contracts!;
    const done = st.list.find((c) => c.period === 'daily')!;
    done.state = 'done';
    const weeklyId = st.list.find((c) => c.period === 'weekly')!.id;
    expect(syncContracts(w, DAY2).added).toBe(3);
    expect(st.list.filter((c) => c.period === 'daily' && c.key === DAY2.dayKey)).toHaveLength(3);
    expect(st.list).toContain(done); // 残る
    expect(st.list.find((c) => c.period === 'weekly')!.id).toBe(weeklyId); // 週は同じ
    expect(syncContracts(w, DAY1).added).toBe(0); // 時計が戻った
    expect(st.dayKey).toBe(DAY2.dayKey);
    syncContracts(w, NEXT_WEEK);
    expect(st.list.find((c) => c.period === 'weekly')!.id).not.toBe(weeklyId);
    expect(st.list.find((c) => c.period === 'weekly')!.key).toBe(NEXT_WEEK.weekKey);
  });

  it('量は出荷ペースに合わせて増える（下限はランクの基本の需要）', () => {
    const slow = createWorld({ seed: 3 });
    const fast = createWorld({ seed: 3 });
    fast.tick = OFFLINE.windowTicks;
    for (let i = 0; i < 200; i++) fast.stats.recentShipments.push({ tick: fast.tick - i * 20, coins: 300, items: 6 });
    expect(contractPace(fast).ship).toBeCloseTo(20, 5);
    expect(contractPace(slow).ship).toBeCloseTo(((60 * TICKS_PER_SECOND) / 250) * CONTRACTS.paceFloorFactor, 5);
    syncContracts(slow, DAY1);
    syncContracts(fast, DAY1);
    const sum = (w: WorldState) => w.contracts!.list.reduce((a, c) => a + c.reward.coins, 0);
    expect(sum(fast)).toBeGreaterThan(sum(slow) * 5);
    expect(niceNumber(1234)).toBe(1200);
    expect(niceNumber(47)).toBe(45);
    expect(niceNumber(7.4)).toBe(7);
  });

  it('出荷で進む: 件数・カテゴリ・スピード・無遅延', () => {
    const w = createWorld({ seed: 4 });
    syncContracts(w, DAY1);
    const st = w.contracts!;
    const vol = setOnly(w, { kind: 'volume', target: 2 });
    shipOrder(w, order(w, [['book', 1]]), 0);
    expect(vol.progress).toBe(1);
    shipOrder(w, order(w, [['book', 1]]), 0);
    expect(vol.state).toBe('done');
    expect(st.completed).toBe(1);
    expect(w.events.some((e) => e.type === 'contractDone' && e.id === vol.id)).toBe(true);
    expect(achievementValue(w, 'contracts')).toBe(1);

    const cat = setOnly(w, { kind: 'category', target: 5, client: 'marufuku' });
    shipOrder(w, order(w, [['apple', 3], ['book', 4]]), 0);
    expect(cat.progress).toBe(3); // りんごだけ
    expect(ITEM_BY_ID.apple.category).toBe('food');

    const fast = setOnly(w, { kind: 'fast', target: 3, limitSec: 45 });
    w.tick += 100 * TICKS_PER_SECOND;
    shipOrder(w, order(w, [['book', 1]], { shownTick: w.tick - 44 * TICKS_PER_SECOND }), 0);
    shipOrder(w, order(w, [['book', 1]], { shownTick: w.tick - 46 * TICKS_PER_SECOND }), 0);
    expect(fast.progress).toBe(1);

    const clean = setOnly(w, { kind: 'clean', target: 3 });
    shipOrder(w, order(w, [['book', 1]]), 0);
    shipOrder(w, order(w, [['book', 1]]), 0);
    shipOrder(w, order(w, [['book', 1]], { penalized: true }), 0);
    expect(clean.progress).toBe(0); // 遅延で 0 に戻る
  });

  it('特注: 受けると入荷トラックが来て注文が順に入り、全部出荷で達成。日付が変わると残りはふつうの注文に', () => {
    const w = createWorld({ seed: 5 });
    syncContracts(w, DAY1);
    const c = setOnly(w, { kind: 'bulk', target: 2, state: 'offered', pending: [[{ item: 'apple', qty: 2 }], [{ item: 'apple', qty: 1 }, { item: 'book', qty: 2 }]] });
    expect(contractBadge(w)).toBe(1);
    expect(rerollCost(c)).not.toBeNull();
    const rt = createRuntime();
    const before = w.orders.length;
    stepSim(w, rt);
    expect(w.orders.filter((o) => o.contract === c.id)).toHaveLength(0); // 受けるまで入らない
    expect(acceptContract(w, c.id).ok).toBe(true);
    expect(acceptContract(w, c.id).ok).toBe(false);
    expect(rerollCost(c)).toBeNull(); // 進行中の特注は入れ替え不可
    const truck = w.trucks.find((t) => t.kind === 'prestock')!;
    expect(truck.pallets).toEqual(expect.arrayContaining([{ item: 'apple', qty: Math.ceil(3 * CONTRACTS.bulk.stockFactor) }, { item: 'book', qty: Math.ceil(2 * CONTRACTS.bulk.stockFactor) }]));
    for (let i = 0; i < CONTRACTS.bulk.firstDelayTicks + CONTRACTS.bulk.intervalTicks + 2; i++) stepSim(w, rt);
    const special = w.orders.filter((o) => o.contract === c.id);
    expect(special).toHaveLength(2);
    expect(w.orders.length).toBeGreaterThanOrEqual(before + 2);
    expect(c.pending).toHaveLength(0);
    for (const o of special) for (const l of o.lines) l.picked = l.qty;
    shipOrder(w, special[0], 0);
    expect(c.state).toBe('active');
    // 残り 1 件のまま日付が変わる → 依頼は消え、注文は印が外れて残る
    syncContracts(w, DAY2);
    expect(w.contracts!.list).not.toContain(c);
    expect(w.orders).toContain(special[1]);
    expect(special[1].contract).toBeUndefined();
  });

  it('メガDC で特注を受けると、ふつうに回して全部出荷される', () => {
    const w = buildPreset('mega');
    w.sandbox = false;
    const rt = createRuntime();
    for (let i = 0; i < 3 * 60 * TICKS_PER_SECOND; i++) stepSim(w, rt);
    syncContracts(w, DAY1);
    const st = w.contracts!;
    // 特注が出るまで入れ替える（種類は乱数）
    let bulk = st.list.find((c) => c.kind === 'bulk');
    w.coins = 1e9;
    for (let i = 0; i < 40 && !bulk; i++) {
      const target = st.list.find((c) => c.period === 'daily' && rerollCost(c) !== null)!;
      expect(rerollContract(w, target.id).ok).toBe(true);
      bulk = st.list.find((c) => c.kind === 'bulk');
    }
    expect(bulk).toBeDefined();
    expect(bulk!.target).toBeGreaterThanOrEqual(CONTRACTS.minTarget.bulk);
    expect(bulk!.target).toBeLessThanOrEqual(CONTRACTS.bulk.maxOrders);
    expect(acceptContract(w, bulk!.id).ok).toBe(true);
    for (let i = 0; i < 12 * 60 * TICKS_PER_SECOND && bulk!.state !== 'done'; i++) stepSim(w, rt);
    expect(bulk!.state).toBe('done');
  }, 120_000);

  it('受け取り: 取引先のレベルと渉外部で増える。2 度は受け取れない', () => {
    const w = createWorld({ seed: 6 });
    syncContracts(w, DAY1);
    const c = setOnly(w, { kind: 'volume', target: 1, reward: { coins: 1000, trust: 10 } });
    expect(claimContract(w, c.id, 1).ok).toBe(false); // まだ
    shipOrder(w, order(w, [['book', 1]]), 0);
    w.hq = { sales: 0, relations: 2, slots: 0, offline: 0 };
    expect(contractCoins(w, c, 3)).toBe(Math.round(1000 * 1.2 * 1.2));
    const coins0 = w.coins;
    const r = claimContract(w, c.id, 3);
    expect(r.ok && r.coins).toBe(1440);
    expect(r.ok && r.trust).toBe(10);
    expect(r.ok && r.client).toBe('marufuku');
    expect(w.coins).toBe(coins0 + 1440);
    expect(claimContract(w, c.id, 3).ok).toBe(false);
    expect(contractBadge(w)).toBe(0);
    // 信用 → レベル
    expect(clientLevel(0)).toBe(1);
    expect(clientLevel(30)).toBe(2);
    expect(clientLevel(399)).toBe(4);
    expect(clientLevel(9999)).toBe(5);
    expect(nextLevelTrust(0)).toBe(30);
    expect(nextLevelTrust(400)).toBeNull();
    expect(levelRewardFactor(5)).toBeCloseTo(1.4, 5);
    expect(CLIENT_BY_ID.popo.categories).toEqual(['toy']);
  });

  it('入れ替え: コインを払い、種類が変わる。足りなければ不可、毎週は不可', () => {
    const w = createWorld({ seed: 7 });
    syncContracts(w, DAY1);
    const st = w.contracts!;
    const c = st.list.find((x) => x.period === 'daily')!;
    const cost = rerollCost(c)!;
    expect(cost).toBeGreaterThanOrEqual(CONTRACTS.rerollMinCost);
    w.coins = cost - 1;
    expect(rerollContract(w, c.id).ok).toBe(false);
    w.coins = cost;
    const idx = st.list.indexOf(c);
    expect(rerollContract(w, c.id).ok).toBe(true);
    expect(w.coins).toBe(0);
    expect(st.list[idx].id).not.toBe(c.id);
    expect(st.list[idx].kind).not.toBe(c.kind);
    expect(st.list.filter((x) => x.period === 'daily')).toHaveLength(3);
    expect(rerollCost(st.list.find((x) => x.period === 'weekly')!)).toBeNull();
  });

  it('お留守番: 件数とカテゴリだけ進む', () => {
    const w = createWorld({ seed: 8 });
    syncContracts(w, DAY1);
    w.stats.shippedByItem = { apple: 30, book: 70 };
    const st = w.contracts!;
    st.list = [
      { id: 1, period: 'daily', key: st.dayKey, client: 'marufuku', kind: 'volume', target: 100, progress: 0, state: 'active', reward: { coins: 1, trust: 1 } },
      { id: 2, period: 'daily', key: st.dayKey, client: 'marufuku', kind: 'category', target: 100, progress: 0, state: 'active', reward: { coins: 1, trust: 1 } },
      { id: 3, period: 'daily', key: st.dayKey, client: 'marufuku', kind: 'fast', target: 100, progress: 0, state: 'active', limitSec: 45, reward: { coins: 1, trust: 1 } },
    ];
    contractsOffline(w, 40, 200);
    expect(st.list[0].progress).toBe(40);
    expect(st.list[1].progress).toBe(60); // 200 個 × りんご 30%
    expect(st.list[2].progress).toBe(0);
    contractsOffline(w, 80, 0);
    expect(st.list[0].state).toBe('done');
  });

  it('サンドボックスのプリセット倉庫には来ない。セーブに残る', () => {
    const p = buildPreset('medium');
    expect(p.sandbox).toBe(true);
    expect(syncContracts(p, DAY1).added).toBe(0);
    expect(p.contracts).toBeUndefined();
    const w = createWorld({ seed: 9 });
    syncContracts(w, DAY1);
    w.hq = { sales: 1, relations: 0, slots: 1, offline: 2 };
    const r = deserialize(serialize(w));
    expect(r.ok && r.world.contracts!.list).toHaveLength(4);
    expect(r.ok && r.world.hq).toEqual(w.hq);
    // 古いセーブ（contracts / hq が無い）も読める
    const old = createWorld({ seed: 10 });
    const r2 = deserialize(serialize(old));
    expect(r2.ok && r2.world.contracts).toBeUndefined();
    expect(r2.ok && hqLevel(r2.world, 'sales')).toBe(0);
  });
});

describe('1.2 本社への投資', () => {
  it('段と値段、効果', () => {
    const w = createWorld({ seed: 11 });
    expect(salesFactor(w)).toBe(1);
    expect(dailySlots(w)).toBe(3);
    expect(offlineCapMs(w)).toBe(8 * 3600_000);
    expect(hqCost(w, 'sales')).toBe(50_000);
    expect(buyHq(w, 'sales').ok).toBe(false); // 足りない
    w.coins = 1e12;
    expect(buyHq(w, 'sales').ok).toBe(true);
    expect(hqCost(w, 'sales')).toBe(110_000);
    expect(salesFactor(w)).toBeCloseTo(1.02, 5);
    for (let i = 1; i < HQ.sales.levels; i++) expect(buyHq(w, 'sales').ok).toBe(true);
    expect(hqCost(w, 'sales')).toBeNull();
    expect(buyHq(w, 'sales').ok).toBe(false);
    expect(salesFactor(w)).toBeCloseTo(1.24, 5);
    expect(buyHq(w, 'slots').ok).toBe(true);
    expect(dailySlots(w)).toBe(4);
    for (let i = 0; i < HQ.offline.costs.length; i++) expect(buyHq(w, 'offline').ok).toBe(true);
    expect(offlineCapMs(w)).toBe(24 * 3600_000);
    // ロングランは設備の倍率（×3）
    const lr = createWorld({ seed: 12 });
    lr.economy = 'longrun';
    expect(hqCost(lr, 'relations')).toBe(90_000);
  });

  it('営業部は出荷の報酬に、受注窓口は毎日の依頼の件数に、留守番体制はお留守番の上限に効く', () => {
    const a = createWorld({ seed: 13 });
    const b = createWorld({ seed: 13 });
    b.hq = { sales: 5, relations: 0, slots: 2, offline: 3 };
    shipOrder(a, order(a, [['book', 10]]), 0);
    shipOrder(b, order(b, [['book', 10]]), 0);
    expect(b.coins - 0).toBeGreaterThan(a.coins);
    expect((b.stats.totalCoins / a.stats.totalCoins)).toBeCloseTo(1.1, 2);
    syncContracts(b, DAY1);
    expect(b.contracts!.list.filter((c) => c.period === 'daily')).toHaveLength(5);
    // 途中で窓口を増やすと、その日のうちに 1 件足される
    syncContracts(a, DAY1);
    a.coins = 1e9;
    buyHq(a, 'slots');
    expect(syncContracts(a, DAY1).added).toBe(1);
    // お留守番: 20 時間の離席 → 標準は 8 時間、留守番体制 3 段は 16 時間で頭打ち
    const r1 = applyOffline(createWorld({ seed: 14 }), 20 * 3600_000);
    const w2 = createWorld({ seed: 14 });
    w2.hq = { sales: 0, relations: 0, slots: 0, offline: 3 };
    const r2 = applyOffline(w2, 20 * 3600_000);
    expect(r1.cappedBy === 'max' || r1.cappedBy === 'cyberWeek').toBe(true);
    expect(r2.elapsedMs).toBeGreaterThanOrEqual(r1.elapsedMs);
  });
});
