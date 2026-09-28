// 程序化音效:全部用 WebAudio 合成,无需外部音频文件
export class GameAudio {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.windGain = null;
    this.windFilter = null;
  }

  // 必须在用户手势后调用
  init() {
    if (this.ctx) return;
    const AC = window.AudioContext || window.webkitAudioContext;
    this.ctx = new AC();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.55;
    this.master.connect(this.ctx.destination);
    this._buildWind();
  }

  resume() { if (this.ctx && this.ctx.state === 'suspended') this.ctx.resume(); }

  _noiseBuffer(seconds = 2) {
    const rate = this.ctx.sampleRate;
    const buf = this.ctx.createBuffer(1, rate * seconds, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < data.length; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  // 持续风声,音量随速度变化
  _buildWind() {
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(3);
    src.loop = true;
    this.windFilter = this.ctx.createBiquadFilter();
    this.windFilter.type = 'lowpass';
    this.windFilter.frequency.value = 300;
    this.windGain = this.ctx.createGain();
    this.windGain.gain.value = 0;
    src.connect(this.windFilter).connect(this.windGain).connect(this.master);
    src.start();
  }

  setWind(speed01) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    this.windGain.gain.setTargetAtTime(speed01 * 0.5, t, 0.1);
    this.windFilter.frequency.setTargetAtTime(250 + speed01 * 1800, t, 0.1);
  }

  // 发射蛛丝 "thwip"
  thwip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.2);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 1.2;
    f.frequency.setValueAtTime(3500, t);
    f.frequency.exponentialRampToValueAtTime(700, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.5, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.16);
  }

  // 收集令牌
  ding(combo = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const base = 660 * Math.pow(1.06, Math.min(combo, 12));
    [base, base * 1.5].forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'sine'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      g.gain.setValueAtTime(0.0, t + i * 0.05);
      g.gain.linearRampToValueAtTime(0.35, t + i * 0.05 + 0.01);
      g.gain.exponentialRampToValueAtTime(0.001, t + i * 0.05 + 0.5);
      o.connect(g).connect(this.master);
      o.start(t + i * 0.05); o.stop(t + i * 0.05 + 0.55);
    });
  }

  // 无人机爆炸
  boom() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.6);
    const f = this.ctx.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.setValueAtTime(2200, t);
    f.frequency.exponentialRampToValueAtTime(120, t + 0.5);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.8, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.55);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.6);
    const o = this.ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.setValueAtTime(160, t);
    o.frequency.exponentialRampToValueAtTime(40, t + 0.4);
    const og = this.ctx.createGain();
    og.gain.setValueAtTime(0.5, t);
    og.gain.exponentialRampToValueAtTime(0.001, t + 0.45);
    o.connect(og).connect(this.master);
    o.start(t); o.stop(t + 0.5);
  }

  // 受伤
  hurt() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sawtooth';
    o.frequency.setValueAtTime(220, t);
    o.frequency.exponentialRampToValueAtTime(70, t + 0.25);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.3);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.32);
  }

  // 落地
  thud(strength = 1) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const o = this.ctx.createOscillator();
    o.type = 'sine';
    o.frequency.setValueAtTime(120, t);
    o.frequency.exponentialRampToValueAtTime(45, t + 0.12);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.35 * Math.min(strength, 1.5), t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.15);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + 0.18);
  }

  // 蛛丝飞跃冲刺
  zip() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const src = this.ctx.createBufferSource();
    src.buffer = this._noiseBuffer(0.4);
    const f = this.ctx.createBiquadFilter();
    f.type = 'bandpass'; f.Q.value = 2;
    f.frequency.setValueAtTime(500, t);
    f.frequency.exponentialRampToValueAtTime(3800, t + 0.3);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(0.4, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + 0.35);
    src.connect(f).connect(g).connect(this.master);
    src.start(t); src.stop(t + 0.4);
  }

  // 胜利小旋律
  victory() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const notes = [523.25, 659.25, 783.99, 1046.5];
    notes.forEach((freq, i) => {
      const o = this.ctx.createOscillator();
      o.type = 'triangle'; o.frequency.value = freq;
      const g = this.ctx.createGain();
      const st = t + i * 0.16;
      g.gain.setValueAtTime(0, st);
      g.gain.linearRampToValueAtTime(0.35, st + 0.02);
      g.gain.exponentialRampToValueAtTime(0.001, st + 0.7);
      o.connect(g).connect(this.master);
      o.start(st); o.stop(st + 0.75);
    });
  }

  _tone(type, f0, f1, dur, vol, delay = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + delay;
    const o = this.ctx.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    o.frequency.exponentialRampToValueAtTime(f1, t + dur);
    const g = this.ctx.createGain();
    g.gain.setValueAtTime(vol, t);
    g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    o.connect(g).connect(this.master);
    o.start(t); o.stop(t + dur + 0.02);
  }

  // 无人机激光
  laser() { this._tone('square', 1400, 180, 0.22, 0.12); }
  // 无人机锁定警告
  beep() { this._tone('sine', 1800, 1800, 0.08, 0.12); this._tone('sine', 1800, 1800, 0.08, 0.12, 0.12); }
  // 蛛网弹
  webShot() {
    this.thwip();
    this._tone('triangle', 900, 300, 0.1, 0.12);
  }
  // 命中
  hit() { this._tone('square', 300, 90, 0.12, 0.25); }
  // 穿过赛道环
  ring(i = 0) { this._tone('sine', 880 * Math.pow(1.06, i), 1760 * Math.pow(1.06, i), 0.25, 0.25); }
  // 倒计时
  count(final = false) { this._tone('sine', final ? 1320 : 660, final ? 1320 : 660, final ? 0.5 : 0.18, 0.3); }
  // 特技
  whoosh() { this.zip(); }
}
