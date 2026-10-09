import { AUDIO } from '../data/balance';
/**
 * サウンド（§10）。外部ファイルなし。WebAudio で合成する。
 *  - 初回のタップで AudioContext を作る（スマホのブラウザ制限）
 *  - ロボの駆動音（動いている台数に応じたハム）、ピック音、出荷音、コイン音
 *  - BGM: 短いアルペジオのループ。通常／サイバーウィーク（テンポ上げ）／眺めモード（静か）
 *  - 見張り（check）: AudioContext が止まっていれば resume、閉じられていれば作り直し、BGM のタイマーが止まっていれば再開。
 *    iOS はアプリを背面に回す／電話や他アプリの音で AudioContext が interrupted / suspended になり、戻っても自動では鳴らない
 */
const KEY = 'jido-soko-no-kibun:sound';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  /** ロボの駆動音: ブラウンノイズ（モーター／ファン）＋ 低い三角波（わずかなビブラート） */
  private hum: { gain: GainNode; osc: OscillatorNode; lfo: OscillatorNode } | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer = 0;
  private bgmStep = 0;
  /** BGM の直前の音を出した時刻（performance.now）と、そのときの間隔。タイマーが止まった検出用 */
  private bgmLastAt = 0;
  private bgmInterval = 420;
  private lastCheck = 0;
  /** 見張りが直した回数（設定画面の表示用） */
  recovered = 0;
  private tempo: 'normal' | 'cyber' | 'calm' = 'normal';
  enabled = true;
  private unlocked = false;

  constructor() {
    try {
      this.enabled = localStorage.getItem(KEY) !== 'off';
    } catch {
      /* ignore */
    }
  }

  /** 最初のユーザー操作で呼ぶ */
  unlock(): void {
    if (this.unlocked) return;
    const AC = (window as unknown as { AudioContext?: typeof AudioContext; webkitAudioContext?: typeof AudioContext }).AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    try {
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.gain.value = this.enabled ? AUDIO.masterVolume : 0;
      this.master.connect(this.ctx.destination);
      this.unlocked = true;
      void this.ctx.resume();
      this.startHum();
      this.startBgm();
    } catch {
      this.ctx = null;
    }
  }

  setEnabled(on: boolean): void {
    this.enabled = on;
    try {
      localStorage.setItem(KEY, on ? 'on' : 'off');
    } catch {
      /* ignore */
    }
    this.fadeMaster(on ? AUDIO.masterVolume : 0, on ? AUDIO.fadeInSec : AUDIO.fadeOutSec);
  }

  /** マスター音量をなめらかに目標へ（等ラウドネス寄りの曲線: 下げるときは最初ゆっくり後半速く、上げるときは逆） */
  private fadeMaster(target: number, seconds: number): void {
    if (!this.master || !this.ctx) return;
    const g = this.master.gain;
    const now = this.ctx.currentTime;
    const from = g.value;
    g.cancelScheduledValues(now);
    g.setValueAtTime(from, now);
    // 8 分割の折れ線で指数カーブに近づける（exponentialRamp は 0 を扱えないため）
    const steps = 8;
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      // 上げるとき: 進み具合 1-(1-t)^2（最初速く、最後ゆっくり）。下げるとき: 残り (1-t)^1.6（ﾌｯと消える）
      const v = target > from ? from + (target - from) * (1 - Math.pow(1 - t, 2)) : target + (from - target) * Math.pow(1 - t, 1.6);
      g.linearRampToValueAtTime(Math.max(0, v), now + seconds * t);
    }
  }

  setTempo(t: 'normal' | 'cyber' | 'calm'): void {
    this.tempo = t;
  }

  /** 動いているロボの台数 → 駆動音の音量とピッチ（台数が多いほど少し高く） */
  setActivity(movingRobots: number): void {
    if (!this.hum || !this.ctx) return;
    const t = this.ctx.currentTime;
    const target = Math.min(0.045, movingRobots * 0.012) * (this.tempo === 'calm' ? 0.5 : 1);
    this.hum.gain.gain.setTargetAtTime(target, t, 0.4);
    this.hum.osc.frequency.setTargetAtTime(90 + Math.min(40, movingRobots * 4), t, 0.6);
  }

  private startHum(): void {
    if (!this.ctx || !this.master) return;
    const ctx = this.ctx;
    const gain = ctx.createGain();
    gain.gain.value = 0;
    gain.connect(this.master);
    // ブラウンノイズ（2 秒ループ）→ ローパス: モーターとファンの空気感
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    let last = 0;
    for (let i = 0; i < len; i++) {
      const white = Math.random() * 2 - 1;
      last = (last + 0.02 * white) / 1.02;
      data[i] = last * 3.5;
    }
    const noise = ctx.createBufferSource();
    noise.buffer = buf;
    noise.loop = true;
    const nf = ctx.createBiquadFilter();
    nf.type = 'lowpass';
    nf.frequency.value = 600;
    nf.Q.value = 0.5;
    const ng = ctx.createGain();
    ng.gain.value = 0.7;
    noise.connect(nf).connect(ng).connect(gain);
    noise.start();
    // 低い三角波に遅いビブラートをかけて「回っている」感じに（音量は控えめ）
    const osc = ctx.createOscillator();
    osc.type = 'triangle';
    osc.frequency.value = 90;
    const lfo = ctx.createOscillator();
    lfo.type = 'sine';
    lfo.frequency.value = 3.3;
    const lfoGain = ctx.createGain();
    lfoGain.gain.value = 4;
    lfo.connect(lfoGain).connect(osc.frequency);
    const of = ctx.createBiquadFilter();
    of.type = 'lowpass';
    of.frequency.value = 300;
    const og = ctx.createGain();
    og.gain.value = 0.35;
    osc.connect(of).connect(og).connect(gain);
    osc.start();
    lfo.start();
    this.hum = { gain, osc, lfo };
  }

  private tone(freq: number, dur: number, type: OscillatorType = 'square', vol = 0.15, when = 0): void {
    if (!this.ctx || !this.master || !this.enabled) return;
    const t0 = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    osc.type = type;
    osc.frequency.value = freq;
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0, t0);
    g.gain.linearRampToValueAtTime(vol, t0 + 0.01);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    osc.connect(g).connect(this.master);
    osc.start(t0);
    osc.stop(t0 + dur + 0.02);
  }

  pick(): void {
    this.tone(880, 0.08, 'square', 0.08);
  }

  ship(bonus: number): void {
    this.tone(523, 0.12, 'triangle', 0.15);
    this.tone(659, 0.12, 'triangle', 0.15, 0.1);
    this.tone(784, 0.18, 'triangle', 0.15, 0.2);
    if (bonus >= 1.5) this.tone(1047, 0.25, 'triangle', 0.15, 0.32);
  }

  coin(): void {
    this.tone(1319, 0.06, 'sine', 0.1);
    this.tone(1760, 0.1, 'sine', 0.1, 0.06);
  }

  truck(): void {
    this.tone(110, 0.4, 'sawtooth', 0.08);
    this.tone(98, 0.5, 'sawtooth', 0.08, 0.35);
  }

  notice(): void {
    this.tone(660, 0.1, 'sine', 0.12);
    this.tone(880, 0.15, 'sine', 0.12, 0.12);
  }

  private startBgm(): void {
    if (!this.ctx || !this.master) return;
    this.bgmGain = this.ctx.createGain();
    this.bgmGain.gain.value = 0.35;
    this.bgmGain.connect(this.master);
    this.scheduleBgm();
  }

  private scheduleBgm(): void {
    const scaleNormal = [262, 330, 392, 440, 523, 440, 392, 330];
    const scaleCyber = [294, 349, 440, 523, 587, 523, 440, 349];
    const schedule = () => {
      if (!this.ctx || !this.bgmGain) return;
      const interval = this.tempo === 'cyber' ? 180 : this.tempo === 'calm' ? 900 : 420;
      this.bgmLastAt = performance.now();
      this.bgmInterval = interval;
      if (this.enabled) {
        const scale = this.tempo === 'cyber' ? scaleCyber : scaleNormal;
        const f = scale[this.bgmStep % scale.length] * (this.tempo === 'calm' ? 0.5 : 1);
        const t0 = this.ctx.currentTime;
        const osc = this.ctx.createOscillator();
        osc.type = this.tempo === 'calm' ? 'sine' : 'triangle';
        osc.frequency.value = f;
        const g = this.ctx.createGain();
        const vol = this.tempo === 'calm' ? 0.06 : 0.1;
        g.gain.setValueAtTime(0, t0);
        g.gain.linearRampToValueAtTime(vol, t0 + 0.02);
        g.gain.exponentialRampToValueAtTime(0.001, t0 + interval / 1000 + 0.3);
        osc.connect(g).connect(this.bgmGain);
        osc.start(t0);
        osc.stop(t0 + interval / 1000 + 0.4);
      }
      this.bgmStep++;
      this.bgmTimer = window.setTimeout(schedule, interval);
    };
    schedule();
  }

  /** AudioContext の状態（表示用） */
  state(): 'off' | 'not-started' | 'running' | 'suspended' | 'interrupted' | 'closed' {
    if (!this.enabled) return 'off';
    if (!this.ctx) return 'not-started';
    const s = this.ctx.state as string;
    return s === 'running' || s === 'suspended' || s === 'closed' || s === 'interrupted' ? (s as 'running' | 'suspended' | 'closed' | 'interrupted') : 'suspended';
  }

  /** 表示用の短い状態文 */
  status(): string {
    switch (this.state()) {
      case 'off':
        return 'オフ';
      case 'not-started':
        return '未開始（画面をタップすると始まります）';
      case 'running':
        return `再生中${this.recovered ? `（止まったのを ${this.recovered} 回立て直し）` : ''}`;
      case 'suspended':
      case 'interrupted':
        return '一時停止中（タップで再開します）';
      case 'closed':
        return '停止（作り直します）';
    }
  }

  /**
   * 見張り: 毎フレーム呼んでよい（1 秒に 1 回だけ働く。force = true なら即）。
   * 止まっていれば resume、閉じられていれば作り直し、BGM のタイマーが止まっていれば再開する
   */
  check(now = performance.now(), force = false): void {
    if (!this.unlocked || !this.ctx) return;
    if (!force && now - this.lastCheck < 1000) return;
    this.lastCheck = now;
    const state = this.ctx.state as string;
    if (state === 'closed') {
      this.rebuild();
      return;
    }
    if (state !== 'running') {
      // iOS の interrupted / suspended。resume はユーザー操作が要ることがあるので、pointerdown からも force で呼ばれる
      void this.ctx.resume().catch(() => {});
    }
    // BGM のタイマーが止まっている（背面で止められた、例外で途切れた）→ 組み直す
    if (this.bgmGain && now - this.bgmLastAt > this.bgmInterval * 3 + 1000) {
      clearTimeout(this.bgmTimer);
      this.recovered++;
      this.scheduleBgm();
    }
  }

  /** AudioContext を作り直す（閉じられたとき） */
  private rebuild(): void {
    clearTimeout(this.bgmTimer);
    try {
      this.ctx?.close().catch(() => {});
    } catch {
      /* ignore */
    }
    this.ctx = null;
    this.master = null;
    this.hum = null;
    this.bgmGain = null;
    this.unlocked = false;
    this.recovered++;
    this.unlock();
  }

  dispose(): void {
    clearTimeout(this.bgmTimer);
    this.ctx?.close().catch(() => {});
  }
}
