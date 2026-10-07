import { RANKS } from '../data/balance';
import { formatDate, SEASON_ICON } from '../sim/calendar';
import type { WorldState } from '../sim/types';
import { $ } from './layout';

export class Hud {
  private coins = $('hud-coins').querySelector('b')!;
  private rank = $('hud-rank').querySelector('b')!;
  private rep = $('hud-rep').querySelector('b')!;
  private date = $('hud-date').querySelector('b')!;
  private season = $('hud-season');
  private speedBtns = Array.from($('speed').querySelectorAll<HTMLButtonElement>('.speed-btn'));
  private last = { coins: NaN, rank: -1, rep: NaN, date: '', speed: NaN };

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
    if (this.last.rank !== w.rank) {
      this.last.rank = w.rank;
      this.rank.textContent = RANKS[w.rank]?.name ?? '—';
    }
    const rep = Math.round(w.reputation);
    if (this.last.rep !== rep) {
      this.last.rep = rep;
      this.rep.textContent = String(rep);
    }
    const d = formatDate(w.calendar);
    if (this.last.date !== d) {
      this.last.date = d;
      this.date.textContent = d;
      this.season.textContent = SEASON_ICON[w.calendar.month] ?? '';
    }
    if (this.last.speed !== w.speed) {
      this.last.speed = w.speed;
      for (const b of this.speedBtns) b.classList.toggle('is-active', Number(b.dataset.speed) === w.speed);
      if (w.speed > 0) this.lastNonZeroSpeed = w.speed;
      this.cycleBtn.textContent = w.speed > 0 ? `${w.speed}x` : `▶ ${this.lastNonZeroSpeed}x`;
      this.cycleBtn.classList.toggle('is-active', w.speed > 0);
    }
  }
}
