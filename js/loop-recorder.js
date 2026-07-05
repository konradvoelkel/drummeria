/* =============================================================================
 * loop-recorder.js — record a phrase of hits and loop it back
 * -----------------------------------------------------------------------------
 * Captures resolved (slot, velocity) hits from the audio engine with timestamps,
 * then replays them on a loop using the same lookahead scheduler approach as the
 * metronome so playback stays tight. Optional quantize-to-grid.
 *
 * This is a performance loop layer (overdub-style), independent from the WAV
 * recorder which captures final audio.
 * ========================================================================== */

DM.loop = (function () {
  'use strict';

  const state = {
    recording: false,
    playing: false,
    events: [],          // { t (s from loop start), slot, velocity }
    loopLength: 0,        // seconds
    recStart: 0,
    timer: null,
    loopStart: 0,
    playHead: 0,          // index into events for the current pass
    quantize: 0,          // grid in seconds (0 = off)
    bus: DM.util.emitter(),
    unsub: null,
  };

  function startRecording() {
    const eng = DM.AudioEngine; eng.ensure(); eng.resume();
    state.events = [];
    state.recording = true;
    state.recStart = eng.state.ctx.currentTime;
    // Listen to every triggered hit and store it relative to record start.
    state.unsub = eng.on('hit', ({ slot, velocity }) => {
      if (!state.recording) return;
      let t = eng.state.ctx.currentTime - state.recStart;
      if (state.quantize > 0) t = Math.round(t / state.quantize) * state.quantize;
      state.events.push({ t, slot, velocity });
    });
    state.bus.emit('state', stateSnapshot());
  }

  function stopRecording() {
    if (!state.recording) return;
    const ctx = DM.AudioEngine.state.ctx;
    state.recording = false;
    if (state.unsub) { state.unsub(); state.unsub = null; }
    state.loopLength = Math.max(0.25, ctx.currentTime - state.recStart);
    state.bus.emit('state', stateSnapshot());
  }

  function play() {
    if (!state.events.length || state.playing) return;
    const eng = DM.AudioEngine; eng.ensure(); eng.resume();
    state.playing = true;
    state.loopStart = eng.state.ctx.currentTime + 0.05;
    state.playHead = 0;
    state.timer = setInterval(schedule, 25);
    state.bus.emit('state', stateSnapshot());
  }

  function schedule() {
    const ctx = DM.AudioEngine.state.ctx;
    const lookahead = 0.1;
    const horizon = ctx.currentTime + lookahead;
    // Schedule events for the current pass; wrap to the next loop when done.
    while (state.playing) {
      const ev = state.events[state.playHead];
      if (!ev) { // wrap to next loop iteration
        state.loopStart += state.loopLength;
        state.playHead = 0;
        if (!state.events.length) break;
        continue;
      }
      const when = state.loopStart + ev.t;
      if (when > horizon) break;
      if (when >= ctx.currentTime) {
        DM.AudioEngine.play(ev.slot, ev.velocity, when);
      }
      state.playHead++;
    }
  }

  function stop() {
    state.playing = false;
    if (state.timer) clearInterval(state.timer);
    state.timer = null;
    state.bus.emit('state', stateSnapshot());
  }

  function clear() {
    stop();
    state.events = [];
    state.loopLength = 0;
    state.bus.emit('state', stateSnapshot());
  }

  function setQuantize(sec) { state.quantize = sec; }

  function stateSnapshot() {
    return {
      recording: state.recording,
      playing: state.playing,
      count: state.events.length,
      loopLength: state.loopLength,
    };
  }

  return {
    startRecording, stopRecording, play, stop, clear, setQuantize,
    on: (e, fn) => state.bus.on(e, fn),
    get recording() { return state.recording; },
    get playing() { return state.playing; },
    snapshot: stateSnapshot,
  };
})();
