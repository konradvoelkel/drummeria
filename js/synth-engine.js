/* =============================================================================
 * synth-engine.js — procedural drum synthesis (Web Audio)
 * -----------------------------------------------------------------------------
 * Every built-in kit is synthesised in real time. This is deliberate:
 *   - zero downloads, works instantly and fully offline
 *   - sub-millisecond "decode" cost (no buffers to load)
 *   - velocity, pitch and tone respond continuously to how hard you hit
 *
 * Each instrument function builds a small node graph feeding a per-voice VCA
 * (gain), schedules percussive envelopes, and returns a voice handle with a
 * stop(time) method so the audio engine can implement choke groups
 * (e.g. a closed hi-hat silencing a ringing open hi-hat).
 *
 * Conventions for every synth fn: (ctx, out, t, vel, p)
 *   ctx = AudioContext, out = destination node, t = start time (sec),
 *   vel = velocity 0..1, p = parameter object from the kit preset.
 * ========================================================================== */

DM.synth = (function () {
  'use strict';

  const U = DM.util;

  // One reusable white-noise buffer per context (2s, mono).
  const noiseCache = new WeakMap();
  function noiseBuffer(ctx) {
    if (noiseCache.has(ctx)) return noiseCache.get(ctx);
    const len = ctx.sampleRate * 2;
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const ch = buf.getChannelData(0);
    for (let i = 0; i < len; i++) ch[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, buf);
    return buf;
  }

  function noiseSource(ctx, t) {
    const src = ctx.createBufferSource();
    src.buffer = noiseBuffer(ctx);
    src.loop = true;
    // random start offset so repeated hits don't sound identical
    src.start(t, U.rand(0, 1));
    return src;
  }

  /** Percussive amplitude envelope on a gain param. */
  function perc(param, t, peak, attack, decay) {
    param.cancelScheduledValues(t);
    param.setValueAtTime(0.0001, t);
    param.linearRampToValueAtTime(peak, t + attack);
    param.exponentialRampToValueAtTime(0.0001, t + attack + decay);
  }

  /** A voice handle understood by the audio engine. */
  function voice(vca, sources, endTime) {
    sources.forEach((s) => {
      try { if (s.stop) s.stop(endTime + 0.05); } catch (e) { /* already stopped */ }
    });
    return {
      vca,
      endTime,
      stop(at) {
        // fast fade to avoid clicks, then silence — used for choking
        const g = vca.gain;
        try {
          g.cancelScheduledValues(at);
          g.setValueAtTime(Math.max(0.0001, g.value), at);
          g.exponentialRampToValueAtTime(0.0001, at + 0.012);
        } catch (e) { /* noop */ }
        sources.forEach((s) => { try { s.stop(at + 0.02); } catch (e) {} });
      },
    };
  }

  /* --------------------------------------------------------------------- *
   * KICK — pitched sine with a fast downward pitch sweep + click transient
   * --------------------------------------------------------------------- */
  function kick(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.connect(out);

    const osc = ctx.createOscillator();
    osc.type = p.wave || 'sine';
    const f0 = (p.pitchStart || 130) * (1 + U.randSym(0.01));
    const f1 = p.pitchEnd || 50;
    osc.frequency.setValueAtTime(f0, t);
    osc.frequency.exponentialRampToValueAtTime(f1, t + (p.pitchDecay || 0.06));

    // Optional drive for punch (808 / rock).
    let node = osc;
    if (p.drive) {
      const shaper = ctx.createWaveShaper();
      shaper.curve = driveCurve(p.drive);
      osc.connect(shaper);
      node = shaper;
    }
    node.connect(vca);

    const decay = p.decay || 0.4;
    perc(vca.gain, t, vel * (p.gain || 1), 0.002, decay);
    osc.start(t); osc.stop(t + decay + 0.05);

    const sources = [osc];

    // Click/beater transient (high-passed noise blip) for attack definition.
    if (p.click) {
      const n = noiseSource(ctx, t);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass';
      hp.frequency.value = 1500;
      const ng = ctx.createGain();
      n.connect(hp); hp.connect(ng); ng.connect(vca);
      perc(ng.gain, t, vel * p.click, 0.0005, 0.02);
      sources.push(n);
    }

    return voice(vca, sources, t + decay);
  }

  /* --------------------------------------------------------------------- *
   * SNARE — tonal shell (two oscillators) + noise "wires"
   * --------------------------------------------------------------------- */
  function snare(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.connect(out);

    const tone = ctx.createGain();
    tone.gain.value = p.toneMix == null ? 0.5 : p.toneMix;
    tone.connect(vca);

    const f0 = (p.pitch || 180) * (1 + U.randSym(0.01));
    [1, 1.6].forEach((mult, i) => {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = f0 * mult;
      const og = ctx.createGain();
      og.gain.value = i === 0 ? 1 : 0.6;
      o.connect(og); og.connect(tone);
      o.start(t); o.stop(t + (p.toneDecay || 0.12) + 0.05);
      perc(og.gain, t, og.gain.value, 0.001, p.toneDecay || 0.12);
    });

    // Noise body (the rattle of the snare wires).
    const n = noiseSource(ctx, t);
    const bp = ctx.createBiquadFilter();
    bp.type = 'highpass';
    bp.frequency.value = (p.noiseHp || 1500) * (0.7 + 0.3 * vel);
    const lp = ctx.createBiquadFilter();
    lp.type = 'lowpass';
    lp.frequency.value = p.noiseLp || 9000;
    const ng = ctx.createGain();
    ng.gain.value = p.noiseMix == null ? 0.7 : p.noiseMix;
    n.connect(bp); bp.connect(lp); lp.connect(ng); ng.connect(vca);

    const decay = p.decay || 0.2;
    perc(ng.gain, t, ng.gain.value, 0.001, decay);
    vca.gain.value = vel * (p.gain || 1);

    return voice(vca, [n], t + decay);
  }

  /* --------------------------------------------------------------------- *
   * CLAP — several short noise bursts (the classic 4-tap) + body
   * --------------------------------------------------------------------- */
  function clap(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = p.freq || 1200;
    bp.Q.value = p.q || 1.2;
    bp.connect(vca);

    const n = noiseSource(ctx, t);
    const ng = ctx.createGain();
    ng.gain.value = 0;
    n.connect(ng); ng.connect(bp);

    const taps = [0, 0.01, 0.02, 0.03];
    taps.forEach((dt, i) => {
      const last = i === taps.length - 1;
      perc(ng.gain, t + dt, 1, 0.001, last ? (p.decay || 0.15) : 0.01);
    });

    return voice(vca, [n], t + (p.decay || 0.15));
  }

  /* --------------------------------------------------------------------- *
   * TOM — pitched sine/triangle with mild pitch drop + stick noise
   * --------------------------------------------------------------------- */
  function tom(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);

    const osc = ctx.createOscillator();
    osc.type = p.wave || 'sine';
    const f0 = (p.pitch || 150) * (1 + U.randSym(0.01));
    osc.frequency.setValueAtTime(f0 * 1.3, t);
    osc.frequency.exponentialRampToValueAtTime(f0, t + 0.08);
    const og = ctx.createGain();
    osc.connect(og); og.connect(vca);
    const decay = p.decay || 0.4;
    perc(og.gain, t, 1, 0.002, decay);

    const sources = [osc];
    if (p.noise) {
      const n = noiseSource(ctx, t);
      const hp = ctx.createBiquadFilter();
      hp.type = 'highpass'; hp.frequency.value = 2000;
      const ng = ctx.createGain();
      n.connect(hp); hp.connect(ng); ng.connect(vca);
      perc(ng.gain, t, p.noise, 0.0005, 0.03);
      sources.push(n);
    }
    osc.start(t); osc.stop(t + decay + 0.05);
    return voice(vca, sources, t + decay);
  }

  /* --------------------------------------------------------------------- *
   * HI-HAT — inharmonic square-oscillator bank + air noise.
   * p.decay sets closed (~0.05) / half (~0.2) / open (~0.45).
   * --------------------------------------------------------------------- */
  function hihat(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);

    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const base = p.freq || 40;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = p.bp || 10000;
    bp.Q.value = 0.7;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = (p.hp || 7000) * (0.85 + 0.15 * vel); // harder = brighter
    bp.connect(hp); hp.connect(vca);

    const metal = ctx.createGain();
    metal.gain.value = 0.9;
    metal.connect(bp);
    const oscs = ratios.map((r) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r;
      o.connect(metal);
      o.start(t); o.stop(t + (p.decay || 0.05) + 0.08);
      return o;
    });

    // air / sizzle
    const n = noiseSource(ctx, t);
    const nhp = ctx.createBiquadFilter();
    nhp.type = 'highpass'; nhp.frequency.value = 8000;
    const ng = ctx.createGain(); ng.gain.value = p.air == null ? 0.3 : p.air;
    n.connect(nhp); nhp.connect(ng); ng.connect(vca);

    const decay = p.decay || 0.05;
    perc(vca.gain, t, vel * (p.gain || 1), 0.001, decay);

    return voice(vca, oscs.concat([n]), t + decay);
  }

  /* --------------------------------------------------------------------- *
   * CYMBAL — crash / ride. Inharmonic bank + broadband noise wash.
   * Ride adds a tonal "ping". Controlled via params.
   * --------------------------------------------------------------------- */
  function cymbal(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);

    const ratios = [2, 3, 4.16, 5.43, 6.79, 8.21];
    const base = p.freq || 50;

    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = p.bp || 8000;
    bp.Q.value = 0.5;
    const hp = ctx.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = p.hp || 5000;
    bp.connect(hp); hp.connect(vca);

    const metal = ctx.createGain(); metal.gain.value = 0.6; metal.connect(bp);
    const oscs = ratios.map((r) => {
      const o = ctx.createOscillator();
      o.type = 'square';
      o.frequency.value = base * r;
      o.connect(metal);
      o.start(t); o.stop(t + (p.decay || 1.5) + 0.1);
      return o;
    });

    // broadband shimmer
    const n = noiseSource(ctx, t);
    const nbp = ctx.createBiquadFilter();
    nbp.type = 'bandpass'; nbp.frequency.value = 9000; nbp.Q.value = 0.4;
    const ng = ctx.createGain(); ng.gain.value = p.noiseMix == null ? 0.5 : p.noiseMix;
    n.connect(nbp); nbp.connect(ng); ng.connect(vca);

    const decay = p.decay || 1.5;
    perc(vca.gain, t, vel * (p.gain || 1), 0.002, decay);
    perc(ng.gain, t, ng.gain.value, 0.002, decay * 0.8);

    const sources = oscs.concat([n]);

    // Ride "ping": a short, defined tonal hit on top.
    if (p.ping) {
      const o = ctx.createOscillator();
      o.type = 'triangle';
      o.frequency.value = p.pingFreq || 800;
      const og = ctx.createGain(); og.gain.value = 0;
      o.connect(og); og.connect(vca);
      perc(og.gain, t, p.ping * vel, 0.001, 0.15);
      o.start(t); o.stop(t + 0.25);
      sources.push(o);
    }

    return voice(vca, sources, t + decay);
  }

  /* --------------------------------------------------------------------- *
   * RIM / CROSS-STICK — short click + tiny tone
   * --------------------------------------------------------------------- */
  function rim(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);
    const o = ctx.createOscillator();
    o.type = 'triangle';
    o.frequency.value = p.pitch || 400;
    const og = ctx.createGain();
    o.connect(og); og.connect(vca);
    perc(og.gain, t, 1, 0.0005, p.decay || 0.05);
    o.start(t); o.stop(t + (p.decay || 0.05) + 0.05);
    return voice(vca, [o], t + (p.decay || 0.05));
  }

  /* --------------------------------------------------------------------- *
   * COWBELL — two detuned squares through a bandpass
   * --------------------------------------------------------------------- */
  function cowbell(ctx, out, t, vel, p) {
    const vca = ctx.createGain();
    vca.gain.value = vel * (p.gain || 1);
    vca.connect(out);
    const bp = ctx.createBiquadFilter();
    bp.type = 'bandpass'; bp.frequency.value = p.freq || 560; bp.Q.value = 2;
    bp.connect(vca);
    const oscs = [p.f1 || 540, p.f2 || 800].map((f) => {
      const o = ctx.createOscillator();
      o.type = 'square'; o.frequency.value = f;
      o.connect(bp); o.start(t); o.stop(t + (p.decay || 0.3) + 0.05);
      return o;
    });
    perc(vca.gain, t, vel * (p.gain || 1), 0.001, p.decay || 0.3);
    return voice(vca, oscs, t + (p.decay || 0.3));
  }

  /* --- waveshaper drive curve ------------------------------------------- */
  function driveCurve(amount) {
    const k = amount * 50;
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = ((1 + k) * x) / (1 + k * Math.abs(x));
    }
    return curve;
  }

  const synths = { kick, snare, clap, tom, hihat, cymbal, rim, cowbell };

  /** Dispatch by synth name. */
  function play(name, ctx, out, t, vel, params) {
    const fn = synths[name];
    if (!fn) throw new Error('Unknown synth: ' + name);
    return fn(ctx, out, t, vel, params || {});
  }

  return { play, synths, noiseBuffer };
})();
