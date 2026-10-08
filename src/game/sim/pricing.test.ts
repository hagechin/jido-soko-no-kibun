/** 経済モード（ロングラン）: 値段・報酬・昇格条件の倍率 */
import { describe, expect, it } from 'vitest';
import { AUTOMATION, BUILD, ECONOMY_MODES, RANKS, REWARD, ROBOT } from '../data/balance';
import { buildCost, expansionCost } from './build';
import { rewardFor } from './economy';
import { automationPrice, dispatchPrice, price, rankShippedAt, coinPerItemAt } from './pricing';
import { checkRankUp, nextRankRequirement } from './rank';
import { deserialize, serialize } from './save';
import { buyAmr, buyAutomation, speedUpgradeCost, upgradeAllRobotsCost } from './shop';
import { createWorld } from './world';

describe('経済モード', () => {
  it('標準は今までと同じ値段・報酬・昇格条件', () => {
    const w = createWorld({ seed: 1 });
    expect(w.economy).toBe('standard');
    expect(price(w, ROBOT.amrCost)).toBe(ROBOT.amrCost);
    expect(dispatchPrice(w, 0)).toBe(AUTOMATION.dispatchCosts[0]);
    expect(rankShippedAt(w, 1)).toBe(RANKS[1].shipped);
    expect(coinPerItemAt({ ...w, rank: 4 })).toBe(REWARD.coinPerItemByRank[4]);
  });

  it('ロングラン: ロボ・建設・拡張・強化は costFactor 倍、自動化は automationCostFactor 倍、昇格は rankShippedFactor 倍', () => {
    const w = createWorld({ seed: 1 });
    w.economy = 'longrun';
    const m = ECONOMY_MODES.longrun;
    expect(price(w, ROBOT.amrCost)).toBe(Math.round(ROBOT.amrCost * m.costFactor));
    expect(buildCost(w, 'stack')).toBe(Math.round(BUILD.stackCost * m.costFactor));
    expect(speedUpgradeCost(w.robots[0], w)).toBe(Math.round(ROBOT.speedUpgradeCosts[0] * m.costFactor));
    expect(upgradeAllRobotsCost(w)).toBe(Math.round(upgradeAllRobotsCost({ ...w, economy: 'standard' })! * m.costFactor));
    const std = createWorld({ seed: 1 });
    expect(expansionCost(w, 'east')).toBe(Math.round(expansionCost(std, 'east')! * m.costFactor));
    expect(dispatchPrice(w, 1)).toBe(Math.round(AUTOMATION.dispatchCosts[1] * m.automationCostFactor));
    expect(automationPrice(w, AUTOMATION.restockCost)).toBe(Math.round(AUTOMATION.restockCost * m.automationCostFactor));
    expect(rankShippedAt(w, 1)).toBe(Math.round(RANKS[1].shipped * m.rankShippedFactor));
    expect(nextRankRequirement(w)?.shipped).toBe(rankShippedAt(w, 1));
    // 買うときも同じ額を払う
    w.coins = 10_000;
    buyAmr(w);
    expect(w.coins).toBe(10_000 - price(w, ROBOT.amrCost));
    buyAutomation(w, 'dispatch');
    expect(w.coins).toBe(10_000 - price(w, ROBOT.amrCost) - dispatchPrice(w, 0));
  });

  it('ロングラン: 報酬は coinFactor 倍で、単価はランクでほぼ上がらない', () => {
    const w = createWorld({ seed: 1 });
    const o = { id: 1, lines: [{ item: 'apple', qty: 3, picked: 0 }], arrivedTick: 0, shownTick: null, penalized: false };
    const std = rewardFor(w, o).total;
    w.economy = 'longrun';
    expect(rewardFor(w, o).total).toBe(Math.round(std * ECONOMY_MODES.longrun.coinFactor));
    w.rank = 4;
    expect(coinPerItemAt(w)).toBe(ECONOMY_MODES.longrun.coinPerItemByRank![4]);
    expect(coinPerItemAt(w)).toBeLessThan(REWARD.coinPerItemByRank[4] / 2);
  });

  it('ロングラン: 昇格は出荷数 1.5 倍で、ボーナスは半分', () => {
    const w = createWorld({ seed: 1 });
    w.economy = 'longrun';
    w.stats.totalShipped = RANKS[1].shipped; // 標準なら昇格する数
    expect(checkRankUp(w)).toBe(false);
    w.stats.totalShipped = rankShippedAt(w, 1);
    const before = w.coins;
    expect(checkRankUp(w)).toBe(true);
    expect(w.coins - before).toBe(Math.round(RANKS[1].bonusCoins * ECONOMY_MODES.longrun.rankBonusFactor));
  });

  it('古いセーブ（economy 無し）は標準として読める。ロングランはセーブに残る', () => {
    const w = createWorld({ seed: 1 });
    const file = JSON.parse(serialize(w));
    delete file.world.economy;
    const res = deserialize(JSON.stringify(file));
    expect(res.ok && (res.world.economy ?? 'standard')).toBe('standard');
    w.economy = 'longrun';
    const res2 = deserialize(serialize(w));
    expect(res2.ok && res2.world.economy).toBe('longrun');
  });
});
