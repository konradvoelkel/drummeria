/* =============================================================================
 * kits.js — built-in synthesised kit presets
 * -----------------------------------------------------------------------------
 * Each kit maps an internal "slot" id to a synth definition:
 *   { synth: <name in DM.synth>, params: {...}, choke: <group?> }
 *
 * Slots are the canonical instruments the MIDI mapping resolves notes to:
 *   kick, snare, rim, clap,
 *   hihat_closed, hihat_pedal, hihat_open,
 *   tom_low, tom_mid, tom_high,
 *   crash, ride, cowbell
 *
 * `choke` groups model mutual silencing — all three hi-hats share "hihat",
 * so a closed hit chokes a ringing open hat (real hi-hat behaviour).
 * `tune` is an optional kit-wide pitch offset in semitones.
 * ========================================================================== */

DM.kits = (function () {
  'use strict';

  // Helper to give every hi-hat slot the shared choke group.
  const HH = 'hihat';

  const acoustic = {
    id: 'acoustic', name: 'Acoustic Kit', category: 'acoustic', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { pitchStart: 140, pitchEnd: 52, pitchDecay: 0.05, decay: 0.45, click: 0.4, gain: 1.0 } },
      snare:       { synth: 'snare',  params: { pitch: 190, toneDecay: 0.13, decay: 0.22, noiseMix: 0.8, toneMix: 0.5, noiseHp: 1600, gain: 0.95 } },
      rim:         { synth: 'rim',    params: { pitch: 420, decay: 0.05, gain: 0.7 } },
      clap:        { synth: 'clap',   params: { freq: 1200, decay: 0.15, gain: 0.7 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 40, hp: 8000, bp: 11000, decay: 0.05, air: 0.3, gain: 0.6 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 40, hp: 8000, bp: 11000, decay: 0.04, air: 0.2, gain: 0.5 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 40, hp: 7000, bp: 10000, decay: 0.45, air: 0.4, gain: 0.6 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { pitch: 110, decay: 0.5, noise: 0.2, gain: 0.9 } },
      tom_mid:     { synth: 'tom',    params: { pitch: 150, decay: 0.45, noise: 0.2, gain: 0.9 } },
      tom_high:    { synth: 'tom',    params: { pitch: 200, decay: 0.4, noise: 0.2, gain: 0.9 } },
      crash:       { synth: 'cymbal', params: { freq: 50, hp: 5000, bp: 8000, decay: 1.6, noiseMix: 0.6, gain: 0.7 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 60, hp: 6000, bp: 9000, decay: 1.0, noiseMix: 0.25, ping: 0.6, pingFreq: 900, gain: 0.6 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.3, gain: 0.6 } },
    },
  };

  const rock = {
    id: 'rock', name: 'Rock Kit', category: 'acoustic', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { pitchStart: 150, pitchEnd: 48, pitchDecay: 0.05, decay: 0.5, click: 0.6, drive: 0.4, gain: 1.1 } },
      snare:       { synth: 'snare',  params: { pitch: 200, toneDecay: 0.14, decay: 0.28, noiseMix: 0.9, toneMix: 0.55, noiseHp: 1500, gain: 1.05 } },
      rim:         { synth: 'rim',    params: { pitch: 440, decay: 0.05, gain: 0.75 } },
      clap:        { synth: 'clap',   params: { freq: 1300, decay: 0.16, gain: 0.75 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 42, hp: 8500, bp: 11000, decay: 0.06, air: 0.3, gain: 0.62 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 42, hp: 8500, bp: 11000, decay: 0.05, air: 0.2, gain: 0.5 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 40, hp: 7000, bp: 10000, decay: 0.5, air: 0.45, gain: 0.62 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { pitch: 100, decay: 0.6, noise: 0.25, gain: 1.0 } },
      tom_mid:     { synth: 'tom',    params: { pitch: 145, decay: 0.55, noise: 0.25, gain: 1.0 } },
      tom_high:    { synth: 'tom',    params: { pitch: 195, decay: 0.45, noise: 0.25, gain: 1.0 } },
      crash:       { synth: 'cymbal', params: { freq: 48, hp: 4500, bp: 8000, decay: 2.0, noiseMix: 0.7, gain: 0.72 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 60, hp: 6000, bp: 9000, decay: 1.2, noiseMix: 0.3, ping: 0.55, pingFreq: 880, gain: 0.6 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.3, gain: 0.65 } },
    },
  };

  const jazz = {
    id: 'jazz', name: 'Jazz Kit', category: 'acoustic', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { pitchStart: 120, pitchEnd: 55, pitchDecay: 0.04, decay: 0.35, click: 0.2, gain: 0.85 } },
      snare:       { synth: 'snare',  params: { pitch: 210, toneDecay: 0.1, decay: 0.18, noiseMix: 0.7, toneMix: 0.45, noiseHp: 1800, gain: 0.85 } },
      rim:         { synth: 'rim',    params: { pitch: 400, decay: 0.05, gain: 0.7 } },
      clap:        { synth: 'clap',   params: { freq: 1200, decay: 0.13, gain: 0.6 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 40, hp: 9000, bp: 11500, decay: 0.045, air: 0.35, gain: 0.55 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 40, hp: 9000, bp: 11500, decay: 0.04, air: 0.25, gain: 0.45 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 38, hp: 7500, bp: 10500, decay: 0.4, air: 0.45, gain: 0.55 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { pitch: 115, decay: 0.45, noise: 0.15, gain: 0.85 } },
      tom_mid:     { synth: 'tom',    params: { pitch: 160, decay: 0.4, noise: 0.15, gain: 0.85 } },
      tom_high:    { synth: 'tom',    params: { pitch: 215, decay: 0.35, noise: 0.15, gain: 0.85 } },
      crash:       { synth: 'cymbal', params: { freq: 52, hp: 5500, bp: 8500, decay: 1.4, noiseMix: 0.5, gain: 0.6 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 62, hp: 6500, bp: 9500, decay: 1.2, noiseMix: 0.2, ping: 0.9, pingFreq: 1000, gain: 0.65 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.28, gain: 0.55 } },
    },
  };

  const electronic_808 = {
    id: 'electronic_808', name: 'Electronic 808', category: 'electronic', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { wave: 'sine', pitchStart: 120, pitchEnd: 40, pitchDecay: 0.08, decay: 0.9, drive: 0.3, click: 0.2, gain: 1.1 } },
      snare:       { synth: 'snare',  params: { pitch: 180, toneDecay: 0.1, decay: 0.18, noiseMix: 0.7, toneMix: 0.4, noiseHp: 1400, gain: 0.9 } },
      rim:         { synth: 'rim',    params: { pitch: 450, decay: 0.04, gain: 0.7 } },
      clap:        { synth: 'clap',   params: { freq: 1100, decay: 0.2, q: 1.0, gain: 0.85 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 40, hp: 9000, bp: 12000, decay: 0.05, air: 0.2, gain: 0.5 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 40, hp: 9000, bp: 12000, decay: 0.04, air: 0.15, gain: 0.45 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 40, hp: 8000, bp: 11000, decay: 0.5, air: 0.25, gain: 0.5 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { wave: 'sine', pitch: 120, decay: 0.45, noise: 0, gain: 0.9 } },
      tom_mid:     { synth: 'tom',    params: { wave: 'sine', pitch: 160, decay: 0.4, noise: 0, gain: 0.9 } },
      tom_high:    { synth: 'tom',    params: { wave: 'sine', pitch: 200, decay: 0.35, noise: 0, gain: 0.9 } },
      crash:       { synth: 'cymbal', params: { freq: 50, hp: 6000, bp: 9000, decay: 1.2, noiseMix: 0.4, gain: 0.6 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 60, hp: 6500, bp: 9500, decay: 0.9, noiseMix: 0.2, ping: 0.5, pingFreq: 850, gain: 0.55 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.4, gain: 0.7 } },
    },
  };

  const vintage_linn = {
    id: 'vintage_linn', name: 'Vintage Linn', category: 'vintage', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { pitchStart: 110, pitchEnd: 50, pitchDecay: 0.05, decay: 0.35, click: 0.5, gain: 1.0 } },
      snare:       { synth: 'snare',  params: { pitch: 200, toneDecay: 0.08, decay: 0.16, noiseMix: 0.85, toneMix: 0.4, noiseHp: 1700, gain: 1.0 } },
      rim:         { synth: 'rim',    params: { pitch: 460, decay: 0.04, gain: 0.75 } },
      clap:        { synth: 'clap',   params: { freq: 1250, decay: 0.14, gain: 0.8 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 44, hp: 9000, bp: 11500, decay: 0.045, air: 0.2, gain: 0.55 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 44, hp: 9000, bp: 11500, decay: 0.04, air: 0.15, gain: 0.45 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 42, hp: 8000, bp: 10500, decay: 0.35, air: 0.25, gain: 0.55 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { pitch: 105, decay: 0.4, noise: 0.1, gain: 0.95 } },
      tom_mid:     { synth: 'tom',    params: { pitch: 150, decay: 0.36, noise: 0.1, gain: 0.95 } },
      tom_high:    { synth: 'tom',    params: { pitch: 200, decay: 0.32, noise: 0.1, gain: 0.95 } },
      crash:       { synth: 'cymbal', params: { freq: 50, hp: 5500, bp: 8500, decay: 1.3, noiseMix: 0.5, gain: 0.65 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 60, hp: 6000, bp: 9000, decay: 1.0, noiseMix: 0.25, ping: 0.6, pingFreq: 900, gain: 0.6 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.3, gain: 0.7 } },
    },
  };

  const jazz_brush = {
    id: 'jazz_brush', name: 'Jazz Brushes', category: 'acoustic', type: 'synth', tune: 0,
    instruments: {
      kick:        { synth: 'kick',   params: { pitchStart: 115, pitchEnd: 55, pitchDecay: 0.04, decay: 0.3, click: 0.15, gain: 0.8 } },
      // Brush snare = mostly noise "swish", very little tonal body, softer attack.
      snare:       { synth: 'snare',  params: { pitch: 200, toneDecay: 0.05, decay: 0.3, noiseMix: 1.0, toneMix: 0.15, noiseHp: 1200, noiseLp: 6000, gain: 0.85 } },
      rim:         { synth: 'rim',    params: { pitch: 380, decay: 0.05, gain: 0.65 } },
      clap:        { synth: 'clap',   params: { freq: 1100, decay: 0.18, gain: 0.6 } },
      hihat_closed:{ synth: 'hihat',  params: { freq: 38, hp: 8500, bp: 11000, decay: 0.05, air: 0.4, gain: 0.5 }, choke: HH },
      hihat_pedal: { synth: 'hihat',  params: { freq: 38, hp: 8500, bp: 11000, decay: 0.04, air: 0.3, gain: 0.42 }, choke: HH },
      hihat_open:  { synth: 'hihat',  params: { freq: 36, hp: 7000, bp: 10000, decay: 0.4, air: 0.5, gain: 0.5 }, choke: HH },
      tom_low:     { synth: 'tom',    params: { pitch: 115, decay: 0.4, noise: 0.25, gain: 0.8 } },
      tom_mid:     { synth: 'tom',    params: { pitch: 160, decay: 0.36, noise: 0.25, gain: 0.8 } },
      tom_high:    { synth: 'tom',    params: { pitch: 215, decay: 0.32, noise: 0.25, gain: 0.8 } },
      crash:       { synth: 'cymbal', params: { freq: 52, hp: 5500, bp: 8500, decay: 1.3, noiseMix: 0.55, gain: 0.55 }, choke: 'crash' },
      ride:        { synth: 'cymbal', params: { freq: 62, hp: 6500, bp: 9500, decay: 1.2, noiseMix: 0.25, ping: 0.8, pingFreq: 980, gain: 0.6 } },
      cowbell:     { synth: 'cowbell',params: { freq: 560, f1: 540, f2: 800, decay: 0.28, gain: 0.5 } },
    },
  };

  const builtin = [acoustic, rock, jazz, electronic_808, vintage_linn, jazz_brush];
  const byId = {};
  builtin.forEach((k) => { byId[k.id] = k; });

  return {
    builtin,
    get(id) { return byId[id]; },
    /** Lightweight list for selectors. */
    list() { return builtin.map((k) => ({ id: k.id, name: k.name, category: k.category, type: 'synth' })); },
  };
})();
