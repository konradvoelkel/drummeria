/* =============================================================================
 * recorder.js — capture the live performance and export 16-bit WAV
 * -----------------------------------------------------------------------------
 * Taps the audio engine's post-master "tap" node into a ScriptProcessorNode and
 * accumulates stereo float chunks, then encodes a standard PCM WAV (no library).
 * ScriptProcessorNode is deprecated but universally supported and the simplest
 * reliable way to grab raw samples for WAV export.
 * ========================================================================== */

DM.recorder = (function () {
  'use strict';

  const state = {
    node: null, zero: null,
    left: [], right: [], length: 0,
    recording: false, startTime: 0,
  };

  function start() {
    const eng = DM.AudioEngine;
    eng.ensure();
    const ctx = eng.state.ctx;
    const tap = eng.state.tap;
    if (state.recording) return;

    const bufferSize = 4096;
    const node = ctx.createScriptProcessor(bufferSize, 2, 2);
    state.left = []; state.right = []; state.length = 0;

    node.onaudioprocess = (e) => {
      const l = e.inputBuffer.getChannelData(0);
      const r = e.inputBuffer.numberOfChannels > 1 ? e.inputBuffer.getChannelData(1) : l;
      state.left.push(new Float32Array(l));
      state.right.push(new Float32Array(r));
      state.length += l.length;
    };

    // tap -> processor -> (silent) -> destination, so the node actually runs
    // without doubling the audible signal.
    const zero = ctx.createGain();
    zero.gain.value = 0;
    tap.connect(node);
    node.connect(zero);
    zero.connect(ctx.destination);

    state.node = node; state.zero = zero;
    state.recording = true;
    state.startTime = ctx.currentTime;
  }

  function stop() {
    if (!state.recording) return null;
    const ctx = DM.AudioEngine.state.ctx;
    const tap = DM.AudioEngine.state.tap;

    try { tap.disconnect(state.node); } catch (e) {}
    try { state.node.disconnect(); } catch (e) {}
    try { state.zero.disconnect(); } catch (e) {}
    state.node.onaudioprocess = null;
    state.recording = false;

    const left = flatten(state.left, state.length);
    const right = flatten(state.right, state.length);
    const blob = encodeWav([left, right], ctx.sampleRate);
    const duration = state.length / ctx.sampleRate;
    state.left = []; state.right = [];
    return { blob, url: URL.createObjectURL(blob), duration };
  }

  function flatten(chunks, total) {
    const out = new Float32Array(total);
    let off = 0;
    for (const c of chunks) { out.set(c, off); off += c.length; }
    return out;
  }

  /** Encode interleaved 16-bit PCM WAV from channel float arrays. */
  function encodeWav(channels, sampleRate) {
    const numCh = channels.length;
    const len = channels[0].length;
    const bytesPerSample = 2;
    const blockAlign = numCh * bytesPerSample;
    const dataSize = len * blockAlign;
    const buffer = new ArrayBuffer(44 + dataSize);
    const view = new DataView(buffer);

    const writeStr = (off, s) => { for (let i = 0; i < s.length; i++) view.setUint8(off + i, s.charCodeAt(i)); };

    writeStr(0, 'RIFF');
    view.setUint32(4, 36 + dataSize, true);
    writeStr(8, 'WAVE');
    writeStr(12, 'fmt ');
    view.setUint32(16, 16, true);          // PCM chunk size
    view.setUint16(20, 1, true);           // PCM format
    view.setUint16(22, numCh, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * blockAlign, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);          // bits per sample
    writeStr(36, 'data');
    view.setUint32(40, dataSize, true);

    let off = 44;
    for (let i = 0; i < len; i++) {
      for (let ch = 0; ch < numCh; ch++) {
        let s = Math.max(-1, Math.min(1, channels[ch][i]));
        s = s < 0 ? s * 0x8000 : s * 0x7fff;
        view.setInt16(off, s, true);
        off += 2;
      }
    }
    return new Blob([view], { type: 'audio/wav' });
  }

  return {
    start, stop, encodeWav,
    get recording() { return state.recording; },
  };
})();
