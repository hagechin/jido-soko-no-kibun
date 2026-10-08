/**
 * ストア画面（SPEC-iOS §1, I3）: 商品一覧・購入・復元。iOS アプリの中だけで買える（Web 版は案内のみ）。
 * 商品情報はネイティブ（StoreKit 2）から取る。取れなければ「オンラインで再読み込み」を出す（オフラインでも遊べるのが前提）
 */
import { icon, iconText } from './icon';
import { native } from '../platform/native';
import { hasFeature, ownedProducts, PRODUCTS, setOwnedProducts, type Feature } from '../platform/entitlements';
import { el, showToast } from './layout';
import { tr } from '../i18n';

export interface StoreProduct {
  id: string;
  title: string;
  description: string;
  price: string;
  purchased: boolean;
}

export interface StoreContext {
  /** 購入・復元のあとでパネルを描き直す */
  refresh: () => void;
}

/** 商品の並び（ネイティブの一覧が空でも案内に使う） */
export const PRODUCT_ORDER: { id: string; name: string; desc: string }[] = [
  { id: PRODUCTS.robots, name: tr(tr(tr('特別ロボパック'))), desc: tr(tr(tr('ドローン搬送ロボ（棚を飛び越える。大きな倉庫で特に威力を発揮）と、ダブルデッカー棚ロボ（ビンを 2 段持つ。狭い棚でも棚ロボ 2 台ぶんの働きで序盤から活躍）'))) },
  { id: PRODUCTS.limits, name: tr(tr(tr('上限突破パック'))), desc: tr(tr(tr('ロボ上限 80/120 台、積載 Lv4、棚 12 段、倉庫 64×48'))) },
  { id: PRODUCTS.sandbox, name: tr(tr(tr('サンドボックスモード'))), desc: tr(tr(tr('コイン・プリセット倉庫・時間ジャンプ・ロボ MAX・停滞診断を設定から使える'))) },
  { id: PRODUCTS.supporter, name: tr(tr(tr('サポーターパック'))), desc: tr(tr(tr('上の 3 つ全部 ＋ 金色ロボスキン ＋ 倉庫カラーテーマ'))) },
];

const FEATURE_LABEL: Record<Feature, string> = {
  specialRobots: tr(tr(tr('特別ロボ（ドローン・ダブルデッカー）'))),
  limits: tr(tr(tr('上限突破'))),
  sandbox: tr(tr(tr('サンドボックス'))),
  cosmetics: tr(tr(tr('金色スキン・カラーテーマ'))),
};

/** 解放済み機能の一覧（設定パネルとストアで共用） */
export function featureStatusNode(): HTMLElement {
  const ul = el('ul', { class: 'feature-list' });
  for (const f of Object.keys(FEATURE_LABEL) as Feature[]) {
    const on = hasFeature(f);
    ul.append(el('li', { class: on ? 'is-on' : '' }, icon(on ? 'check' : 'ban', 14), el('span', { text: FEATURE_LABEL[f] })));
  }
  return ul;
}

let cache: StoreProduct[] | null = null;
let loading: Promise<StoreProduct[]> | null = null;

/** 商品一覧をネイティブから取る（1 回取れたら覚えておく。失敗は空配列） */
export function loadProducts(force = false): Promise<StoreProduct[]> {
  if (cache && !force) return Promise.resolve(cache);
  if (loading) return loading;
  loading = native
    .call<StoreProduct[]>('products', {}, 60_000)
    .then((list) => {
      cache = Array.isArray(list) && list.length ? list : null;
      return cache ?? [];
    })
    .catch(() => [])
    .finally(() => (loading = null));
  return loading;
}

