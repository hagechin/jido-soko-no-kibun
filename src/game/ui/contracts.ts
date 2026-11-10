/**
 * 「依頼」のパネル（1.2、SPEC-1.2 §6）。上にタブ［依頼｜本社｜実績］。
 *  - 依頼: 今日の依頼・今週の依頼（進捗、報酬、受ける／受け取る／入れ替え）、取引先の一覧（レベルと信用）
 *  - 本社: 投資 4 部門と、見た目（ロボの塗装・倉庫テーマ）の店
 */
import { CONTRACTS } from '../data/balance';
import { CLIENTS, CLIENT_BY_ID, clientLevel, levelRewardFactor, nextLevelTrust } from '../data/clients';
import { ITEM_BY_ID } from '../data/items';
import { availableClients, contractCoins, rerollCost } from '../sim/contracts';
import { buyHq, hqCost, hqInfo, hqLevel, hqMaxLevel, HQ_ORDER, type HqId } from '../sim/hq';
import type { Contract, WorldState } from '../sim/types';
import { locale, tr } from '../i18n';
import { inStore, isUnlocked, PAINTS, THEMES, type CosmeticAccess, type CosmeticSource, type PaintDef, type ThemeDef } from './cosmetics';
import { icon, iconText } from './icon';
import { el, showToast } from './layout';

export type HqTab = 'contracts' | 'hq' | 'achievements';

/** パネルの上のタブ。badge は「依頼」に付ける数（受け取れる依頼など） */
export function renderHqTabs(body: HTMLElement, current: HqTab, onTab: (t: HqTab) => void, badge = 0): void {
  const row = el('div', { class: 'tab-row', role: 'tablist' });
  const tabs: [HqTab, string][] = [
    ['contracts', tr('依頼')],
    ['hq', tr('本社')],
    ['achievements', tr('実績')],
  ];
  for (const [id, label] of tabs) {
    const b = el('button', { class: `btn tab-btn${id === current ? ' is-active' : ''}`, type: 'button', role: 'tab', 'aria-selected': id === current ? 'true' : 'false', 'data-tab': id }, el('span', { text: label }), id === 'contracts' && badge > 0 ? el('span', { class: 'badge tab-badge', text: String(badge) }) : null);
    b.addEventListener('click', () => {
      if (id !== current) onTab(id);
    });
    row.append(b);
  }
  body.append(row);
}

const num = (n: number): string => Math.round(n).toLocaleString('ja-JP');

/** 依頼の 1 行の題（何をすれば達成か） */
export function contractTitle(c: Contract): string {
  const client = CLIENT_BY_ID[c.client];
  switch (c.kind) {
    case 'volume':
      return tr('{0} 件出荷する', num(c.target));
    case 'category':
      return tr('{0}を {1} 個出荷する', client?.desc ?? '', num(c.target));
    case 'fast':
      return tr('表示から {0} 秒以内の出荷を {1} 件', c.limitSec ?? 0, num(c.target));
    case 'clean':
      return tr('遅延なしで {0} 件続けて出荷する', num(c.target));
    case 'bulk':
      return tr('特注 {0} 件を全部出荷する', num(c.target));
  }
}

/** 補足（数え方のきまり） */
function contractNote(c: Contract): string {
  switch (c.kind) {
    case 'volume':
      return tr('どの注文でも 1 件。お留守番の出荷も数えます');
    case 'category':
      return tr('注文に入っている個数ぶん進みます。お留守番の出荷も数えます');
    case 'fast':
      return tr('注文票の時計（表示されてからの秒数）で数えます');
    case 'clean':
      return tr('遅延した注文を出荷すると 0 に戻ります');
    case 'bulk':
      if (c.state === 'offered') return tr('受けると入荷トラックが商品を運んできて、特注の注文が順に入ります。空ビンを用意しておくと安心です');
      return tr('注文票に取引先の色の印が付きます。日付が変わると、残りはふつうの注文になります');
  }
}

/** 特注の中身（商品ごとの合計）。受ける前だけ分かる */
function bulkContents(c: Contract): string {
  const need = new Map<string, number>();
  for (const lines of c.pending ?? []) for (const l of lines) need.set(l.item, (need.get(l.item) ?? 0) + l.qty);
  return [...need].map(([item, qty]) => `${ITEM_BY_ID[item]?.name ?? item} ×${qty}`).join(tr('、'));
}

export interface ContractsContext {
  world: WorldState;
  /** 取引先の信用（プレイヤーの記録） */
  trust: Readonly<Record<string, number>>;
  /** まだ依頼が来ない（出荷が少ない）ときの残り件数。来ているなら 0 */
  lockedRemaining: number;
  onAccept: (id: number) => void;
  onClaim: (id: number) => void;
  onReroll: (id: number) => void;
}

