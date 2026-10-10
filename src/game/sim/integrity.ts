/**
 * ビンの整合性（★）: すべてのビンは「スタック・ロボの手・ポート」のどれか 1 か所にある。
 * 仕事の切り替えでビンが行方不明になる不具合があった（第 24 回。在庫はあるのに出荷できない）。
 * 直した上で、古いセーブや想定外の経路のために、読み込み時と定期的に点検して行方不明のビンを棚に戻す。
 */
import { PORT } from '../data/balance';
import { pickStackWithRoom } from './robots';
import type { WorldState } from './types';

/** どこにも無いビンの id */
export function auditBins(w: WorldState): number[] {
  const placed = new Set<number>();
  for (const s of w.stacks) for (const id of s.bins) placed.add(id);
  for (const r of w.robots) {
    for (const id of r.carrying) placed.add(id);
    for (const id of r.digging?.movedBins ?? []) placed.add(id);
  }
  for (const p of w.ports) {
    for (const id of p.outbound) placed.add(id);
    for (const id of p.returns) placed.add(id);
  }
  const out: number[] = [];
  for (const key of Object.keys(w.bins)) {
    const id = Number(key);
    if (!placed.has(id)) out.push(id);
  }
  return out;
}

/** 行方不明のビンを棚（無ければポートの返却側）へ戻す。戻した数を返し、あればお知らせを出す */
export function rehomeOrphans(w: WorldState): number {
  const orphans = auditBins(w);
  if (!orphans.length) return 0;
  const center = { x: Math.floor(w.width / 2), z: Math.floor(w.height / 2) };
  let n = 0;
  for (const id of orphans) {
    const b = w.bins[id];
    if (b) b.purpose = null;
    const stack = pickStackWithRoom(w, center, undefined, undefined, id);
    if (stack) {
      stack.bins.push(id);
      n++;
      continue;
    }
    const port = w.ports.find((p) => p.returns.length < PORT.returnCapacity) ?? w.ports[0];
    if (port) {
      port.returns.push(id);
      n++;
    }
  }
  if (n) w.events.push({ type: 'notice', icon: 'info', text: `行方不明だったビン ${n} 個を棚に戻しました` });
  return n;
}
