/**
 * 時空間予約テーブル（§4.3）。
 * セルごとに [from, to] の tick 区間と所有ロボを持つ。to = Infinity は「以後ずっと」。
 * 時間は絶対 tick。
 */
export interface Reservation {
  from: number;
  to: number;
  robotId: number;
}

export class ReservationTable {
  private cells = new Map<number, Reservation[]>();

  clear(): void {
    this.cells.clear();
  }

  reserve(cellIdx: number, from: number, to: number, robotId: number): void {
    let arr = this.cells.get(cellIdx);
    if (!arr) {
      arr = [];
      this.cells.set(cellIdx, arr);
    }
    arr.push({ from, to, robotId });
  }

  /** [from, to] の区間に robotId 以外の予約があるか */
  isReserved(cellIdx: number, from: number, to: number, robotId: number): boolean {
    const arr = this.cells.get(cellIdx);
    if (!arr) return false;
    for (const r of arr) {
      if (r.robotId === robotId) continue;
      if (r.from <= to && from <= r.to) return true;
    }
    return false;
  }

  /** そのセルを from 以降に予約している他ロボがいるか（最後尾の予約が無限なら true） */
  isReservedForever(cellIdx: number, from: number, robotId: number): boolean {
    const arr = this.cells.get(cellIdx);
    if (!arr) return false;
    return arr.some((r) => r.robotId !== robotId && r.to === Infinity && r.from <= from);
  }

  /** このロボの予約をすべて消す */
  release(robotId: number): void {
    for (const [k, arr] of this.cells) {
      const kept = arr.filter((r) => r.robotId !== robotId);
      if (kept.length) this.cells.set(k, kept);
      else this.cells.delete(k);
    }
  }

  /** 古い予約を捨てる */
  prune(now: number): void {
    for (const [k, arr] of this.cells) {
      const kept = arr.filter((r) => r.to >= now);
      if (kept.length) this.cells.set(k, kept);
      else this.cells.delete(k);
    }
  }

  /** デバッグ・テスト用: ある tick にそのセルを予約しているロボ一覧 */
  ownersAt(cellIdx: number, t: number): number[] {
    const arr = this.cells.get(cellIdx);
    if (!arr) return [];
    return arr.filter((r) => r.from <= t && t <= r.to).map((r) => r.robotId);
  }
}