export function renderStore(body: HTMLElement, ctx: StoreContext): void {
  if (!native.available) {
    body.append(el('p', { class: 'muted small', text: tr(tr(tr('ここに並ぶ追加機能は iOS 版（App Store）で購入できます。この Web 版では購入できません。'))) }));
    for (const p of PRODUCT_ORDER) body.append(el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: p.name }), el('div', { class: 'muted small', text: p.desc }))));
    body.append(el('h4', { text: tr(tr(tr('解放済みの機能'))) }));
    body.append(featureStatusNode());
    return;
  }

  body.append(el('p', { class: 'muted small', text: tr(tr(tr('買い切りです（広告なし・消耗品なし）。ファミリー共有に対応。再インストールしたときは「購入を復元」で戻ります。'))) }));
  const list = el('div', { class: 'store-list' });
  body.append(list);

  const restoreBtn = el('button', { class: 'btn', type: 'button' }, iconText('refresh-cw', tr(tr(tr('購入を復元')))));
  restoreBtn.addEventListener('click', async () => {
    restoreBtn.setAttribute('disabled', 'true');
    try {
      const r = await native.call<{ ids: string[] }>('restore', {}, 120_000);
      const ids = r.ids ?? [];
      setOwnedProducts(ids);
      showToast(ids.length ? tr(tr(tr('購入を復元しました（{0} 件）')), ids.length) : tr(tr(tr('復元できる購入はありません'))));
    } catch {
      showToast(tr(tr(tr('復元できませんでした。オンラインで試してください'))));
    }
    ctx.refresh();
  });
  body.append(el('div', { class: 'settings-row' }, restoreBtn));
  body.append(el('h4', { text: tr(tr(tr('解放済みの機能'))) }));
  body.append(featureStatusNode());

  const draw = (products: StoreProduct[]) => {
    list.replaceChildren();
    if (!products.length) {
      const retry = el('button', { class: 'btn', type: 'button' }, iconText('refresh-cw', tr(tr(tr('再読み込み')))));
      retry.addEventListener('click', () => {
        list.replaceChildren(el('p', { class: 'muted small', text: tr(tr(tr('読み込み中…'))) }));
        void loadProducts(true).then(draw);
      });
      list.append(el('p', { class: 'muted small', text: tr(tr(tr('商品を読み込めませんでした。オンラインのときに再読み込みしてください（ゲームはオフラインでも遊べます）。'))) }), el('div', { class: 'settings-row' }, retry));
      return;
    }
    const owned = ownedProducts();
    for (const meta of PRODUCT_ORDER) {
      const p = products.find((x) => x.id === meta.id);
      if (!p) continue;
      const bought = p.purchased || owned.has(p.id);
      const btn = el('button', { class: 'btn buy-btn', type: 'button' });
      if (bought) {
        btn.append(iconText('check', tr(tr(tr('購入済み'))), 14));
        btn.setAttribute('disabled', 'true');
      } else {
        btn.textContent = p.price;
        btn.title = tr(tr(tr('{0} を購入')), p.title);
        btn.addEventListener('click', async () => {
          btn.setAttribute('disabled', 'true');
          btn.textContent = '…';
          try {
            const r = await native.call<{ state: string }>('purchase', { id: p.id }, 10 * 60_000);
            if (r.state === 'purchased') {
              setOwnedProducts([...ownedProducts(), p.id]);
              showToast(tr(tr(tr('{0} を購入しました')), p.title), 3000, 'party-popper');
            } else if (r.state === 'pending') showToast(tr(tr(tr('購入は承認待ちです（ファミリーの承認など）。完了すると自動で反映されます'))), 4000);
            else showToast(tr(tr(tr('購入をキャンセルしました'))));
          } catch (e) {
            showToast(tr(tr(tr('購入できませんでした: {0}')), e instanceof Error ? e.message : String(e)), 3500);
          }
          cache = null; // 購入済みフラグを取り直す
          ctx.refresh();
        });
      }
      list.append(el('div', { class: 'shop-row store-row' }, el('div', { class: 'shop-label' }, el('div', { text: p.title || meta.name }), el('div', { class: 'muted small', text: p.description || meta.desc })), btn));
    }
  };
  list.append(el('p', { class: 'muted small', text: tr(tr(tr('読み込み中…'))) }));
  void loadProducts().then(draw);
}
