/* =============================================================================
 * scal-profiler.js — SCAL Profiler Suite (v2)
 * -----------------------------------------------------------------------------
 * v1 lesson: measuring everything in the render-frame domain gave a resolution
 * of exactly ONE render quantum (ctx.currentTime steps per quantum and co-moves
 * with the worklet's currentFrame), so jitter collapsed to {0, 1 quantum} and
 * P_cb read as 0. P_cb and sub-quantum jitter live in the WALL clock — so v2
 * brings the wall clock back, with the right instruments:
 *
 *   1) P_cb / B_dev      -> getOutputTimestamp() step cadence (wall clock)
 *   2) σ_handoff         -> MessageChannel task-queue jitter, idle vs load
 *   3) render pickup      -> SAB worklet round-trip (bounded ≤ N quanta), optional
 *
 * The invariant we can prove HERE: σ_handoff (main-thread scheduling jitter)
 * explodes under main-thread load — and that is exactly the jitter the worklet
 * live path does NOT sit on. P_cb (audio callback cadence) is driven by the
 * audio thread and is independent of it.
 *
 * Still NOT measured (needs a physical/loopback rig): ε_in, true round-trip.
 * ========================================================================== */

DM.profiler = (function () {
  'use strict';

  const MODULE_URL = 'js/scal-profiler-processor.js';

  /* --- stats ------------------------------------------------------------ */
  function pctile(s, p) {
    if (!s.length) return NaN;
    return s[Math.min(s.length - 1, Math.max(0, Math.round((p / 100) * (s.length - 1))))];
  }
  function stats(arr) {
    const s = arr.slice().sort((a, b) => a - b);
    const mean = s.reduce((a, b) => a + b, 0) / (s.length || 1);
    return {
      n: s.length, min: s[0], mean, p50: pctile(s, 50), p90: pctile(s, 90),
      p99: pctile(s, 99), max: s[s.length - 1], jitter: pctile(s, 99) - pctile(s, 50),
    };
  }
  const r1 = (x) => Math.round(x * 10) / 10;
  const r2 = (x) => Math.round(x * 100) / 100;

  /* --- synthetic main-thread load --------------------------------------- */
  function startLoad() {
    const id = setInterval(() => {
      const end = performance.now() + 12;
      let x = 0; while (performance.now() < end) x += Math.sqrt(x + 1);
      if (typeof document !== 'undefined' && document.body) {
        document.body.style.zoom = (x % 2) ? '1.0001' : '1';
        void document.body.offsetHeight; // force synchronous layout
      }
    }, 16);
    return () => clearInterval(id);
  }

  /* --- 1) callback period via getOutputTimestamp step cadence ----------- */
  function measureCadence(ctx, ms) {
    if (!ctx.getOutputTimestamp) return { ok: false, reason: 'getOutputTimestamp unavailable (e.g. Safari)' };
    const SR = ctx.sampleRate;
    const steps = []; // {perf, ctxTime} at each contextTime change
    const end = performance.now() + ms;
    let last = -1;
    while (performance.now() < end) {
      const ts = ctx.getOutputTimestamp();
      const ct = ts && ts.contextTime;
      if (ct != null && ct !== last) {
        steps.push({ perf: (ts.performanceTime != null ? ts.performanceTime : performance.now()), ct });
        last = ct;
      }
    }
    if (steps.length < 6) return { ok: false, reason: 'too few timestamp updates' };
    const perfDeltas = [], frameJumps = [];
    // Skip the first 2 steps (performanceTime can be 0/null on the very first
    // reads) and clamp to plausible deltas, so one warm-up outlier doesn't blow
    // up the spread. The median is robust either way.
    for (let i = 2; i < steps.length; i++) {
      const d = steps[i].perf - steps[i - 1].perf;
      const f = (steps[i].ct - steps[i - 1].ct) * SR;
      if (d > 0 && d < 100) { perfDeltas.push(d); frameJumps.push(f); }
    }
    if (perfDeltas.length < 4) return { ok: false, reason: 'too few clean timestamp deltas' };
    const pd = stats(perfDeltas), fj = stats(frameJumps);
    // If contextTime advances ~continuously, the API is interpolating -> P_cb
    // is not resolvable this way; flag it instead of reporting a fake number.
    const interpolated = fj.p50 > 0 && fj.p50 < 64; // sub-half-quantum jumps
    return {
      ok: !interpolated, interpolated,
      P_cb_ms: r2(pd.p50), P_cb_jitter_ms: r2(pd.jitter),
      B_dev_frames: Math.round(fj.p50), updates: steps.length,
      reason: interpolated ? 'getOutputTimestamp appears interpolated (continuous), not stepped' : null,
    };
  }

  /* --- 2) main-thread handoff jitter via a sustained macro-task chain ----
   * MessageChannel turned out near-synchronous (microtask-fast) and finished
   * before the load interval could overlap. A self-rescheduling setTimeout(0)
   * chain is a real MACRO-task — exactly where a Web MIDI handler is dispatched
   * — so a busy main thread visibly delays it. We measure inter-fire intervals
   * over a window long enough to span many load bursts. The clamp (~4 ms) is the
   * baseline; the SIGNAL is how far the spread/max grows under load.            */
  function measureCallbackJitter(ms) {
    return new Promise((resolve) => {
      const deltas = [];
      let last = performance.now();
      const end = last + ms;
      (function tick() {
        const now = performance.now();
        deltas.push(now - last); last = now;
        if (now < end) setTimeout(tick, 0);
        else resolve(deltas.slice(2)); // drop warm-up
      })();
    });
  }

  /* --- 3) render-thread pickup via SAB worklet (optional) --------------- */
  async function workletPickup(ctx, pings) {
    if (typeof SharedArrayBuffer === 'undefined' || !self.crossOriginIsolated) {
      return { ok: false, reason: 'no cross-origin isolation (COOP/COEP) — SAB unavailable' };
    }
    await ctx.audioWorklet.addModule(MODULE_URL);
    const cap = 1 << Math.ceil(Math.log2(Math.max(1024, pings + 64)));
    const pingCtrl = new SharedArrayBuffer(8), pingData = new SharedArrayBuffer(cap * 2 * 8);
    const resCtrl = new SharedArrayBuffer(8), resData = new SharedArrayBuffer(cap * 3 * 8);
    const pc = new Int32Array(pingCtrl), pd = new Float64Array(pingData);
    const rc = new Int32Array(resCtrl), rd = new Float64Array(resData);
    const node = new AudioWorkletNode(ctx, 'scal-profiler', {
      numberOfInputs: 0, numberOfOutputs: 1, outputChannelCount: [1],
      processorOptions: { cap, pingCtrl, pingData, resCtrl, resData },
    });
    const sink = ctx.createGain(); sink.gain.value = 0;
    node.connect(sink); sink.connect(ctx.destination);

    const SR = ctx.sampleRate, intended = new Float64Array(pings);
    const delay = (m) => new Promise((r) => setTimeout(r, m));
    for (let seq = 0; seq < pings; seq++) {
      await delay(Math.random() * 4);
      const f = ctx.currentTime * SR; intended[seq] = f;
      const w = Atomics.load(pc, 0); const i = (w % cap) * 2;
      pd[i] = seq; pd[i + 1] = f; Atomics.store(pc, 0, w + 1);
    }
    await delay(250);
    const quanta = [];
    const w = Atomics.load(rc, 0); let r = Atomics.load(rc, 1);
    while (r !== w) {
      const j = (r % cap) * 3; const seq = rd[j] | 0, observed = rd[j + 1];
      if (seq >= 0 && seq < pings) quanta.push((observed - intended[seq]) / 128);
      r++;
    }
    try { node.disconnect(); sink.disconnect(); } catch (e) {}
    const st = stats(quanta.map((q) => Math.max(0, q)));
    return { ok: true, pickupMaxQuanta: Math.round(st.max), pickupP99Quanta: Math.round(st.p99), n: st.n };
  }

  /* --- orchestration ---------------------------------------------------- */
  async function run(opts) {
    opts = opts || {};
    const ctx = DM.AudioEngine.ensure();
    await DM.AudioEngine.resume();
    const SR = ctx.sampleRate, Q = 128;

    const cadence = measureCadence(ctx, 250);
    const winMs = opts.handoffMs || 600;
    const handoffIdle = stats(await measureCallbackJitter(winMs));

    // Side-by-side under the SAME synthetic load: main-thread macro-task jitter
    // (the input-handler hazard) vs render-thread pickup (downstream, shielded).
    let pickup = { ok: false, reason: 'skipped' }, pickupLoad = { ok: false, reason: 'skipped' };
    if (opts.worklet !== false) {
      try { pickup = await workletPickup(ctx, opts.pings || 500); }
      catch (e) { pickup = { ok: false, reason: String(e.message || e) }; }
    }
    const stop = startLoad();
    const handoffLoad = stats(await measureCallbackJitter(winMs));
    if (pickup.ok) {
      try { pickupLoad = await workletPickup(ctx, opts.pings || 500); }
      catch (e) { pickupLoad = { ok: false, reason: String(e.message || e) }; }
    }
    stop();

    const P_cb_ms = cadence.ok ? cadence.P_cb_ms : null;
    const compFrames = P_cb_ms ? Math.ceil((P_cb_ms / 1000) * SR / Q) * Q : Q;

    const report = {
      env: {
        sampleRate: SR, renderQuantum: Q, blockBudgetMs: r2(Q / SR * 1000),
        baseLatencyMs: r1((ctx.baseLatency || 0) * 1000),
        outputLatencyMs: r1((ctx.outputLatency || 0) * 1000),
        crossOriginIsolated: !!self.crossOriginIsolated,
      },
      cadence, handoffIdle, handoffLoad, pickup, pickupLoad,
      derived: {
        P_cb_ms, B_dev_frames: cadence.ok ? cadence.B_dev_frames : null,
        recommendedCompFrames: compFrames, recommendedCompMs: r2(compFrames / SR * 1000),
        handoffBlowupX: handoffIdle.jitter > 0.05 ? r2(handoffLoad.jitter / handoffIdle.jitter) : null,
        pickupStableUnderLoad: (pickup.ok && pickupLoad.ok)
          ? (pickupLoad.pickupMaxQuanta <= pickup.pickupMaxQuanta + 1) : null,
      },
    };
    if (opts.print !== false) console.log(format(report));
    return report;
  }

  function format(r) {
    const H = (s) => `p50 ${r2(s.p50)} · p99 ${r2(s.p99)} · max ${r2(s.max)} · jitter ${r2(s.jitter)} ms`;
    const cad = r.cadence.ok
      ? `P_cb ≈ ${r.cadence.P_cb_ms} ms (±${r.cadence.P_cb_jitter_ms}) ⇒ device buffer ≈ ${r.cadence.B_dev_frames} frames`
      : `P_cb: unresolved — ${r.cadence.reason}`;
    const blow = r.derived.handoffBlowupX;
    const handoffVerdict = blow == null
      ? 'inconclusive (idle jitter below measurement floor)'
      : blow >= 3 ? `main-thread macro-task jitter ×${blow} under load`
      : `×${blow} (load too light to expose it — raise handoffMs / load)`;
    const pk = (s) => s.ok ? `≤ ${s.pickupMaxQuanta} quanta (p99 ${s.pickupP99Quanta})` : `skipped — ${s.reason}`;
    const shield = r.derived.pickupStableUnderLoad == null ? 'n/a'
      : r.derived.pickupStableUnderLoad ? '✓ render pickup unchanged under the same load' : '✗ render pickup grew under load (unexpected)';
    return [
      '── SCAL Profiler v3 ────────────────────────────────────────',
      `env: ${r.env.sampleRate} Hz · quantum ${r.env.renderQuantum} (${r.env.blockBudgetMs} ms budget)`,
      `     baseLatency ${r.env.baseLatencyMs} ms · outputLatency ${r.env.outputLatencyMs} ms ← floor (BT? test wired)`,
      '',
      `[1] callback cadence:  ${cad}`,
      `[2] σ_handoff idle:    ${H(r.handoffIdle)}`,
      `    σ_handoff load:    ${H(r.handoffLoad)}   (${handoffVerdict})`,
      `[3] render pickup idle: ${pk(r.pickup)}`,
      `    render pickup load: ${pk(r.pickupLoad)}   ${shield}`,
      '',
      `recommended COMP (grid-stable scheduled path) ≥ ${r.derived.recommendedCompFrames} frames (${r.derived.recommendedCompMs} ms)`,
      '─────────────────────────────────────────────────────────────',
      'INVARIANT (honest): the worklet shields DOWNSTREAM (DSP + scheduled/loop) from main-thread jitter',
      '(see render pickup load). But onmidimessage is MAIN-THREAD, so σ_handoff DOES hit LIVE input —',
      'the only live defense is keeping the main thread idle during play.',
      'trust: outputLatency, P_cb, pickup. Not measured: ε_in, true round-trip (need loopback).',
    ].join('\n');
  }

  return { run, format };
})();
