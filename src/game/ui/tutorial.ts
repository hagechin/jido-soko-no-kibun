/**
 * チュートリアル（1.0.2。「最初に何をすればいいか分からない」への対応）。
 * 画面上部のカードに「いまやること」を 1 つ大きく出し、達成は倉庫の状態で判定する（順番どおりでなくても進む）。
 * 進み具合は localStorage。設定の「チュートリアルをもう一度」でやり直せる。
 */
import { icon } from './icon';
import { $, el } from './layout';
import { tr } from '../i18n';

export type TutorialStepId = 'pickOrder' | 'tapStack' | 'amr' | 'ship' | 'automation' | 'build' | 'done';

export const TUTORIAL_STEPS: TutorialStepId[] = ['pickOrder', 'tapStack', 'amr', 'ship', 'automation', 'build', 'done'];

/** 達成判定に使う、いまの倉庫と画面の様子（main が毎フレーム作る） */
export interface TutorialSnapshot {
  /** 選択中のロボの種類 */
  selectedKind: 'shelf' | 'amr' | null;
  /** オーダー欄の商品をタップして棚が光っている */
  focusItem: boolean;
  /** 棚ロボに手動の取り出し指示が入っている（実行中か予約） */
  shelfManualJob: boolean;
  /** 搬送ロボに手動の指示が入っている */
  amrManualJob: boolean;
  totalShipped: number;
  /** 自動配車 AI のレベル */
  dispatch: number;
  stacks: number;
  /** パネル（下から出るシート）・建設モード・拡大した注文票が出ている → カードを 1 行に縮める（操作を覆わない） */
  uiBusy?: boolean;
}

export interface TutorialState {
  step: TutorialStepId;
  /** 開始時の出荷数・スタック数（増えたら達成） */
  shippedAt: number;
  stacksAt: number;
}

const KEY = 'jido-soko-no-kibun:tutorial';
/** これ以上出荷している既存のセーブには、更新後も自動では出さない */
export const TUTORIAL_SKIP_SHIPPED = 20;

interface StepText {
  title: string;
  body: string;
  /** 光らせる要素（CSS セレクタ） */
  target?: string;
}

export const STEP_TEXT: Record<TutorialStepId, StepText> = {
  pickOrder: { title: tr('オーダーの商品をタップ'), body: tr('右のオーダー欄で、商品のアイコンを 1 つタップしてください。その商品がある棚が黄色く光り、手の空いた棚ロボが選ばれます。'), target: '#orders' },
  tapStack: { title: tr('光っている棚をタップ'), body: tr('選ばれた棚ロボが、その棚までビンを取りに行き、ポート（黄色い枠のマス）へ降ろします。'), target: '' },
  amr: { title: tr('搬送ロボにポートへ行かせる'), body: tr('搬送ロボ（低い車体）をタップしてから、ポート（黄色い枠のマス）をタップ。ビンを積んでピッキングステーション（机）へ届けます。'), target: '' },
  ship: { title: tr('オーダーの商品を全部そろえる'), body: tr('ピッカーが商品を取り、オーダーの商品が全部そろうと出荷してコインが入ります（早いほどボーナス）。残りの商品も同じように、オーダー欄でタップ → 光る棚 → 搬送ロボ、で運びましょう。'), target: '#orders' },
  automation: { title: tr('自動配車AIを買う'), body: tr('下の「強化」で自動配車AI Lv1 を買うと、搬送ロボがポートのビンを自分で運ぶようになります。コインが足りなければ、同じ手順でもう少し出荷しましょう。'), target: '[data-panel="upgrades"]' },
  build: { title: tr('スタックを 1 つ増やす'), body: tr('下の「建設」でスタック（棚）を選ぶと、置けるマスが緑に光ります。そのどれかをタップ。棚が増えると在庫を多く持てて、品切れが減ります。'), target: '[data-panel="build"]' },
  done: { title: tr('ここまでできれば大丈夫'), body: tr('あとは「強化」の「おすすめ」と、ときどき出るヒントに従って育てていきましょう。眺めたくなったら下のバーの「眺める」、操作に迷ったら「設定」→「操作方法とショートカット」。'), target: '' },
};

/** スマホ（縦）では注文票が縮小表示なので、1 段目はまず開いてもらう */
const PICK_ORDER_BODY_PHONE = tr('上の注文票をタップして開き、商品のアイコンを 1 つタップしてください。その商品がある棚が黄色く光り、手の空いた棚ロボが選ばれます。');
const SHIP_BODY_PHONE = tr('ピッカーが商品を取り、オーダーの商品が全部そろうと出荷してコインが入ります（早いほどボーナス）。残りの商品も同じように、注文票を開いてタップ → 光る棚 → 搬送ロボ、で運びましょう。');

function isPhoneLayout(): boolean {
  return typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches;
}

/** いまの状態で次に進むべき段を返す（達成していなければそのまま） */
export function advanceStep(state: TutorialState, s: TutorialSnapshot): TutorialStepId {
  const shipped = s.totalShipped > state.shippedAt;
  switch (state.step) {
    case 'pickOrder':
      return s.focusItem || s.selectedKind === 'shelf' || s.shelfManualJob || shipped ? 'tapStack' : 'pickOrder';
    case 'tapStack':
      return s.shelfManualJob || s.amrManualJob || shipped ? 'amr' : 'tapStack';
    case 'amr':
      return s.amrManualJob || s.dispatch >= 1 || shipped ? 'ship' : 'amr';
    case 'ship':
      return shipped ? 'automation' : 'ship';
    case 'automation':
      return s.dispatch >= 1 ? 'build' : 'automation';
    case 'build':
      return s.stacks > state.stacksAt ? 'done' : 'build';
    default:
      return 'done';
  }
}

