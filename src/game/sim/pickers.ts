/** ピッカーと入荷担当の作業（§5）。ステーションに横付けした搬送ロボのビンを 1 個ずつ処理する */
import { INBOUND_WORKER, PICKER } from '../data/balance';
import { shipOrder } from './economy';
import { isOrderComplete, visibleOrders } from './orders';
import type { Robot, Station, WorldState } from './types';

export function pickTicks(s: Station): number {
  return PICKER.pickTicksByLevel[Math.min(s.level, PICKER.pickTicksByLevel.length - 1)];
}

function workingRobotAt(w: WorldState, s: Station): Robot | null {
  for (const r of w.robots) {
    if (r.phase === 'working' && r.job?.type === 'deliver' && r.job.stationId === s.id) return r;
  }
  return null;
}

export function neededForItem(w: WorldState, item: string): number {
  let n = 0;
  for (const o of visibleOrders(w)) for (const l of o.lines) if (l.item === item) n += Math.max(0, l.qty - l.picked);
  return n;
}

/** 入荷ステーションでビンに詰められる数（ビンの空き × 入荷口の山） */
export function stuffableCount(w: WorldState, binId: number): { count: number; item: string | null } {
  const bin = w.bins[binId];
  const room = w.binCapacity - bin.qty;
  if (room <= 0) return { count: 0, item: bin.item };
  if (bin.item) {
    const p = w.pallets.find((p) => p.item === bin.item);
    return { count: p ? Math.min(room, p.qty) : 0, item: bin.item };
  }
  // 空ビン: 一番多く滞留している商品を詰める
  let best = null as { item: string; qty: number } | null;
  for (const p of w.pallets) if (!best || p.qty > best.qty) best = p;
  return best ? { count: Math.min(room, best.qty), item: best.item } : { count: 0, item: null };
}

function startWork(w: WorldState, s: Station, r: Robot): void {
  const binId = r.carrying[r.step - 1];
  const bin = w.bins[binId];
  let count = 0;
  let ticks = 1;
  if (s.kind === 'pick') {
    count = bin.item ? Math.min(bin.qty, neededForItem(w, bin.item)) : 0;
    const assigned = bin.item ? s.assignedItems.includes(bin.item) : true;
    ticks = count ? Math.round((count * pickTicks(s)) / (assigned ? 1 : PICKER.offDutySpeedFactor)) : pickTicks(s);
  } else {
    count = stuffableCount(w, binId).count;
    ticks = count ? count * INBOUND_WORKER.stuffTicksPerItem : INBOUND_WORKER.stuffTicksPerItem;
  }
  s.work = { robotId: r.id, binId, remaining: Math.max(1, ticks), count };
}

function finishWork(w: WorldState, s: Station): void {
  const work = s.work!;
  const r = w.robots.find((r) => r.id === work.robotId);
  const bin = w.bins[work.binId];
  if (bin) {
    if (s.kind === 'pick' && bin.item) {
      let left = Math.min(work.count, bin.qty);
      for (const o of visibleOrders(w)) {
        if (left <= 0) break;
        for (const l of o.lines) {
          if (l.item !== bin.item || left <= 0) continue;
          const take = Math.min(left, l.qty - l.picked);
          if (take <= 0) continue;
          l.picked += take;
          bin.qty -= take;
          left -= take;
        }
      }
      const picked = Math.min(work.count, Math.max(0, work.count - left));
      if (picked > 0) w.events.push({ type: 'pick', stationId: s.id, item: bin.item, count: picked });
      if (bin.qty <= 0) {
        bin.qty = 0;
        bin.item = null; // 空ビンとして残る（§3.1）
        w.stats.stockouts++;
      }
      // 完了したオーダーを出荷
      for (const o of [...visibleOrders(w)]) if (isOrderComplete(o)) shipOrder(w, o, s.id);
    } else if (s.kind === 'inbound') {
      const { count, item } = stuffableCount(w, work.binId);
      if (count > 0 && item) {
        const p = w.pallets.find((p) => p.item === item)!;
        bin.item = item;
        bin.qty += count;
        p.qty -= count;
        if (p.qty <= 0) w.pallets.splice(w.pallets.indexOf(p), 1);
      }
    }
  }
  s.work = null;
  if (r && r.phase === 'working') {
    r.step++;
    if (r.step - 1 >= r.carrying.length) r.phase = 'idle';
  }
}

export function updateStations(w: WorldState): void {
  for (const s of w.stations) {
    if (s.work) {
      s.work.remaining--;
      if (s.work.remaining <= 0) finishWork(w, s);
      continue;
    }
    const r = workingRobotAt(w, s);
    if (r && r.step >= 1 && r.step - 1 < r.carrying.length) startWork(w, s, r);
    else if (r) r.phase = 'idle';
  }
}
