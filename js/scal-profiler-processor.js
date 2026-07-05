/* =============================================================================
 * scal-profiler-processor.js — AudioWorklet side of the SCAL profiler
 * -----------------------------------------------------------------------------
 * Measures the render-domain observation latency of events crossing
 * main-thread -> SAB -> worklet, expressed in audio FRAMES (no wall clock, no
 * getOutputTimestamp: both ends share the render clock, so the measurement is
 * bridge-noise-free).
 *
 * For each ping (seq, intendedFrame) it records the block frame (currentFrame)
 * at which the worklet OBSERVED it. latency = observedFrame - intendedFrame
 * captures  σ_handoff ⊕ ε_phase  directly.
 *
 * Also reports per-block exec time (headroom proxy) when a high-res timer is
 * available in the worklet scope (feature-detected; not guaranteed).
 * ========================================================================== */

class ScalProfilerProcessor extends AudioWorkletProcessor {
  constructor({ processorOptions: o }) {
    super();
    this.pc = new Int32Array(o.pingCtrl);   // [write, read]
    this.pd = new Float64Array(o.pingData); // [seq, intendedFrame] * CAP
    this.rc = new Int32Array(o.resCtrl);    // [write, read]
    this.rd = new Float64Array(o.resData);  // [seq, observedFrame, execMs] * CAP
    this.CAP = o.cap;
    this.hasPerf = (typeof performance !== 'undefined' && typeof performance.now === 'function');
    this.blocks = 0;
  }

  process() {
    const t0 = this.hasPerf ? performance.now() : 0;
    this.blocks++;
    const observed = currentFrame; // global: first frame of this render quantum

    const w = Atomics.load(this.pc, 0);
    let r = Atomics.load(this.pc, 1);
    while (r !== w) {
      const i = (r % this.CAP) * 2;
      const seq = this.pd[i];
      const intended = this.pd[i + 1];

      const rw = Atomics.load(this.rc, 0);
      const j = (rw % this.CAP) * 3;
      this.rd[j] = seq;
      this.rd[j + 1] = observed;
      this.rd[j + 2] = this.hasPerf ? (performance.now() - t0) : -1;
      Atomics.store(this.rc, 0, rw + 1);
      r++;
    }
    Atomics.store(this.pc, 1, r);
    return true; // keep alive
  }
}

registerProcessor('scal-profiler', ScalProfilerProcessor);
