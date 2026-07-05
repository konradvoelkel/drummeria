/* =============================================================================
 * audio-engine.js — the real-time playback core
 * -----------------------------------------------------------------------------
 * Owns the AudioContext and master signal chain, and turns a (slot, velocity)
 * request into sound — either by calling the synth engine or by playing decoded
 * sample buffers (multi-velocity layered).
 *
 * Signal chain:
 *   voices ─► voiceBus ─► masterGain ─► limiter ─► tap ─► destination
 *                                                   └─► (recorder taps here)
 *   metronome ─► metroOut ─► destination   (heard but kept out of the WAV)
 *
 * Features: velocity curves, ±timing/±pitch humanization, choke groups
 * (hi-hat open↔closed, crash), low-latency scheduling, dual-kit layering.
 * ========================================================================== */

DM.AudioEngine = (function () {
  'use strict';

  const U = DM.util;

  const state = {
    ctx: null,
    voiceBus: null,
    masterGain: null,
    limiter: null,
    tap: null,
    metroOut: null,
    primaryKit: null,      // decoded kit object (synth preset or sample kit)
    secondaryKit: null,    // optional layered kit
    layerMix: 0.6,         // gain applied to the secondary kit
    masterVolume: 0.9,
    velocityCurve: 'linear',
    humanize: { enabled: true, timing: 0.010, pitch: 0.03 }, // ±10ms, ±3%
    chokes: new Map(),     // group -> Set(voice)
    events: U.emitter(),
  };

  /** Create the context lazily (must follow a user gesture in most browsers). */
  function ensure() {
    if (state.ctx) return state.ctx;
    const Ctx = window.AudioContext || window.webkitAudioContext;
    // Don't force sampleRate: adopt the device's native rate (usually 48 kHz) so
    // the browser doesn't insert a resampler on the OUTPUT path (lower latency &
    // CPU). decodeAudioData resamples loaded WAVs to this rate automatically.
    const ctx = new Ctx({ latencyHint: 'interactive' });

    const voiceBus = ctx.createGain();
    const masterGain = ctx.createGain();
    masterGain.gain.value = state.masterVolume;

    // Gentle brickwall-ish limiter so hard hits / layering don't clip.
    const limiter = ctx.createDynamicsCompressor();
    limiter.threshold.value = -3;
    limiter.knee.value = 2;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.002;
    limiter.release.value = 0.12;

    const tap = ctx.createGain();      // recorder hooks in here
    const metroOut = ctx.createGain(); // separate path -> not captured by recorder

    voiceBus.connect(masterGain);
    masterGain.connect(limiter);
    limiter.connect(tap);
    tap.connect(ctx.destination);
    metroOut.connect(ctx.destination);

    Object.assign(state, { ctx, voiceBus, masterGain, limiter, tap, metroOut });
    return ctx;
  }

  function resume() {
    ensure();
    if (state.ctx.state === 'suspended') return state.ctx.resume();
    return Promise.resolve();
  }

  /* --- configuration ---------------------------------------------------- */

  function setKit(kit) { state.primaryKit = kit; }
  function setSecondaryKit(kit) { state.secondaryKit = kit; }
  function setLayerMix(v) { state.layerMix = U.clamp(v, 0, 1); }
  function setMasterVolume(v) {
    state.masterVolume = U.clamp(v, 0, 1.5);
    if (state.masterGain) state.masterGain.gain.value = state.masterVolume;
  }
  function setVelocityCurve(name) { state.velocityCurve = name; }
  function setHumanize(opts) { Object.assign(state.humanize, opts); }

  /* --- velocity curves -------------------------------------------------- */

  function curveGain(v127) {
    const x = U.clamp(v127, 0, 127) / 127;
    switch (state.velocityCurve) {
      case 'exp':    return x * x;             // softer — rewards hard hits
      case 'log':    return Math.sqrt(x);      // harder — compresses dynamics up
      case 'fixed':  return 0.85;              // ignore dynamics
      case 'sShape': return x * x * (3 - 2 * x);
      case 'linear':
      default:       return x;                 // gain = velocity/127 (spec default)
    }
  }

  /* --- choke groups ----------------------------------------------------- */

  function registerChoke(group, voice) {
    if (!group) return;
    if (!state.chokes.has(group)) state.chokes.set(group, new Set());
    const set = state.chokes.get(group);
    const now = state.ctx.currentTime;
    // Silence everything currently ringing in this group.
    set.forEach((v) => { v.stop(now); set.delete(v); });
    set.add(voice);
    // Auto-remove once finished so the set doesn't grow unbounded.
    const ttl = (voice.endTime - now + 0.1) * 1000;
    setTimeout(() => set.delete(voice), Math.max(50, ttl));
  }

  /** Immediately silence every voice in a choke group (used for half-open HH). */
  function chokeGroup(group) {
    const set = state.chokes.get(group);
    if (!set || !state.ctx) return;
    const now = state.ctx.currentTime;
    set.forEach((v) => { v.stop(now); set.delete(v); });
  }

  /* --- core trigger ----------------------------------------------------- */

  /**
   * Play an instrument slot.
   * @param {string} slot   canonical slot id (e.g. 'kick', 'hihat_open')
   * @param {number} vel127 MIDI velocity 0..127
   * @param {number} [when] AudioContext time to schedule at (default: now)
   * @param {boolean} [silent] don't emit the 'hit' UI event (used internally)
   */
  function play(slot, vel127, when, silent) {
    ensure();
    if (state.ctx.state === 'suspended') state.ctx.resume();

    const baseGain = curveGain(vel127);
    if (baseGain <= 0) return;

    let t = (when != null ? when : state.ctx.currentTime);
    if (state.humanize.enabled && state.humanize.timing) {
      t += Math.random() * state.humanize.timing; // only ever nudge later (>=0)
    }

    triggerKit(state.primaryKit, slot, baseGain, t, 1);
    if (state.secondaryKit) {
      triggerKit(state.secondaryKit, slot, baseGain, t, state.layerMix);
    }

    if (!silent) state.events.emit('hit', { slot, velocity: vel127, time: t });
  }

  function triggerKit(kit, slot, baseGain, t, mix) {
    if (!kit) return;
    const inst = kit.instruments[slot];
    if (!inst) return;

    const pitchHumanize = state.humanize.enabled
      ? (1 + U.randSym(state.humanize.pitch))
      : 1;
    const tuneRate = U.semitonesToRate(kit.tune || 0) * pitchHumanize;

    let voice;
    if (inst.layers) {
      voice = playSampleVoice(inst, baseGain * mix, t, tuneRate);
    } else {
      voice = playSynthVoice(inst, baseGain * mix, t, tuneRate);
    }
    if (voice && inst.choke) registerChoke(inst.choke, voice);
  }

  /** Synthesised voice: clone params, apply tune + humanized pitch. */
  function playSynthVoice(inst, gain, t, tuneRate) {
    const p = Object.assign({}, inst.params);
    if (p.pitch) p.pitch *= tuneRate;
    if (p.pitchStart) p.pitchStart *= tuneRate;
    if (p.pitchEnd) p.pitchEnd *= tuneRate;
    if (p.freq) p.freq *= tuneRate;
    return DM.synth.play(inst.synth, state.ctx, state.voiceBus, t, gain, p);
  }

  /** Sample voice: pick the right velocity layer and play the buffer. */
  function playSampleVoice(inst, gain, t, tuneRate) {
    const v127 = gain * 127;
    let layer = inst.layers.find((l) => v127 >= (l.minVel || 0) && v127 <= (l.maxVel == null ? 127 : l.maxVel));
    if (!layer) layer = inst.layers[inst.layers.length - 1];
    if (!layer || !layer.buffer) return null;

    const src = state.ctx.createBufferSource();
    src.buffer = layer.buffer;
    src.playbackRate.value = tuneRate * (layer.rate || 1);

    const vca = state.ctx.createGain();
    vca.gain.value = gain * (layer.gain || 1);
    src.connect(vca); vca.connect(state.voiceBus);
    src.start(t);

    const endTime = t + layer.buffer.duration / src.playbackRate.value;
    return {
      vca, endTime,
      stop(at) {
        try {
          vca.gain.cancelScheduledValues(at);
          vca.gain.setValueAtTime(Math.max(0.0001, vca.gain.value), at);
          vca.gain.exponentialRampToValueAtTime(0.0001, at + 0.012);
          src.stop(at + 0.02);
        } catch (e) { /* noop */ }
      },
    };
  }

  /* --- latency reporting ------------------------------------------------ */

  function getLatencyMs() {
    if (!state.ctx) return null;
    const base = state.ctx.baseLatency || 0;
    const out = state.ctx.outputLatency || 0;
    return Math.round((base + out) * 1000);
  }

  return {
    ensure, resume,
    setKit, setSecondaryKit, setLayerMix, setMasterVolume,
    setVelocityCurve, setHumanize,
    play, chokeGroup, getLatencyMs,
    on: (e, fn) => state.events.on(e, fn),
    get ctx() { return state.ctx; },
    get state() { return state; },
  };
})();
