(() => {
  'use strict';

  /* ================= Configuration ================= */
  const CONFIG = {
    countdownMs: 5000,
    blackoutMs: 3000,
    image: 'assets/images/jumscare.jpg',
    sound: 'assets/sounds/jumscare.mp3',
    replayDelayMs: 2000,
    masterVolume: 0.9
  };

  /* ================= Elements ================= */
  const $ = (id) => document.getElementById(id);
  const body = document.body;
  const digitEl = $('digit');
  const segs = [...digitEl.querySelectorAll('.seg')];
  const readout = $('readout');
  const flashEl = $('flash');
  const activateBtn = $('activate');
  const fsBtn = $('fullscreen');
  const scareEl = $('scare');
  const scareImg = $('scareImg');
  const replayBtn = $('replay');

  /* ================= Audio (Web Audio API) ================= */
  const AudioFX = (() => {
    let ctx = null, master = null, drone = null, scareBuffer = null, soundTried = false;

    function init() {
      if (ctx) return;
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return;
      ctx = new AC();
      const comp = ctx.createDynamicsCompressor();
      master = ctx.createGain();
      master.gain.value = CONFIG.masterVolume;
      master.connect(comp);
      comp.connect(ctx.destination);
    }

    async function unlock() {
      try {
        init();
        if (ctx && ctx.state === 'suspended') await ctx.resume();
      } catch (e) { /* audio is optional */ }
    }

    async function loadScareSound() {
      if (!ctx || scareBuffer || soundTried) return;
      soundTried = true;
      try {
        const res = await fetch(CONFIG.sound);
        if (!res.ok) throw new Error('missing');
        const data = await res.arrayBuffer();
        scareBuffer = await new Promise((ok, fail) => ctx.decodeAudioData(data, ok, fail));
      } catch (e) {
        scareBuffer = null; // synthesized fallback will be used
      }
    }

    function tick(offset, level) {
      if (!ctx) return;
      const t = ctx.currentTime + offset;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'square';
      o.frequency.setValueAtTime(900 + level * 700, t);
      o.frequency.exponentialRampToValueAtTime(260, t + 0.04);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.16 + level * 0.22, t + 0.003);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + 0.08);
    }

    function beep(offset, freq, dur, vol) {
      if (!ctx) return;
      const t = ctx.currentTime + offset;
      const o = ctx.createOscillator();
      const g = ctx.createGain();
      o.type = 'sine';
      o.frequency.value = freq;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(vol, t + 0.005);
      g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
      o.connect(g).connect(master);
      o.start(t);
      o.stop(t + dur + 0.02);
    }

    function startDrone(seconds) {
      if (!ctx) return;
      const t = ctx.currentTime;
      const o = ctx.createOscillator();
      const f = ctx.createBiquadFilter();
      const g = ctx.createGain();
      o.type = 'sawtooth';
      o.frequency.setValueAtTime(48, t);
      o.frequency.exponentialRampToValueAtTime(120, t + seconds);
      f.type = 'lowpass';
      f.frequency.setValueAtTime(140, t);
      f.frequency.exponentialRampToValueAtTime(700, t + seconds);
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.14, t + seconds);
      o.connect(f).connect(g).connect(master);
      o.start(t);
      drone = { o, g };
    }

    function stopAll() {
      if (!ctx || !drone) return;
      const t = ctx.currentTime;
      drone.g.gain.cancelScheduledValues(t);
      drone.g.gain.setValueAtTime(0.0001, t);
      try { drone.o.stop(t + 0.02); } catch (e) {}
      drone = null;
    }

    function playScare() {
      if (!ctx) return;
      const t = ctx.currentTime;
      if (scareBuffer) {
        const src = ctx.createBufferSource();
        const g = ctx.createGain();
        src.buffer = scareBuffer;
        g.gain.value = 0.9;
        src.connect(g).connect(master);
        src.start(t);
        return;
      }
      // Synthesized fallback: screech + noise burst
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.5, t + 0.01);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 1.1);
      g.connect(master);

      [0, 7].forEach((detune) => {
        const o = ctx.createOscillator();
        o.type = 'sawtooth';
        o.frequency.setValueAtTime(1400 + detune * 20, t);
        o.frequency.exponentialRampToValueAtTime(180, t + 0.9);
        o.connect(g);
        o.start(t);
        o.stop(t + 1.1);
      });

      const len = Math.floor(ctx.sampleRate * 0.5);
      const buf = ctx.createBuffer(1, len, ctx.sampleRate);
      const d = buf.getChannelData(0);
      for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * (1 - i / len);
      const n = ctx.createBufferSource();
      n.buffer = buf;
      n.connect(g);
      n.start(t);
    }

    return { unlock, loadScareSound, tick, beep, startDrone, stopAll, playScare };
  })();

  /* ================= Display ================= */
  const DIGITS = { '5': 'afgcd', '4': 'fgbc', '3': 'abgcd', '2': 'abged', '1': 'bc', '-': 'g' };

  function setDigit(ch) {
    const on = DIGITS[ch] || '';
    segs.forEach((s) => s.classList.toggle('on', on.includes(s.dataset.seg)));
  }

  function renderReadout(msLeft) {
    const v = Math.max(0, msLeft);
    const s = Math.floor(v / 1000);
    const ms = Math.floor(v % 1000);
    readout.textContent = `00:0${s}.${String(ms).padStart(3, '0')}`;
  }

  function retrigger(el, cls) {
    el.classList.remove(cls);
    void el.offsetWidth;
    el.classList.add(cls);
  }

  function setPhase(p) { body.dataset.phase = p; }

  /* ================= Preloading ================= */
  function preloadImage() {
    return new Promise((resolve) => {
      if (scareImg.complete && scareImg.naturalWidth > 0) return resolve(true);
      const timer = setTimeout(() => resolve(false), 5000);
      scareImg.onload = () => { clearTimeout(timer); resolve(true); };
      scareImg.onerror = () => { clearTimeout(timer); resolve(false); };
      scareImg.src = CONFIG.image;
    });
  }

  /* ================= Sequence ================= */
  let state = 'intro'; // intro -> starting -> count -> blackout -> scare
  let timer = null;

  async function start() {
    if (state !== 'intro') return; // blocks repeated clicks
    state = 'starting';
    activateBtn.disabled = true;

    await AudioFX.unlock();
    await Promise.all([preloadImage(), AudioFX.loadScareSound()]);

    runSequence(performance.now());
  }

  function runSequence(t0) {
    state = 'count';
    setPhase('count');
    digitEl.classList.remove('idle');
    AudioFX.startDrone(CONFIG.countdownMs / 1000);

    const blackoutAt = CONFIG.countdownMs;
    const scareAt = CONFIG.countdownMs + CONFIG.blackoutMs;
    let lastSec = -1;

    timer = setInterval(() => {
      const e = performance.now() - t0; // timestamp-based, never drifts

      if (e < blackoutAt) {
        const sec = Math.floor(e / 1000);
        if (sec !== lastSec) { lastSec = sec; onSecond(5 - sec); }
        renderReadout(blackoutAt - e);
      } else if (e < scareAt) {
        if (state !== 'blackout') toBlackout();
      } else {
        clearInterval(timer);
        timer = null;
        showScare();
      }
    }, 8);
  }

  function onSecond(n) {
    const level = (5 - n) / 4; // 0 -> 1
    setDigit(String(n));
    retrigger(digitEl, 'glitch');
    body.style.setProperty('--amp', (0.6 + level * 2.8).toFixed(2));
    retrigger(flashEl, 'pulse');

    AudioFX.tick(0, level);
    AudioFX.beep(0, 1000 + level * 900, 0.07, 0.05 + level * 0.05);
    if (n <= 4) AudioFX.tick(0.5, level);
    if (n <= 3) { AudioFX.tick(0.25, level); AudioFX.tick(0.75, level); }
    if (n <= 2) [0.125, 0.375, 0.625, 0.875].forEach((o) => AudioFX.tick(o, level));
    if (n === 1) AudioFX.beep(0.5, 1900, 0.2, 0.09);
  }

  function toBlackout() {
    state = 'blackout';
    AudioFX.stopAll();
    setPhase('blackout');
    if (document.fullscreenElement == null) window.scrollTo(0, 0);
  }

  function showScare() {
    state = 'scare';
    const loaded = scareImg.complete && scareImg.naturalWidth > 0;
    scareEl.classList.toggle('fallback', !loaded);
    setPhase('scare'); // instant, no transition
    AudioFX.playScare();
    try { if (navigator.vibrate) navigator.vibrate([120, 40, 200]); } catch (e) {}
    setTimeout(() => { if (state === 'scare') replayBtn.classList.add('show'); }, CONFIG.replayDelayMs);
  }

  function reset() {
    replayBtn.classList.remove('show');
    body.style.setProperty('--amp', '0');
    digitEl.classList.add('idle');
    setDigit('-');
    renderReadout(CONFIG.countdownMs);
    activateBtn.disabled = false;
    state = 'intro';
    setPhase('intro');
    activateBtn.focus({ preventScroll: true });
  }

  /* ================= Fullscreen ================= */
  const root = document.documentElement;
  const canFS = !!(root.requestFullscreen || root.webkitRequestFullscreen);

  function toggleFullscreen() {
    const active = document.fullscreenElement || document.webkitFullscreenElement;
    try {
      if (active) (document.exitFullscreen || document.webkitExitFullscreen).call(document);
      else (root.requestFullscreen || root.webkitRequestFullscreen).call(root);
    } catch (e) { /* ignore */ }
  }

  if (!canFS) fsBtn.hidden = true; // iPhone Safari has no fullscreen API for pages

  /* ================= Init ================= */
  activateBtn.addEventListener('click', start);
  replayBtn.addEventListener('click', reset);
  fsBtn.addEventListener('click', toggleFullscreen);
  scareImg.addEventListener('dragstart', (e) => e.preventDefault());
  setDigit('-');
  renderReadout(CONFIG.countdownMs);
})();