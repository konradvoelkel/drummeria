/* =============================================================================
 * demo-loops.js — hard-wired demo grooves ("hear how it sounds" in one click)
 * -----------------------------------------------------------------------------
 * A tiny step sequencer: each groove is 32 steps of 16th notes (2 bars of 4/4)
 * per slot, scheduled with the same lookahead pattern as the metronome so
 * timing is sample-accurate. Tempo follows the shared BPM field (selecting a
 * groove sets its natural tempo there); `swing` delays the second half of each
 * beat for shuffled feels. Hits go through AudioEngine.play(), so they use the
 * selected kit, flash the pads/SVG kit, and are captured by the WAV recorder.
 *
 * Follow mode: the foot pedal (CC64) drives the groove instead of the BPM
 * field. The first press starts it on beat 1, the second sets the tempo, and
 * every later press pulls tempo and phase toward the player like a soft PLL:
 * the press is snapped to the nearest beat or groove kick, the phase error is
 * corrected by `strength`, and the tempo blends toward the press interval
 * (read in whole beats; gaps that aren't near a whole beat leave it alone).
 * The groove itself stays on its grid, so a wobbly foot comes out tight.
 * Two bars without a press stop it.
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
    follow: {
      enabled: false,
      kick: 'steer',   // 'steer': pedal is silent, groove plays the kick; 'live': pedal sounds, groove kick muted
      strength: 0.5,   // 0..1, how hard each press pulls phase (tempo pulls half as hard)
      stepDur: 0,      // s per 16th while following
      lastPress: null, // audio time of the previous press
      presses: 0,
    },
  };

  const bpmInput = () => U.$('#bpm');
  const bpm = () => U.clamp(+(bpmInput() && bpmInput().value) || 120, 20, 300);

  function current() {
    const sel = U.$('#grooveSelect');
    return PATTERNS.find((p) => p.id === (sel && sel.value)) || PATTERNS[0];
  }

  const following = () => state.follow.enabled && state.playing;
  const stepDuration = () => following() ? state.follow.stepDur : 60 / bpm() / 4;

  function scheduler() {
    const ctx = DM.AudioEngine.state.ctx;
    const p = current();
    const stepDur = stepDuration();
    const beat = stepDur * 4;
    if (following() && ctx.currentTime - state.follow.lastPress > 2 * 16 * stepDur) {
      stop(); return;                   // the foot went quiet: two bars, stop
    }
    // in 'live' follow the player's pedal is the kick, so mute the groove's own
    const muted = following() && state.follow.kick === 'live' ? DM.midi.getSustainConfig().mode : null;
    while (state.nextTime < ctx.currentTime + state.lookahead) {
      const s = state.step % STEPS;
      // swing: push the 2nd half of every beat later for shuffled feels
      const swingDelay = p.swing && s % 4 >= 2 ? p.swing * beat : 0;
      for (const slot in p.tracks) {
        if (slot === muted) continue;
        for (const [hitStep, vel] of p.tracks[slot]) {
          if (hitStep === s) DM.AudioEngine.play(slot, vel, state.nextTime + swingDelay);
        }
      }
      state.nextTime += stepDur;
      state.step++;
    }
  }

  function play(at) {
    const eng = DM.AudioEngine;
    eng.ensure(); eng.resume();
    if (state.playing) return;
    state.playing = true;
    state.step = 0;
    state.nextTime = at != null ? at : eng.state.ctx.currentTime + 0.06;
    if (state.follow.enabled && at == null) {
      // started from the button: follow from here, as if this were the first press
      state.follow.stepDur = 60 / current().bpm / 4;
      state.follow.lastPress = state.nextTime;
      state.follow.presses = 1;
    }
    state.timer = setInterval(scheduler, state.interval);
    updateButton();
  }

  function stop() {
    state.playing = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.follow.lastPress = null;
    updateButton();
    const out = U.$('#followInfo');
    if (out) out.textContent = state.follow.enabled ? 'press the pedal to start' : '';
  }

  /* --- follow the foot pedal ------------------------------------------- */

  function onPedal() {
    const f = state.follow;
    if (!f.enabled) return;
    const eng = DM.AudioEngine; eng.ensure();
    const t = eng.state.ctx.currentTime;

    if (!state.playing || f.lastPress === null) {
      // First press: start on beat 1 right now, at the groove's own tempo for now.
      f.stepDur = 60 / current().bpm / 4;
      f.presses = 1;
      f.lastPress = t;
      if (state.playing) stop();
      state.lookahead = 0.06;           // shorter horizon so corrections land sooner
      play(t);
      return;
    }

    const ioi = t - f.lastPress;
    f.lastPress = t;
    f.presses++;
    let sd = f.stepDur;

    if (f.presses === 2) {
      // Second press sets the tempo: read the gap as 1 or 2 beats, whichever
      // lands nearer the groove's own tempo, then re-anchor on that beat.
      const ref = current().bpm;
      const beats = [1, 2].reduce((a, b) =>
        Math.abs(60 * b / ioi - ref) < Math.abs(60 * a / ioi - ref) ? b : a);
      sd = U.clamp(ioi / beats / 4, 60 / 220 / 4, 60 / 40 / 4);
      f.stepDur = sd;
      state.nextTime = t + (state.step - beats * 4) * sd;
    } else {
      // Later presses: snap to the nearest beat or groove kick, pull phase
      // toward it, and blend tempo toward the gap read in whole beats.
      const pos = state.step - (state.nextTime - t) / sd;    // in 16ths
      const err = pos - nearestTarget(pos);                    // +: groove is ahead
      state.nextTime += f.strength * err * sd;
      const beats = Math.round(ioi / (4 * sd));
      if (beats >= 1 && beats <= 4 && Math.abs(ioi / beats / (4 * sd) - 1) < 0.25) {
        sd += (f.strength / 2) * (ioi / beats / 4 - sd);
        f.stepDur = U.clamp(sd, 60 / 220 / 4, 60 / 40 / 4);
      }
    }
    state.nextTime = Math.max(state.nextTime, t + 0.005);
    showFollowBpm();
  }

  /** Nearest step (as an absolute 16th position) that is a beat or a groove kick. */
  function nearestTarget(pos) {
    const kicks = (current().tracks.kick || []).map(([s]) => s);
    const base = Math.floor(pos / STEPS) * STEPS;
    let best = Math.round(pos / 4) * 4;
    for (const off of [-STEPS, 0, STEPS]) {
      for (const k of kicks) {
        const c = base + off + k;
        if (Math.abs(c - pos) < Math.abs(best - pos)) best = c;
      }
    }
    return best;
  }

  function showFollowBpm() {
    const b = Math.round(60 / (state.follow.stepDur * 4));
    const inp = bpmInput(); if (inp) inp.value = b;
    const out = U.$('#followInfo'); if (out) out.textContent = 'following · ' + b + ' bpm';
  }

  function setFollow(cfg) {
    Object.assign(state.follow, cfg);
    const f = state.follow;
    // In 'steer' the pedal is only a timing signal; the groove plays the kick.
    DM.midi.setSustainConfig({ sound: !(f.enabled && f.kick === 'steer') });
    if (!f.enabled) { f.lastPress = null; state.lookahead = 0.12; }
    const out = U.$('#followInfo');
    if (out) out.textContent = f.enabled ? (state.playing ? '' : 'press the pedal to start') : '';
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

    const fp = U.$('#followPedal'), fk = U.$('#followKick'), fs = U.$('#followStrength');
    const save = () => DM.storage.setSetting('grooveFollow',
      { enabled: fp.checked, kick: fk.value, strength: +fs.value }).catch(() => {});
    const apply = () => setFollow({ enabled: fp.checked, kick: fk.value, strength: fs.value / 100 });
    [fp, fk, fs].forEach((el) => el.addEventListener('change', () => { apply(); save(); }));
    DM.midi.on('pedal', onPedal);
    DM.storage.getSetting('grooveFollow').then((g) => {
      if (!g) return;
      fp.checked = g.enabled; fk.value = g.kick; fs.value = g.strength;
      apply();
    }).catch(() => {});
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    PATTERNS, play, stop, toggle, setFollow,
    get playing() { return state.playing; },
    get followBpm() { return 60 / (state.follow.stepDur * 4); },
  };
})();