/** 既存のセーブに対して、更新後に自動で始めるか */
export function shouldAutoStart(saveExisted: boolean, totalShipped: number, stored: string | null): boolean {
  if (stored === 'done') return false;
  if (!saveExisted) return true;
  return totalShipped < TUTORIAL_SKIP_SHIPPED;
}

export function loadTutorialStep(): TutorialStepId | 'done' | null {
  try {
    const v = localStorage.getItem(KEY);
    if (v === 'done') return 'done';
    return TUTORIAL_STEPS.includes(v as TutorialStepId) ? (v as TutorialStepId) : null;
  } catch {
    return null;
  }
}

function saveTutorialStep(v: TutorialStepId | 'done'): void {
  try {
    localStorage.setItem(KEY, v);
  } catch {
    /* ignore */
  }
}

export class Tutorial {
  state: TutorialState | null = null;
  private root = $('tutorial');
  private lastRendered = '';
  onChange: (() => void) | null = null;

  get active(): boolean {
    return this.state !== null;
  }

  /** 指定の段（省略時は保存してある段か最初）から始める */
  start(snap: TutorialSnapshot, step?: TutorialStepId): void {
    const stored = loadTutorialStep();
    const first = step ?? (stored && stored !== 'done' ? stored : 'pickOrder');
    this.state = { step: first, shippedAt: snap.totalShipped, stacksAt: snap.stacks };
    saveTutorialStep(first);
    this.render();
    this.onChange?.();
  }

  finish(): void {
    this.state = null;
    saveTutorialStep('done');
    this.root.hidden = true;
    document.body.classList.remove('has-tutorial');
    this.lastRendered = '';
    this.highlight('');
    this.onChange?.();
  }

  /** 毎フレーム: 達成していれば次の段へ。パネルなどが出ている間はカードを 1 行に */
  update(snap: TutorialSnapshot): void {
    if (!this.state) return;
    const next = advanceStep(this.state, snap);
    if (next !== this.state.step) this.goto(next, snap);
    const compact = !!snap.uiBusy;
    if (compact !== this.compact) {
      this.compact = compact;
      this.root.classList.toggle('is-compact', compact);
    }
  }
  private compact = false;

  private goto(step: TutorialStepId, snap: TutorialSnapshot): void {
    if (!this.state) return;
    this.state = { step, shippedAt: snap.totalShipped, stacksAt: snap.stacks };
    saveTutorialStep(step);
    this.render();
  }

  /** いまの段を飛ばす */
  private skip(snap?: TutorialSnapshot): void {
    if (!this.state) return;
    const i = TUTORIAL_STEPS.indexOf(this.state.step);
    const next = TUTORIAL_STEPS[Math.min(TUTORIAL_STEPS.length - 1, i + 1)];
    if (next === this.state.step) return this.finish();
    this.goto(next, snap ?? { selectedKind: null, focusItem: false, shelfManualJob: false, amrManualJob: false, totalShipped: this.state.shippedAt, dispatch: 0, stacks: this.state.stacksAt });
  }

  private highlight(selector: string): void {
    document.querySelectorAll('.tut-target').forEach((e) => e.classList.remove('tut-target'));
    if (selector) document.querySelector(selector)?.classList.add('tut-target');
  }

  private render(): void {
    if (!this.state) return;
    const step = this.state.step;
    if (this.lastRendered === step) return;
    this.lastRendered = step;
    const t = STEP_TEXT[step];
    const i = TUTORIAL_STEPS.indexOf(step);
    const total = TUTORIAL_STEPS.length - 1;
    const head = el('div', { class: 'tut-head' }, icon('lightbulb', 18), el('span', { class: 'tut-count', text: step === 'done' ? tr('チュートリアル') : tr('チュートリアル {0} / {1}', i + 1, total) }));
    const close = el('button', { class: 'btn icon-btn tut-close', type: 'button', title: tr('チュートリアルを終える'), 'aria-label': tr('チュートリアルを終える') }, icon('x', 16));
    close.addEventListener('click', () => this.finish());
    head.append(close);
    const actions = el('div', { class: 'tut-actions' });
    if (step === 'done') {
      const ok = el('button', { class: 'btn primary', type: 'button', text: tr('完了') });
      ok.addEventListener('click', () => this.finish());
      actions.append(ok);
    } else {
      const skip = el('button', { class: 'btn', type: 'button', text: tr('この手順を飛ばす') });
      skip.addEventListener('click', () => this.skip());
      actions.append(skip);
    }
    const phone = isPhoneLayout();
    const body = step === 'pickOrder' && phone ? PICK_ORDER_BODY_PHONE : step === 'ship' && phone ? SHIP_BODY_PHONE : t.body;
    this.root.replaceChildren(head, el('div', { class: 'tut-title', text: t.title }), el('div', { class: 'tut-body', text: body }), actions);
    this.root.hidden = false;
    document.body.classList.add('has-tutorial');
    this.highlight(t.target ?? '');
  }
}
