/**
 * サウンド（§10）。外部ファイルなし。WebAudio で合成する。
 *  - 初回のタップで AudioContext を作る（スマホのブラウザ制限）
 *  - ロボの駆動音（動いている台数に応じたハム）、ピック音、出荷音、コイン音
 *  - BGM: 短いアルペジオのループ。通常／サイバーウィーク（テンポ上げ）／眺めモード（静か）
 */
const KEY = 'jido-soko-no-kibun:sound';

export class Sound {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private hum: { osc: OscillatorNode; gain: GainNode } | null = null;
  private bgmGain: GainNode | null = null;
  private bgmTimer = 0;
  private bgmStep = 0;
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
      this.master.gain.value = this.enabled ? 0.5 : 0;
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
    if (this.master && this.ctx) this.master.gain.setTargetAtTime(on ? 0.5 : 0, this.ctx.currentTime, 0.05);
  }

  setTempo(t: 'normal' | 'cyber' | 'calm'): void {
    this.tempo = t;
  }

  /** 動いているロボの台数 → ハムの音量 */
  setActivity(movingRobots: number): void {
    if (!this.hum || !this.ctx) return;
    const target = Math.min(0.12, movingRobots * 0.03) * (this.tempo === 'calm' ? 0.5 : 1);
    this.hum.gain.gain.setTargetAtTime(target, this.ctx.currentTime, 0.2);
  }

  private startHum(): void {
    if (!this.ctx || !this.master) return;
    const osc = this.ctx.createOscillator();
    osc.type = 'sawtooth';
    osc.frequency.value = 55;
    const filt = this.ctx.createBiquadFilter();
    filt.type = 'lowpass';
    filt.frequency.value = 180;
    const gain = this.ctx.createGain();
    gain.gain.value = 0;
    osc.connect(filt).connect(gain).connect(this.master);
    osc.start();
    this.hum = { osc, gain };
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
    const scaleNormal = [262, 330, 392, 440, 523, 440, 392, 330];
    const scaleCyber = [294, 349, 440, 523, 587, 523, 440, 349];
    const schedule = () => {
      if (!this.ctx || !this.bgmGain) return;
      const interval = this.tempo === 'cyber' ? 180 : this.tempo === 'calm' ? 900 : 420;
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

  dispose(): void {
    clearTimeout(this.bgmTimer);
    this.ctx?.close().catch(() => {});
  }
}