function progressText(c: Contract): string {
  return `${num(Math.min(c.progress, c.target))} / ${num(c.target)}`;
}

function contractCard(c: Contract, ctx: ContractsContext): HTMLElement {
  const client = CLIENT_BY_ID[c.client];
  const level = clientLevel(ctx.trust[c.client] ?? 0);
  const coins = contractCoins(ctx.world, c, level);
  const head = el(
    'div',
    { class: 'contract-head' },
    el('span', { class: 'client-dot', style: `background:${client?.color ?? '#888'}` }),
    el('span', { class: 'contract-client', text: client?.name ?? c.client }),
    el('span', { class: 'muted small', text: tr('Lv{0}', level) }),
    el('span', { class: 'muted small contract-period', text: c.period === 'weekly' ? tr('今週') : c.key !== ctx.world.contracts?.dayKey ? tr('受け取り待ち') : tr('今日') }),
  );
  const pct = Math.round((Math.min(c.progress, c.target) / Math.max(1, c.target)) * 100);
  const bar = el('div', { class: 'ach-bar contract-bar' }, el('div', { class: 'ach-fill', style: `width:${pct}%` }));
  const prog = el('span', { class: 'contract-progress', text: progressText(c) });
  const reward = el('span', { class: 'contract-reward' }, el('span', { class: 'reward-part' }, icon('coins', 14), el('span', { text: num(coins) })), el('span', { class: 'reward-part' }, icon('handshake', 14), el('span', { text: tr('信用 +{0}', c.reward.trust) })));
  const actions = el('div', { class: 'contract-actions' });
  if (c.state === 'done') {
    const b = el('button', { class: 'btn buy-btn is-primary', type: 'button', 'data-act': 'claim' }, iconText('gift', tr('受け取る'), 14));
    b.addEventListener('click', () => ctx.onClaim(c.id));
    actions.append(b);
  } else if (c.state === 'claimed') {
    actions.append(el('span', { class: 'muted small contract-claimed' }, iconText('check', tr('受け取り済み'), 14)));
  } else {
    if (c.state === 'offered') {
      const b = el('button', { class: 'btn buy-btn is-primary', type: 'button', 'data-act': 'accept' }, iconText('truck', tr('受ける'), 14));
      b.addEventListener('click', () => ctx.onAccept(c.id));
      actions.append(b);
    }
    const cost = rerollCost(c);
    if (cost !== null) {
      const b = el('button', { class: 'btn buy-btn', type: 'button', 'data-act': 'reroll', title: tr('コインを払って別の依頼に替える') }, icon('shuffle', 14), document.createTextNode(` ${num(cost)}`));
      if (ctx.world.coins < cost) b.setAttribute('disabled', 'true');
      b.addEventListener('click', () => ctx.onReroll(c.id));
      actions.append(b);
    }
  }
  const sub = c.kind === 'bulk' && c.state === 'offered' ? `${bulkContents(c)}${tr('。')}${contractNote(c)}` : contractNote(c);
  return el(
    'div',
    { class: `contract-card is-${c.state}`, 'data-contract': c.id },
    head,
    el('div', { class: 'contract-title', text: contractTitle(c) }),
    el('div', { class: 'contract-progress-row' }, bar, prog),
    el('div', { class: 'contract-foot' }, reward, actions),
    c.state === 'claimed' ? null : el('div', { class: 'muted small contract-note', text: sub }),
  );
}

/** 開いたままのパネルの進捗だけを更新する（ボタンを作り直さない） */
export function refreshContractProgress(body: HTMLElement, w: WorldState): void {
  for (const card of body.querySelectorAll<HTMLElement>('[data-contract]')) {
    const c = w.contracts?.list.find((x) => x.id === Number(card.dataset.contract));
    if (!c) continue;
    const fill = card.querySelector<HTMLElement>('.ach-fill');
    const prog = card.querySelector<HTMLElement>('.contract-progress');
    const pct = `${Math.round((Math.min(c.progress, c.target) / Math.max(1, c.target)) * 100)}%`;
    if (fill && fill.style.width !== pct) fill.style.width = pct;
    const txt = progressText(c);
    if (prog && prog.textContent !== txt) prog.textContent = txt;
  }
}

