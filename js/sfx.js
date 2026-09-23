/* sfx.js — 纯 WebAudio 合成音效，无需任何音频文件（保证离线可用） */
(function (global) {
  'use strict';

  let ctx = null;
  let enabled = true;

  function ac() {
    if (!ctx) {
      const C = global.AudioContext || global.webkitAudioContext;
      if (!C) return null;
      ctx = new C();
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, gain, delay, slideTo) {
    const a = ac();
    if (!a) return;
    const t0 = a.currentTime + (delay || 0);
    const osc = a.createOscillator();
    const g = a.createGain();
    osc.type = type || 'sine';
    osc.frequency.setValueAtTime(freq, t0);
    if (slideTo) osc.frequency.exponentialRampToValueAtTime(slideTo, t0 + dur);
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain || 0.16, t0 + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    osc.connect(g); g.connect(a.destination);
    osc.start(t0); osc.stop(t0 + dur + 0.03);
  }

  function noise(dur, gain, filterFreq) {
    const a = ac();
    if (!a) return;
    const len = Math.floor(a.sampleRate * dur);
    const buf = a.createBuffer(1, len, a.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = a.createBufferSource();
    src.buffer = buf;
    const f = a.createBiquadFilter();
    f.type = 'bandpass';
    f.frequency.value = filterFreq || 2600;
    const g = a.createGain();
    g.gain.value = gain || 0.12;
    src.connect(f); f.connect(g); g.connect(a.destination);
    src.start();
  }

  const SFX = {
    get enabled() { return enabled; },
    setEnabled(v) { enabled = !!v; if (v) ac(); },
    unlock() { ac(); },

    deal() { noise(0.07, 0.07, 3200); },
    click() { tone(880, 0.05, 'square', 0.06); },
    select() { tone(1200, 0.045, 'triangle', 0.07); },

    play() { noise(0.1, 0.1, 1800); tone(520, 0.09, 'triangle', 0.1); },
    pass() { tone(300, 0.14, 'sine', 0.1, 0, 220); },

    bomb() {
      noise(0.35, 0.28, 300);
      tone(120, 0.45, 'sawtooth', 0.22, 0, 45);
      tone(70, 0.5, 'sine', 0.2, 0.02, 35);
    },
    rocket() {
      noise(0.4, 0.3, 700);
      tone(200, 0.6, 'sawtooth', 0.24, 0, 60);
      tone(1400, 0.35, 'square', 0.1, 0, 300);
    },

    win() {
      [523, 659, 784, 1047].forEach((f, i) => tone(f, 0.22, 'triangle', 0.15, i * 0.1));
    },
    lose() {
      [440, 392, 330, 262].forEach((f, i) => tone(f, 0.26, 'sine', 0.13, i * 0.12));
    },
    bid() { tone(660, 0.1, 'triangle', 0.12); tone(990, 0.12, 'triangle', 0.1, 0.06); },
    turn() { tone(760, 0.07, 'sine', 0.09); tone(1010, 0.07, 'sine', 0.07, 0.06); }
  };

  global.SFX = SFX;
})(window);
