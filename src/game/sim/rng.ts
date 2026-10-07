/** 決定的な乱数（mulberry32）。状態は number ひとつなのでセーブに入れられる。 */
export interface RngState {
  seed: number;
}

export function createRng(seed: number): RngState {
  return { seed: seed >>> 0 };
}

/** [0,1) */
export function rand(r: RngState): number {
  let t = (r.seed = (r.seed + 0x6d2b79f5) >>> 0);
  t = Math.imul(t ^ (t >>> 15), t | 1);
  t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
  return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}

/** [min, max] の整数 */
export function randInt(r: RngState, min: number, max: number): number {
  return min + Math.floor(rand(r) * (max - min + 1));
}

export function pick<T>(r: RngState, arr: readonly T[]): T {
  return arr[Math.floor(rand(r) * arr.length)];
}

export function shuffle<T>(r: RngState, arr: T[]): T[] {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rand(r) * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}
