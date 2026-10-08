/**
 * 機能フラグ（SPEC-iOS §1）。購入した商品 → 使える機能。
 * iOS ではネイティブから購入状態をもらう。Web 版では何も解放されない（開発用に localStorage の上書きだけ可）
 */
import { native } from './native';

export type Feature = 'specialRobots' | 'limits' | 'sandbox' | 'cosmetics';

export const PRODUCTS = {
  robots: 'jp.hakoniwa.ds.robots',
  limits: 'jp.hakoniwa.ds.limits',
  sandbox: 'jp.hakoniwa.ds.sandbox',
  supporter: 'jp.hakoniwa.ds.supporter',
} as const;

const FEATURES_OF: Record<string, Feature[]> = {
  [PRODUCTS.robots]: ['specialRobots'],
  [PRODUCTS.limits]: ['limits'],
  [PRODUCTS.sandbox]: ['sandbox'],
  [PRODUCTS.supporter]: ['specialRobots', 'limits', 'sandbox', 'cosmetics'],
};

const DEV_KEY = 'jido-soko-no-kibun:features';
let owned = new Set<string>();
const changeHandlers = new Set<() => void>();

export function featuresFromProducts(ids: Iterable<string>): Set<Feature> {
  const out = new Set<Feature>();
  for (const id of ids) for (const f of FEATURES_OF[id] ?? []) out.add(f);
  return out;
}

export function hasFeature(f: Feature): boolean {
  if (featuresFromProducts(owned).has(f)) return true;
  // 開発用: Web 版で UI を確認するための上書き（例: localStorage 'jido-soko-no-kibun:features' = 'all' または 'sandbox,limits'）
  try {
    const dev = localStorage.getItem(DEV_KEY);
    if (dev === 'all') return true;
    if (dev && dev.split(',').map((s) => s.trim()).includes(f)) return true;
  } catch {
    /* ignore */
  }
  return false;
}

export function ownedProducts(): ReadonlySet<string> {
  return owned;
}

export function setOwnedProducts(ids: Iterable<string>): void {
  const next = new Set(ids);
  // 同じ内容なら知らせない（起動時にネイティブから同じ一覧が 2 度来る）
  if (next.size === owned.size && [...next].every((id) => owned.has(id))) {
    owned = next;
    return;
  }
  owned = next;
  for (const h of changeHandlers) h();
}

export function onEntitlementsChange(h: () => void): () => void {
  changeHandlers.add(h);
  return () => changeHandlers.delete(h);
}

/** 起動時: ネイティブから購入状態を取り、変化も購読する */
export async function initEntitlements(): Promise<void> {
  if (!native.available) return;
  try {
    const r = await native.call<{ ids: string[] }>('entitlements');
    setOwnedProducts(r.ids ?? []);
  } catch {
    /* 取れなければ未購入扱い。後で emit が来れば更新される */
  }
  native.on('entitlements', (p) => setOwnedProducts(((p as { ids?: string[] }) ?? {}).ids ?? []));
}
