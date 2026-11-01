/* =============================================================================
 * midi-engine.js — Web MIDI input, GM mapping, hi-hat state machine
 * -----------------------------------------------------------------------------
 * Parses incoming MIDI, resolves notes to canonical slots via an editable map,
 * tracks the hi-hat pedal (CC4) to decide open/half/closed, and forwards hits
 * to the audio engine with velocity. Also supports MIDI-learn for remapping.
 * A keyboard's sustain/damper pedal (CC64) can act as a drum foot pedal: it
 * either triggers a slot on press (kick by default) or drives the hi-hat.
 *
 * Events emitted (subscribe with DM.midi.on):
 *   'state'   -> { supported, enabled, error }
 *   'devices' -> [{ id, name, manufacturer }]
 *   'note'    -> { note, velocity, slot, latencyMs }   (for visual feedback)
 *   'cc'      -> { controller, value }
 *   'learned' -> { note, slot }
 * ========================================================================== */

DM.midi = (function () {
  'use strict';

  const U = DM.util;

  // General MIDI percussion map (note number -> canonical slot).
  const DEFAULT_MAP = {
    35: 'kick', 36: 'kick',
    37: 'rim', 38: 'snare', 40: 'snare',
    39: 'clap',
    41: 'tom_low', 43: 'tom_low', 45: 'tom_low',
    47: 'tom_mid', 48: 'tom_mid',
    50: 'tom_high',
    42: 'hihat_closed', 44: 'hihat_pedal', 46: 'hihat_open',
    49: 'crash', 52: 'crash', 55: 'crash', 57: 'crash',
    51: 'ride', 53: 'ride', 59: 'ride',
    56: 'cowbell',
  };

  const state = {
    access: null,
    inputs: [],
    selectedId: 'all',     // 'all' or a specific input id
    map: Object.assign({}, DEFAULT_MAP),
    learnSlot: null,       // when set, next note is assigned to this slot
    events: U.emitter(),
    // hi-hat pedal state machine
    pedal: {
      cc: 4,               // foot-controller CC (Roland/most e-kits use CC4)
      value: 0,            // raw 0..127
      closedIsHigh: true,  // high value == pedal pressed == closed
      openThresh: 35,      // below -> open
      closedThresh: 95,    // above -> closed, in between -> half-open
      lastClosed: false,   // for chick detection on close
    },
    // sustain/damper pedal (CC64) used as a drum foot pedal
    sustain: {
      cc: 64,
      mode: 'kick',        // a slot to trigger on press, 'hihat' (acts as CC4), or 'off'
      velocity: 110,       // CC64 carries no velocity, so hits use a fixed one
      pressThresh: 64,     // >= this -> pressed (half-damper pedals send 0..127)
      releaseThresh: 40,   // <  this -> released (hysteresis avoids double hits)
      down: false,
    },
  };

  function on(evt, fn) { return state.events.on(evt, fn); }

  /* --- enabling --------------------------------------------------------- */

  async function enable() {
    if (!navigator.requestMIDIAccess) {
      state.events.emit('state', { supported: false, enabled: false,
        error: 'Web MIDI API not available. Use Chrome/Edge over https:// or file://.' });
      return false;
    }
    try {
      state.access = await navigator.requestMIDIAccess({ sysex: false });
      state.access.onstatechange = refreshDevices;
      bindAllInputs();
      refreshDevices();
      state.events.emit('state', { supported: true, enabled: true });
      return true;
    } catch (e) {
      state.events.emit('state', { supported: true, enabled: false, error: String(e) });
      return false;
    }
  }

  function refreshDevices() {
    if (!state.access) return;
    state.inputs = Array.from(state.access.inputs.values()).map((i) => ({
      id: i.id, name: i.name, manufacturer: i.manufacturer,
    }));
    bindAllInputs();
    state.events.emit('devices', state.inputs);
  }

  function bindAllInputs() {
    if (!state.access) return;
    state.access.inputs.forEach((input) => {
      input.onmidimessage = (ev) => {
        if (state.selectedId !== 'all' && input.id !== state.selectedId) return;
        handleMessage(ev);
      };
    });
  }

  function selectDevice(id) { state.selectedId = id; }

  /* --- message handling ------------------------------------------------- */

  function handleMessage(ev) {
    const [status, d1, d2] = ev.data;
    const cmd = status & 0xf0;

    if (cmd === 0xb0) {                 // Control Change
      handleCC(d1, d2);
      return;
    }
    // Note On (with velocity > 0). Note Off / velocity-0 ignored (percussive).
    const isNoteOn = cmd === 0x90 && d2 > 0;
    if (!isNoteOn) return;

    const note = d1;
    const velocity = d2;

    // MIDI-learn: capture this note for the slot being mapped.
    if (state.learnSlot) {
      state.map[note] = state.learnSlot;
      const learned = { note, slot: state.learnSlot };
      state.learnSlot = null;
      state.events.emit('learned', learned);
      return;
    }

    let slot = state.map[note];
    if (!slot) return;                  // unmapped pad
    slot = resolveHiHat(slot);          // apply pedal logic for hi-hats

    // Latency proxy: time the event sat before we handled it.
    const latencyMs = (typeof ev.timeStamp === 'number' && performance && performance.now)
      ? Math.max(0, performance.now() - ev.timeStamp) : null;

    triggerSlot(slot, velocity);
    state.events.emit('note', { note, velocity, slot, latencyMs });
  }

  function handleCC(controller, value) {
    if (controller === state.sustain.cc && state.sustain.mode !== 'off') {
      handleSustain(value);
    } else if (controller === state.pedal.cc) {
      handleHiHatPedal(value);
    }
    state.events.emit('cc', { controller, value });
  }

  /** CC64 as a foot pedal: trigger on the press edge, or stand in for CC4. */
  function handleSustain(value) {
    const s = state.sustain;
    if (s.mode === 'hihat') { handleHiHatPedal(value); return; }
    if (!s.down && value >= s.pressThresh) {
      s.down = true;
      triggerSlot(s.mode, s.velocity);
      state.events.emit('note', { note: null, velocity: s.velocity, slot: s.mode, latencyMs: null });
    } else if (s.down && value < s.releaseThresh) {
      s.down = false;
    }
  }

  function handleHiHatPedal(value) {
    state.pedal.value = value;
    const closed = isPedalClosed();
    // Pedal chick: edge transition open -> fully closed makes a sound.
    if (closed && !state.pedal.lastClosed) {
      triggerSlot('hihat_pedal', 90);
      state.events.emit('note', { note: 44, velocity: 90, slot: 'hihat_pedal', latencyMs: null });
    }
    state.pedal.lastClosed = closed;
  }

  function closedAmount() {
    const p = state.pedal;
    return p.closedIsHigh ? p.value : 127 - p.value;
  }
  function isPedalClosed() { return closedAmount() >= state.pedal.closedThresh; }

  /**
   * Resolve a hi-hat slot through the pedal state machine:
   *   - an explicit closed/pedal note stays as is
   *   - an "open" note becomes closed / half / open depending on pedal position
   */
  function resolveHiHat(slot) {
    if (slot === 'hihat_closed' || slot === 'hihat_pedal') return slot;
    if (slot !== 'hihat_open') return slot;

    const amt = closedAmount();
    if (amt >= state.pedal.closedThresh) return 'hihat_closed';
    if (amt >= state.pedal.openThresh) return 'hihat_half'; // virtual: handled below
    return 'hihat_open';
  }

  /** Play a slot, including the virtual "half-open" hi-hat. */
  function triggerSlot(slot, velocity) {
    if (slot === 'hihat_half') {
      // Half-open = open sample/synth, damped: choke its group shortly after.
      DM.AudioEngine.play('hihat_open', velocity);
      setTimeout(() => DM.AudioEngine.chokeGroup('hihat'), 160);
      return;
    }
    DM.AudioEngine.play(slot, velocity);
  }

  /* --- mapping / learn / config ----------------------------------------- */

  function getMapping() { return Object.assign({}, state.map); }
  function setMapping(note, slot) { state.map[note] = slot; }
  function clearMapping(note) { delete state.map[note]; }
  function resetMapping() { state.map = Object.assign({}, DEFAULT_MAP); }
  function setMappingTable(table) { state.map = Object.assign({}, table); }

  function learn(slot) { state.learnSlot = slot; }
  function cancelLearn() { state.learnSlot = null; }

  function setPedalConfig(cfg) { Object.assign(state.pedal, cfg); }
  function getPedalConfig() { return Object.assign({}, state.pedal); }
  function setSustainConfig(cfg) { Object.assign(state.sustain, cfg); state.sustain.down = false; }
  function getSustainConfig() { return Object.assign({}, state.sustain); }

  return {
    on, enable, refreshDevices, selectDevice,
    getMapping, setMapping, clearMapping, resetMapping, setMappingTable,
    learn, cancelLearn,
    setPedalConfig, getPedalConfig, setSustainConfig, getSustainConfig,
    DEFAULT_MAP,
    get inputs() { return state.inputs; },
    get selectedId() { return state.selectedId; },
  };
})();