function clientRow(clientId: string, trust: number, available: boolean): HTMLElement {
  const c = CLIENT_BY_ID[clientId];
  const level = clientLevel(trust);
  const next = nextLevelTrust(trust);
  const prev = CONTRACTS.trustLevels[level - 1] ?? 0;
  const pct = next === null ? 100 : Math.round(((trust - prev) / (next - prev)) * 100);
  const bonus = Math.round((levelRewardFactor(level) - 1) * 100);
  const perks: string[] = [];
  if (bonus > 0) perks.push(tr('依頼の報酬 +{0}%', bonus));
  perks.push(level >= CONTRACTS.paintLevel ? tr('ロボの塗装を解放済み') : tr('Lv{0} でロボの塗装', CONTRACTS.paintLevel));
  if (!available) perks.push(tr('いまのランクでは扱う商品がありません'));
  return el(
    'div',
    { class: `client-row${available ? '' : ' is-locked'}` },
    el('div', { class: 'contract-head' }, el('span', { class: 'client-dot', style: `background:${c.color}` }), el('span', { class: 'contract-client', text: c.name }), el('span', { class: 'muted small', text: c.desc }), el('span', { class: 'client-level', text: tr('Lv{0}', level) })),
    el('div', { class: 'contract-progress-row' }, el('div', { class: 'ach-bar contract-bar' }, el('div', { class: 'ach-fill', style: `width:${pct}%;background:${c.color}` })), el('span', { class: 'contract-progress', text: next === null ? tr('信用 {0}（最大）', num(trust)) : tr('信用 {0} / {1}', num(trust), num(next)) })),
    el('div', { class: 'muted small', text: perks.join(tr('・')) }),
  );
}

export function renderContracts(body: HTMLElement, ctx: ContractsContext): void {
  const w = ctx.world;
  if (w.sandbox) {
    body.append(el('p', { class: 'muted small', text: tr('サンドボックスのプリセット倉庫には、取引先の依頼は来ません') }));
  } else if (ctx.lockedRemaining > 0 || !w.contracts) {
    body.append(el('p', { class: 'hint-box' }, icon('handshake', 16), el('span', { text: tr(' あと {0} 件出荷すると、取引先から依頼が届くようになります', Math.max(1, ctx.lockedRemaining)) })));
  } else {
    const st = w.contracts;
    const order = (c: Contract) => (c.state === 'done' ? 0 : c.state === 'offered' ? 1 : c.state === 'active' ? 2 : 3);
    const daily = st.list.filter((c) => c.period === 'daily').sort((a, b) => order(a) - order(b) || a.id - b.id);
    const weekly = st.list.filter((c) => c.period === 'weekly').sort((a, b) => order(a) - order(b) || a.id - b.id);
    body.append(el('h4', { text: tr('今日の依頼') }));
    body.append(el('p', { class: 'muted small', text: tr('毎日入れ替わります。逃しても何も失いません。達成したら「受け取る」で報酬と取引先の信用をもらえます') }));
    for (const c of daily) body.append(contractCard(c, ctx));
    body.append(el('h4', { text: tr('今週の依頼') }));
    for (const c of weekly) body.append(contractCard(c, ctx));
  }
  body.append(el('h4', { text: tr('取引先') }));
  body.append(el('p', { class: 'muted small', text: tr('信用は依頼を達成すると増え、倉庫を作り直しても残ります。レベルが上がるとその取引先の依頼の報酬が増えます') }));
  const ok = new Set(availableClients(w).map((c) => c.id as string));
  for (const c of CLIENTS) body.append(clientRow(c.id, ctx.trust[c.id] ?? 0, ok.has(c.id)));
}

// ------------------------------------------------------------ 本社

export interface HqContext {
  world: WorldState;
  access: CosmeticAccess;
  /** いま使っている見た目 */
  skin: string;
  theme: string;
  /** 実際の月（1〜12。季節のテーマが店に並ぶか） */
  month: number;
  refresh: () => void;
  /** 投資したあと（保存など） */
  onInvest: (id: HqId) => void;
  setSkin: (id: string) => void;
  setTheme: (id: string) => void;
  buyCosmetic: (kind: 'paint' | 'theme', id: string, price: number) => void;
  /** サポーターパックの入手先の案内（iOS: ストア、Web: iOS 版） */
  supporterHint: string;
}

function hqRow(id: HqId, ctx: HqContext): HTMLElement {
  const w = ctx.world;
  const info = hqInfo(w, id);
  const cost = hqCost(w, id);
  const lv = hqLevel(w, id);
  const btn = el('button', { class: 'btn buy-btn', type: 'button', 'data-hq': id });
  if (cost === null) btn.textContent = 'MAX';
  else btn.append(icon('coins', 14), document.createTextNode(` ${num(cost)}`));
  if (cost === null || w.coins < cost) btn.setAttribute('disabled', 'true');
  btn.addEventListener('click', () => {
    const r = buyHq(w, id);
    showToast(r.ok ? (r.message ?? '') : r.reason, 3000, r.ok ? 'building-2' : undefined);
    if (r.ok) ctx.onInvest(id);
    ctx.refresh();
  });
  const state = info.next === null ? tr('{0}（最大）', info.now) : tr('{0} → 次 {1}', info.now, info.next);
  return el('div', { class: 'shop-row' }, el('div', { class: 'shop-label' }, el('div', { text: tr('{0}（{1} / {2} 段）', info.name, lv, hqMaxLevel(id)) }), el('div', { class: 'muted small', text: tr('{0}。いま {1}', info.desc, state) })), btn);
}

