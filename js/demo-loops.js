/* =============================================================================
 * demo-loops.js — hard-wired demo grooves ("hear how it sounds" in one click)
 * -----------------------------------------------------------------------------
 * A tiny step sequencer: each groove is 32 steps of 16th notes (2 bars of 4/4)
 * per slot, scheduled with the same lookahead pattern as the metronome so
 * timing is sample-accurate. Tempo follows the shared BPM field (selecting a
 * groove sets its natural tempo there); `swing` delays the second half of each
 * beat for shuffled feels. Hits go through AudioEngine.play(), so they use the
 * selected kit, flash the pads/SVG kit, and are captured by the WAV recorder.
 * ========================================================================== */

DM.grooves = (function () {
  'use strict';

  const U = DM.util;
  const STEPS = 32;

  /** [step, velocity] pairs per slot. Helper to spread a vel over many steps. */
  const on = (steps, vel) => steps.map((s) => [s, vel]);

  const PATTERNS = [
    {
      id: 'rock', name: 'Rock straight', bpm: 112, swing: 0,
      tracks: {
        crash: [[0, 105]],
        kick: [[0, 120], [10, 105], [16, 120], [26, 105]],
        snare: [[8, 118], [24, 118]],
        hihat_closed: on([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 22, 24, 26, 28], 65)
          .map(([s, v]) => [s, s % 4 === 0 ? 95 : v]),
        hihat_open: [[30, 90]],
      },
    },
    {
      id: 'funk', name: 'Funk 16ths', bpm: 100, swing: 0.05,
      tracks: {
        kick: [[0, 120], [3, 95], [10, 110], [16, 120], [19, 95], [26, 110]],
        snare: [[8, 120], [24, 120], [11, 42], [15, 38], [27, 45], [30, 40]],
        hihat_closed: Array.from({ length: STEPS }, (_, s) => s)
          .filter((s) => s !== 14)
          .map((s) => [s, s % 4 === 0 ? 92 : s % 2 === 0 ? 68 : 45]),
        hihat_open: [[14, 85]],
      },
    },
    {
      id: 'hiphop', name: 'Hip-hop boom bap', bpm: 92, swing: 0.08,
      tracks: {
        kick: [[0, 120], [7, 100], [10, 108], [16, 115], [23, 100], [25, 95]],
        snare: [[8, 120], [24, 120], [30, 45]],
        hihat_closed: on([0, 2, 4, 6, 8, 10, 12, 14, 16, 18, 20, 24, 26, 28, 30], 60)
          .map(([s, v]) => [s, s % 8 === 0 ? 88 : v]),
        hihat_open: [[22, 80]],
      },
    },
    {
      id: 'house', name: 'House four-on-floor', bpm: 124, swing: 0,
      tracks: {
        kick: on([0, 4, 8, 12, 16, 20, 24, 28], 120),
        clap: on([4, 12, 20, 28], 95),
        hihat_open: on([2, 6, 10, 14, 18, 22, 26, 30], 85),
        hihat_closed: on([1, 3, 5, 7, 9, 11, 13, 15, 17, 19, 21, 23, 25, 27, 29, 31], 42),
      },
    },
    {
      id: 'jazz', name: 'Jazz swing (ride)', bpm: 142, swing: 0.16,
      tracks: {
        ride: [[0, 95], [4, 80], [6, 70], [8, 95], [12, 80], [14, 70],
               [16, 95], [20, 80], [22, 70], [24, 95], [28, 80], [30, 70]],
        hihat_pedal: on([4, 12, 20, 28], 85),
        kick: on([0, 16], 35),
        snare: [[10, 45], [19, 40], [26, 50]],
      },
    },
    {
      id: 'electro', name: 'Electro 808', bpm: 128, swing: 0,
      tracks: {
        kick: [[0, 120], [6, 105], [16, 120], [22, 105], [28, 90]],
        snare: [[8, 115], [24, 115]],
        clap: [[8, 85], [24, 85]],
        cowbell: [[2, 75], [18, 75], [27, 60]],
        hihat_closed: Array.from({ length: STEPS }, (_, s) => s)
          .filter((s) => s !== 12 && s !== 28)
          .map((s) => [s, s % 4 === 0 ? 90 : s % 2 === 0 ? 70 : 48]),
        hihat_open: [[12, 88], [28, 88]],
      },
    },
  ];

  const state = {
    playing: false,
    timer: null,
    step: 0,
    nextTime: 0,
    lookahead: 0.12, // s
    interval: 25,    // ms
  };

  const bpmInput = () => U.$('#bpm');
  const bpm = () => U.clamp(+(bpmInput() && bpmInput().value) || 120, 20, 300);

  function current() {
    const sel = U.$('#grooveSelect');
    return PATTERNS.find((p) => p.id === (sel && sel.value)) || PATTERNS[0];
  }

  function scheduler() {
    const ctx = DM.AudioEngine.state.ctx;
    const p = current();
    const beat = 60 / bpm();
    const stepDur = beat / 4;
    while (state.nextTime < ctx.currentTime + state.lookahead) {
      const s = state.step % STEPS;
      // swing: push the 2nd half of every beat later for shuffled feels
      const swingDelay = p.swing && s % 4 >= 2 ? p.swing * beat : 0;
      for (const slot in p.tracks) {
        for (const [hitStep, vel] of p.tracks[slot]) {
          if (hitStep === s) DM.AudioEngine.play(slot, vel, state.nextTime + swingDelay);
        }
      }
      state.nextTime += stepDur;
      state.step++;
    }
  }

  function play() {
    const eng = DM.AudioEngine;
    eng.ensure(); eng.resume();
    if (state.playing) return;
    state.playing = true;
    state.step = 0;
    state.nextTime = eng.state.ctx.currentTime + 0.06;
    state.timer = setInterval(scheduler, state.interval);
    updateButton();
  }

  function stop() {
    state.playing = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    updateButton();
  }

  function toggle() { state.playing ? stop() : play(); }

  function updateButton() {
    const btn = U.$('#groovePlayBtn');
    if (!btn) return;
    btn.classList.toggle('active', state.playing);
    btn.textContent = state.playing ? '■ Stop groove' : '▶ Play groove';
  }

  function init() {
    const sel = U.$('#grooveSelect');
    const btn = U.$('#groovePlayBtn');
    if (!sel || !btn) return;

    PATTERNS.forEach((p) => sel.appendChild(
      U.el('option', { value: p.id, text: p.name + ' · ' + p.bpm + ' bpm' })));

    sel.addEventListener('change', () => {
      const inp = bpmInput();
      if (inp) inp.value = current().bpm; // adopt the groove's natural tempo
      if (DM.metronome) DM.metronome.setBpm(current().bpm);
    });
    btn.addEventListener('click', toggle);
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { PATTERNS, play, stop, toggle, get playing() { return state.playing; } };
})();
