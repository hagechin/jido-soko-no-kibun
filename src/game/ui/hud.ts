import { DIFFICULTY, RANKS } from '../data/balance';
import { formatDate, SEASON_ICON } from '../sim/calendar';
import { icon } from './icon';
import { dockBacklog } from '../sim/inbound';
import { restockMode } from '../sim/automation';
import type { WorldState } from '../sim/types';
import { $ } from './layout';

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
  private last = { coins: NaN, rank: -1, rep: NaN, date: '', speed: NaN, dock: NaN, difficulty: '', restockMode: false, sandbox: false };

  private cycleBtn = $('speed-cycle');
  private lastNonZeroSpeed = 1;

  constructor(onSpeed: (speed: number) => void) {
    for (const b of this.speedBtns) {
      if (b === this.cycleBtn) continue;
      b.addEventListener('click', () => onSpeed(Number(b.dataset.speed)));
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
    if (this.last.rank !== w.rank || this.last.difficulty !== w.difficulty) {
      this.last.rank = w.rank;
      this.last.difficulty = w.difficulty;
      const d = DIFFICULTY[w.difficulty] ?? DIFFICULTY.normal;
      this.rank.textContent = `${RANKS[w.rank]?.name ?? '—'}・${d.name}`;
      this.rank.title = `難易度: ${d.name} — ${d.desc}（設定で変更できます）`;
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
    const d = formatDate(w.calendar);
    if (this.last.date !== d) {
      this.last.date = d;
      this.date.textContent = d;
      this.season.replaceChildren(icon(SEASON_ICON[w.calendar.month] ?? 'calendar', 16));
    }
    if (this.last.speed !== w.speed) {
      this.last.speed = w.speed;
      for (const b of this.speedBtns) b.classList.toggle('is-active', Number(b.dataset.speed) === w.speed);
      if (w.speed > 0) this.lastNonZeroSpeed = w.speed;
      if (w.speed > 0) this.cycleBtn.textContent = `${w.speed}x`;
      else this.cycleBtn.replaceChildren(icon('play', 14), document.createTextNode(` ${this.lastNonZeroSpeed}x`));
      this.cycleBtn.classList.toggle('is-active', w.speed > 0);
    }
  }
}
