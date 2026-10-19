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
  /** ロボごとに予約したセル（release を速くする） */
  private byRobot = new Map<number, Set<number>>();

  clear(): void {
    this.cells.clear();
    this.byRobot.clear();
  }

  /** 写し（フォトモードのシャッターで、シミュレーションの写しを進めるため） */
  clone(): ReservationTable {
    const c = new ReservationTable();
    for (const [k, arr] of this.cells) c.cells.set(k, arr.map((r) => ({ ...r })));
    for (const [k, set] of this.byRobot) c.byRobot.set(k, new Set(set));
    return c;
  }

  reserve(cellIdx: number, from: number, to: number, robotId: number): void {
    let arr = this.cells.get(cellIdx);
    if (!arr) {
      arr = [];
      this.cells.set(cellIdx, arr);
    }
    arr.push({ from, to, robotId });
    let set = this.byRobot.get(robotId);
    if (!set) {
      set = new Set();
      this.byRobot.set(robotId, set);
    }
    set.add(cellIdx);
  }

  /** [from, to] の区間に robotId（と ignore に含まれるロボ）以外の予約があるか */
  isReserved(cellIdx: number, from: number, to: number, robotId: number, ignore?: Set<number>): boolean {
    const arr = this.cells.get(cellIdx);
    if (!arr) return false;
    for (const r of arr) {
      if (r.robotId === robotId || ignore?.has(r.robotId)) continue;
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

  /** from 以降にそのセルを予約している他ロボの ID（無期限予約と衝突する相手を探す） */
  othersAfter(cellIdx: number, from: number, robotId: number, out: Set<number>): void {
    const arr = this.cells.get(cellIdx);
    if (!arr) return;
    for (const r of arr) if (r.robotId !== robotId && r.to >= from) out.add(r.robotId);
  }

  /** このロボの予約をすべて消す */
  release(robotId: number): void {
    const set = this.byRobot.get(robotId);
    if (!set) return;
    for (const k of set) {
      const arr = this.cells.get(k);
      if (!arr) continue;
      const kept = arr.filter((r) => r.robotId !== robotId);
      if (kept.length) this.cells.set(k, kept);
      else this.cells.delete(k);
    }
    this.byRobot.delete(robotId);
  }

  /** 古い予約を捨てる */
  prune(now: number): void {
    for (const [k, arr] of this.cells) {
      const kept = arr.filter((r) => r.to >= now);
      if (kept.length) this.cells.set(k, kept);
      else this.cells.delete(k);
    }
    for (const [id, set] of this.byRobot) {
      for (const k of set) if (!this.cells.get(k)?.some((r) => r.robotId === id)) set.delete(k);
      if (!set.size) this.byRobot.delete(id);
    }
  }

  /** デバッグ・テスト用: ある tick にそのセルを予約しているロボ一覧 */
  ownersAt(cellIdx: number, t: number): number[] {
    const arr = this.cells.get(cellIdx);
    if (!arr) return [];
    return arr.filter((r) => r.from <= t && t <= r.to).map((r) => r.robotId);
  }
}
