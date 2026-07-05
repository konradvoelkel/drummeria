/* =============================================================================
 * metronome.js — sample-accurate click using a lookahead scheduler
 * -----------------------------------------------------------------------------
 * Classic Web Audio pattern: a setInterval timer wakes every 25ms and schedules
 * any clicks falling inside a short lookahead window directly on the audio
 * clock, so timing is rock-solid regardless of JS jitter.
 * Routed to metroOut (straight to destination) so it is NOT captured in the WAV.
 * ========================================================================== */

DM.metronome = (function () {
  'use strict';

  const state = {
    bpm: 120,
    beatsPerBar: 4,
    running: false,
    timer: null,
    nextNoteTime: 0,
    beat: 0,
    lookahead: 0.1,   // schedule this far ahead (s)
    interval: 25,     // timer period (ms)
    events: DM.util.emitter(),
  };

  function click(time, accent) {
    const eng = DM.AudioEngine; eng.ensure();
    const ctx = eng.state.ctx;
    const osc = ctx.createOscillator();
    const g = ctx.createGain();
    osc.frequency.value = accent ? 1500 : 1000;
    g.gain.setValueAtTime(0.0001, time);
    g.gain.exponentialRampToValueAtTime(accent ? 0.5 : 0.3, time + 0.001);
    g.gain.exponentialRampToValueAtTime(0.0001, time + 0.04);
    osc.connect(g); g.connect(eng.state.metroOut);
    osc.start(time); osc.stop(time + 0.05);
  }

  function scheduler() {
    const ctx = DM.AudioEngine.state.ctx;
    const secPerBeat = 60 / state.bpm;
    while (state.nextNoteTime < ctx.currentTime + state.lookahead) {
      const accent = state.beat % state.beatsPerBar === 0;
      click(state.nextNoteTime, accent);
      state.events.emit('beat', { beat: state.beat % state.beatsPerBar, accent, time: state.nextNoteTime });
      state.nextNoteTime += secPerBeat;
      state.beat++;
    }
  }

  function start() {
    const eng = DM.AudioEngine; eng.ensure(); eng.resume();
    if (state.running) return;
    state.running = true;
    state.beat = 0;
    state.nextNoteTime = eng.state.ctx.currentTime + 0.05;
    state.timer = setInterval(scheduler, state.interval);
  }

  function stop() {
    state.running = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
  }

  function toggle() { state.running ? stop() : start(); }
  function setBpm(b) { state.bpm = DM.util.clamp(b, 20, 300); }
  function setBeatsPerBar(n) { state.beatsPerBar = DM.util.clamp(n, 1, 16); }

  return {
    start, stop, toggle, setBpm, setBeatsPerBar,
    on: (e, fn) => state.events.on(e, fn),
    get running() { return state.running; },
    get bpm() { return state.bpm; },
  };
})();
