import { DIFFICULTY, RANKS, ECONOMY_MODES } from '../data/balance';
import { formatDate, formatDateShort, SEASON_ICON } from '../sim/calendar';
import { icon } from './icon';
import { dockBacklog } from '../sim/inbound';
import { restockMode } from '../sim/automation';
import type { WorldState } from '../sim/types';
import { $, showToast } from './layout';

/** 評判の色: 0〜30 は赤、60 で黄、100 で緑（間は補間） */
export function reputationColor(rep: number): string {
  const red = [255, 107, 107];
  const yellow = [242, 201, 76];
  const green = [123, 211, 137];
  const mix = (a: number[], b: number[], t: number) => a.map((v, i) => Math.round(v + (b[i] - v) * t));
  const c = rep <= 30 ? red : rep <= 60 ? mix(red, yellow, (rep - 30) / 30) : mix(yellow, green, Math.min(1, (rep - 60) / 40));
  return `rgb(${c[0]}, ${c[1]}, ${c[2]})`;
}

export class Hud {
  private coins = $('hud-coins').querySelector('b')!;
  private rank = $('hud-rank').querySelector('b')!;
  private rep = $('hud-rep').querySelector('b')!;
  private date = $('hud-date').querySelector('b')!;
  private season = $('hud-season');
  private dock = $('hud-dock');
  private sandbox = $('hud-sandbox');
  private dockN = this.dock.querySelector('b')!;
  private speedBtns = Array.from($('speed').querySelectorAll<HTMLButtonElement>('.speed-btn'));
  private last = { coins: NaN, rank: -1, rep: NaN, date: '', speed: NaN, dock: NaN, difficulty: '', economy: '', restockMode: false, sandbox: false };

  private cycleBtn = $('speed-cycle');
  private lastNonZeroSpeed = 1;

  constructor(onSpeed: (speed: number) => void) {
    // ★ 各アイコンはタップで説明（iOS ではホバーの説明が見えない）
    const explain: [HTMLElement, () => string][] = [
      [$('hud-coins'), () => 'コイン: 出荷の報酬。ロボ・設備・強化に使います'],
      [$('hud-rank'), () => '倉庫ランク: 累計出荷で昇格し、新商品や設備が解放されます（難易度・経済モードも表示）'],
      [$('hud-rep'), () => '評判: 速い出荷で上がり、遅延や溜まりすぎで下がります。高いほど客が増えます'],
      [this.sandbox, () => 'SB: サンドボックスを使ったセーブの印（正規の進行ではありません。新しく始めると消えます）'],
      [this.dock, () => `入荷口の滞留: トラックが運んできて、まだ棚に入っていない商品の数（${this.last.dock} 個）。空ビンがあればロボが取り込みます`],
      [$('hud-date'), () => '暦: 1 か月 = 6 分。入荷トラックは設定の頻度で、季節イベントは月ごとに変わります'],
      [this.season, () => '季節: いま売れやすい商品が変わります（上の帯の文を参照）'],
    ];
    for (const [elm, text] of explain) {
      elm.style.cursor = 'pointer';
      elm.addEventListener('click', () => showToast(text(), 5000, 'info'));
    }
    for (const b of this.speedBtns) {
      if (b === this.cycleBtn) continue;
      b.addEventListener('click', () => {
        const s = Number(b.dataset.speed);
        // 一時停止中にもう一度「一時停止」を押したら再開
        if (s === 0 && this.last.speed === 0) onSpeed(this.lastNonZeroSpeed);
        else onSpeed(s);
      });
    }
    // スマホ用: 1つのボタンで 1x → 2x → 4x を巡回（一時停止中なら再開）
    this.cycleBtn.addEventListener('click', () => {
      const order = [1, 2, 4];
      const cur = this.last.speed;
      if (cur === 0) onSpeed(this.lastNonZeroSpeed);
      else onSpeed(order[(order.indexOf(cur) + 1) % order.length]);
    });
  }

  update(w: WorldState): void {
    if (this.last.coins !== w.coins) {
      this.last.coins = w.coins;
      this.coins.textContent = Math.floor(w.coins).toLocaleString('ja-JP');
    }
    const eco = w.economy ?? 'standard';
    if (this.last.rank !== w.rank || this.last.difficulty !== w.difficulty || this.last.economy !== eco) {
      this.last.rank = w.rank;
      this.last.difficulty = w.difficulty;
      this.last.economy = eco;
      const d = DIFFICULTY[w.difficulty] ?? DIFFICULTY.normal;
      const e = ECONOMY_MODES[eco] ?? ECONOMY_MODES.standard;
      this.rank.textContent = `${RANKS[w.rank]?.name ?? '—'}・${d.name}${eco === 'standard' ? '' : `・${e.name}`}`;
      this.rank.title = `難易度: ${d.name} — ${d.desc}${eco === 'standard' ? '' : ` ／ 経済モード: ${e.name} — ${e.desc}`}（設定で変更できます）`;
    }
    const rep = Math.round(w.reputation);
    if (this.last.rep !== rep) {
      this.last.rep = rep;
      this.rep.textContent = String(rep);
      this.rep.style.color = reputationColor(rep);
    }
    const sb = !!w.flags.sandboxUsed;
    if (this.last.sandbox !== sb) {
      this.last.sandbox = sb;
      this.sandbox.hidden = !sb;
    }
    const dock = dockBacklog(w);
    if (this.last.dock !== dock) {
      this.last.dock = dock;
      this.dock.hidden = dock === 0;
      this.dockN.textContent = String(dock);
    }
    const rm = restockMode(w);
    if (this.last.restockMode !== rm) {
      this.last.restockMode = rm;
      this.dock.classList.toggle('is-restock-mode', rm);
      this.dock.title = rm ? '入荷口に滞留している個数。入荷モード: 在庫が薄いのでロボの多くを入荷作業に回しています' : '入荷口に滞留している個数';
    }
    // スマホは幅が足りないので短い表記（長い表記は title で）
    const narrow = typeof matchMedia === 'function' && matchMedia('(max-width: 899px)').matches;
    const d = narrow ? formatDateShort(w.calendar) : formatDate(w.calendar);
    if (this.last.date !== d) {
      this.last.date = d;
      this.date.textContent = d;
      this.date.parentElement!.title = formatDate(w.calendar);
      this.season.replaceChildren(icon(SEASON_ICON[w.calendar.month] ?? 'calendar', 16));
    }
    if (this.last.speed !== w.speed) {
      this.last.speed = w.speed;
      for (const b of this.speedBtns) b.classList.toggle('is-active', Number(b.dataset.speed) === w.speed);
      if (w.speed > 0) this.lastNonZeroSpeed = w.speed;
      const pause = this.speedBtns.find((b) => b.dataset.speed === '0');
      if (pause) {
        pause.setAttribute('aria-label', w.speed === 0 ? '再開' : '一時停止');
        pause.title = w.speed === 0 ? '再開（Space）' : '一時停止（Space）';
      }
      if (w.speed > 0) this.cycleBtn.textContent = `${w.speed}x`;
      else this.cycleBtn.replaceChildren(icon('play', 14), document.createTextNode(` ${this.lastNonZeroSpeed}x`));
      this.cycleBtn.classList.toggle('is-active', w.speed > 0);
    }
  }
}
