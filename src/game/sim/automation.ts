/**
 * 自動行動。
 *  基本（常時）: ビン返却の自動化（§7.1-3）、暇なロボは待機スポットへ（§4.3）
 *  AI アップグレード（§7.3）は M9 で追加
 */
import { manhattan } from './grid';
import { nearestPort, setGoal } from './robots';
import type { Runtime } from './runtime';
import type { Robot, WorldState } from './types';

function idle(r: Robot): boolean {
  return !r.job && !r.queue.length && r.actRemaining === 0 && r.phase === 'idle';
}

export function updateAutomation(w: WorldState, rt: Runtime): void {
  // 棚ロボ: 返却ビンの格納（自動）
  const storeTargets = new Set<number>();
  for (const r of w.robots) if (r.job?.type === 'store') storeTargets.add(r.job.portId);
  for (const r of w.robots) {
    if (r.kind !== 'shelf' || !idle(r)) continue;
    const port = nearestPort(w, r.pose.x, r.pose.z, (p) => p.returns.length > 0 && !storeTargets.has(p.id));
    if (port) {
      r.job = { type: 'store', portId: port.id, binId: null, stackId: null, manual: false };
      r.step = 0;
      storeTargets.add(port.id);
      continue;
    }
    // ポートの上で暇にしているとポートを塞ぐので隣のスタックへ退く
    if (w.ports.some((p) => p.x === r.pose.x && p.z === r.pose.z)) {
      let best = null as { x: number; z: number } | null;
      let bd = Infinity;
      for (const s of w.stacks) {
        const occupied = w.robots.some((o) => o !== r && o.kind === 'shelf' && ((o.pose.x === s.x && o.pose.z === s.z) || (o.moveTo?.x === s.x && o.moveTo?.z === s.z)));
        if (occupied) continue;
        const d = manhattan(r.pose, s);
        if (d < bd) {
          bd = d;
          best = s;
        }
      }
      if (best) r.job = { type: 'park', x: best.x, z: best.z, manual: false };
    }
  }

  // 搬送ロボ: 暇なら待機スポットへ
  const claimed = new Set<string>();
  for (const r of w.robots) {
    if (r.kind !== 'amr') continue;
    if (r.job?.type === 'park') claimed.add(`${r.job.x},${r.job.z}`);
    claimed.add(`${r.pose.x},${r.pose.z}`);
  }
  for (const r of w.robots) {
    if (r.kind !== 'amr' || !idle(r)) continue;
    const onSpot = w.waitSpots.some((s) => s.x === r.pose.x && s.z === r.pose.z);
    if (onSpot) continue;
    let best = null as { x: number; z: number } | null;
    let bd = Infinity;
    for (const s of w.waitSpots) {
      if (claimed.has(`${s.x},${s.z}`)) continue;
      const d = manhattan(r.pose, s);
      if (d < bd) {
        bd = d;
        best = s;
      }
    }
    if (best) {
      r.job = { type: 'park', x: best.x, z: best.z, manual: false };
      r.step = 0;
      claimed.add(`${best.x},${best.z}`);
      setGoal(rt, r, null);
    }
  }
}