function monthsText(months: number[]): string {
  if (locale() === 'ja') return tr('{0} 月', months.join('・'));
  // 英語などは月の名前で（Mar, Apr）
  return months.map((m) => new Date(2000, m - 1, 1).toLocaleString(locale(), { month: 'short' })).join(', ');
}

function cosmeticRow(kind: 'paint' | 'theme', def: PaintDef | ThemeDef, swatches: string[], current: string, ctx: HqContext): HTMLElement {
  const src: CosmeticSource = def.source;
  const unlocked = isUnlocked(kind, def.id, src, ctx.access);
  const btn = el('button', { class: 'btn buy-btn', type: 'button', 'data-cosmetic': `${kind}:${def.id}` });
  let note = def.desc;
  if (unlocked) {
    if (current === def.id) {
      btn.append(iconText('check', tr('使用中'), 14));
      btn.classList.add('is-active');
      btn.setAttribute('disabled', 'true');
    } else {
      btn.textContent = tr('使う');
      btn.addEventListener('click', () => (kind === 'paint' ? ctx.setSkin(def.id) : ctx.setTheme(def.id)));
    }
  } else if (src.type === 'coins') {
    if (inStore(src, ctx.month)) {
      btn.append(icon('coins', 14), document.createTextNode(` ${num(src.price)}`));
      if (ctx.world.coins < src.price) btn.setAttribute('disabled', 'true');
      btn.addEventListener('click', () => ctx.buyCosmetic(kind, def.id, src.price));
      if (src.months) note = tr('{0}。季節のテーマ: いま店に並んでいます（{1}）', def.desc, monthsText(src.months));
    } else {
      btn.textContent = tr('季節外');
      btn.setAttribute('disabled', 'true');
      note = tr('{0}。季節のテーマ: {1}に店に並びます', def.desc, monthsText(src.months ?? []));
    }
  } else if (src.type === 'client') {
    const c = CLIENT_BY_ID[src.client];
    btn.textContent = tr('Lv{0} で解放', CONTRACTS.paintLevel);
    btn.setAttribute('disabled', 'true');
    note = tr('{0}の信用を Lv{1} にすると使えます（いま Lv{2}）', c.name, CONTRACTS.paintLevel, clientLevel(ctx.access.trust[src.client] ?? 0));
  } else {
    btn.textContent = tr('パック限定');
    btn.setAttribute('disabled', 'true');
    note = tr('{0}。{1}', def.desc, ctx.supporterHint);
  }
  const sw = el('span', { class: 'swatches' });
  for (const col of swatches) sw.append(el('span', { class: 'swatch', style: `background:${col}` }));
  return el('div', { class: 'shop-row cosmetic-row' }, el('div', { class: 'shop-label' }, el('div', {}, sw, el('span', { text: ` ${def.name}` })), el('div', { class: 'muted small', text: note })), btn);
}

export function renderHq(body: HTMLElement, ctx: HqContext): void {
  body.append(el('h4', { text: tr('本社への投資') }));
  body.append(el('p', { class: 'muted small', text: tr('この倉庫にずっと効く強化です。段が上がるほど高くなります') }));
  for (const id of HQ_ORDER) body.append(hqRow(id, ctx));

  body.append(el('h4', { text: tr('ロボの塗装') }));
  body.append(el('p', { class: 'muted small', text: tr('買った見た目と取引先の信用はプレイヤーの記録に残り、倉庫を作り直しても使えます') }));
  const std = ['#e04b4b', '#3a7bd5', '#5fc9f8'];
  for (const p of PAINTS) body.append(cosmeticRow('paint', p, p.colors ? [p.colors.shelf, p.colors.amr, p.colors.drone] : std, ctx.skin, ctx));

  body.append(el('h4', { text: tr('倉庫テーマ') }));
  body.append(el('p', { class: 'muted small', text: tr('画面の色と 3D の背景が変わります。季節のテーマは、実際のその月にだけ店に並びます（買えば一年中使えます）') }));
  for (const t of THEMES) body.append(cosmeticRow('theme', t, [t.swatch, t.backdrop], ctx.theme, ctx));
}
