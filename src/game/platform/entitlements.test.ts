import { beforeEach, describe, expect, it } from 'vitest';
import { featuresFromProducts, hasFeature, onEntitlementsChange, ownedProducts, PRODUCTS, setOwnedProducts } from './entitlements';

describe('entitlements（購入 → 機能フラグ）', () => {
  beforeEach(() => setOwnedProducts([]));

  it('商品ごとの機能。サポーターは全部', () => {
    expect([...featuresFromProducts([PRODUCTS.robots])]).toEqual(['specialRobots']);
    expect([...featuresFromProducts([PRODUCTS.limits])]).toEqual(['limits']);
    expect([...featuresFromProducts([PRODUCTS.sandbox])]).toEqual(['sandbox']);
    expect(new Set(featuresFromProducts([PRODUCTS.supporter]))).toEqual(new Set(['specialRobots', 'limits', 'sandbox', 'cosmetics']));
    expect([...featuresFromProducts(['unknown'])]).toEqual([]);
  });

  it('未購入なら何も解放されない。購入で解放。重ねても壊れない', () => {
    expect(hasFeature('sandbox')).toBe(false);
    setOwnedProducts([PRODUCTS.sandbox]);
    expect(hasFeature('sandbox')).toBe(true);
    expect(hasFeature('limits')).toBe(false);
    setOwnedProducts([PRODUCTS.sandbox, PRODUCTS.limits]);
    expect(hasFeature('limits')).toBe(true);
    expect(ownedProducts().size).toBe(2);
  });

  it('変化したときだけ通知する（同じ一覧は無視。返金で消えたときも通知）', () => {
    let n = 0;
    const off = onEntitlementsChange(() => n++);
    setOwnedProducts([PRODUCTS.robots]);
    setOwnedProducts([PRODUCTS.robots]);
    expect(n).toBe(1);
    setOwnedProducts([]);
    expect(n).toBe(2);
    expect(hasFeature('specialRobots')).toBe(false);
    off();
    setOwnedProducts([PRODUCTS.robots]);
    expect(n).toBe(2);
  });
});
