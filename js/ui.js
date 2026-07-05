/* =============================================================================
 * ui.js — DOM wiring, drum-pad grid, visual feedback, control bindings
 * -----------------------------------------------------------------------------
 * Pure view layer: reads/writes the engines but holds no audio logic itself.
 * Kit selection (which can be async for sample kits) is delegated to DM.app.
 * ========================================================================== */

DM.UI = (function () {
  'use strict';

  const U = DM.util;
  const $ = U.$;

  // Pads shown in the grid, with their representative GM note (for the label).
  const PADS = [
    { slot: 'kick',         label: 'Kick',        note: 36 },
    { slot: 'snare',        label: 'Snare',       note: 38 },
    { slot: 'rim',          label: 'Rim/Stick',   note: 37 },
    { slot: 'clap',         label: 'Clap',        note: 39 },
    { slot: 'hihat_closed', label: 'HH Closed',   note: 42 },
    { slot: 'hihat_open',   label: 'HH Open',     note: 46 },
    { slot: 'hihat_pedal',  label: 'HH Pedal',    note: 44 },
    { slot: 'tom_high',     label: 'High Tom',    note: 50 },
    { slot: 'tom_mid',      label: 'Mid Tom',     note: 47 },
    { slot: 'tom_low',      label: 'Low/Floor',   note: 45 },
    { slot: 'crash',        label: 'Crash',       note: 49 },
    { slot: 'ride',         label: 'Ride',        note: 51 },
    { slot: 'cowbell',      label: 'Cowbell',     note: 56 },
  ];

  const padEls = {}; // slot -> element
  let lastOutLatency = null;

  function init() {
    buildPads();
    buildMapping();
    bindControls();
    subscribe();
    refreshKitSelectors();
    refreshCachedKits();
  }

  /* --- pads ------------------------------------------------------------- */

  function buildPads() {
    const wrap = $('#pads');
    wrap.innerHTML = '';
    PADS.forEach((p) => {
      const el = U.el('div', { class: 'pad', 'data-slot': p.slot }, [
        U.el('div', { class: 'pad-name', text: p.label }),
        U.el('div', { class: 'pad-note', text: 'note ' + p.note }),
        U.el('div', { class: 'pad-vel' }),
      ]);
      el.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        DM.AudioEngine.resume();
        DM.AudioEngine.play(p.slot, 110); // test hit
      });
      padEls[p.slot] = el;
      wrap.appendChild(el);
    });
  }

  function flashPad(slot, velocity) {
    const el = padEls[slot];
    if (!el) return;
    el.classList.add('hit');
    const bar = el.querySelector('.pad-vel');
    if (bar) bar.style.setProperty('--v', Math.round((velocity / 127) * 100) + '%');
    // remove on next frame-ish so rapid hits keep flashing
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove('hit'), 90);
  }

  /* --- mapping ---------------------------------------------------------- */

  function buildMapping() {
    const list = $('#mapList');
    list.innerHTML = '';
    PADS.forEach((p) => {
      const notes = notesForSlot(p.slot);
      const row = U.el('div', { class: 'map-row' }, [
        U.el('span', { class: 'slot', text: p.label }),
        U.el('span', { class: 'note', text: notes.length ? notes.join(', ') : '—' }),
        U.el('button', {
          class: 'btn btn-sm', text: 'Learn',
          onclick: () => startLearn(p.slot, row),
        }),
      ]);
      list.appendChild(row);
    });
  }

  function notesForSlot(slot) {
    const map = DM.midi.getMapping();
    return Object.keys(map).filter((n) => map[n] === slot).map(Number).sort((a, b) => a - b);
  }

  let learningRow = null;
  function startLearn(slot, row) {
    DM.midi.learn(slot);
    if (learningRow) learningRow.classList.remove('learning');
    learningRow = row; row.classList.add('learning');
    padEls[slot] && padEls[slot].classList.add('learning');
  }

  /* --- control bindings ------------------------------------------------- */

  function bindControls() {
    $('#deviceSelect').addEventListener('change', (e) => DM.midi.selectDevice(e.target.value));

    $('#kitSelect').addEventListener('change', (e) => DM.app.selectKit(e.target.value));
    $('#kit2Select').addEventListener('change', (e) => DM.app.selectSecondaryKit(e.target.value));

    bindRange('#layerMix', '#layerMixOut', (v) => {
      DM.AudioEngine.setLayerMix(v / 100); return v + '%';
    });
    bindRange('#masterVol', '#volOut', (v) => {
      DM.AudioEngine.setMasterVolume(v / 100); return v + '%';
    });

    $('#velCurve').addEventListener('change', (e) => DM.AudioEngine.setVelocityCurve(e.target.value));
    $('#humanize').addEventListener('change', (e) => DM.AudioEngine.setHumanize({ enabled: e.target.checked }));

    // metronome
    $('#metroBtn').addEventListener('click', () => {
      DM.metronome.toggle();
      $('#metroBtn').classList.toggle('active', DM.metronome.running);
    });
    $('#bpm').addEventListener('change', (e) => DM.metronome.setBpm(+e.target.value));

    // loop
    $('#loopRecBtn').addEventListener('click', () => {
      if (DM.loop.recording) DM.loop.stopRecording();
      else DM.loop.startRecording();
    });
    $('#loopPlayBtn').addEventListener('click', () => {
      if (DM.loop.playing) DM.loop.stop(); else DM.loop.play();
    });
    $('#loopClearBtn').addEventListener('click', () => DM.loop.clear());

    // WAV recorder
    $('#wavRecBtn').addEventListener('click', toggleWavRecord);

    // mapping reset
    $('#resetMap').addEventListener('click', () => { DM.midi.resetMapping(); buildMapping(); });

    // sample library
    $('#downloadKits').addEventListener('click', doDownload);
    $('#importZip').addEventListener('change', doImport);
    $('#importFolder').addEventListener('change', doImportFolder);
  }

  function bindRange(sel, outSel, onInput) {
    const input = $(sel), out = $(outSel);
    input.addEventListener('input', () => { out.textContent = onInput(+input.value); });
  }

  /* --- WAV record ------------------------------------------------------- */

  function toggleWavRecord() {
    const btn = $('#wavRecBtn');
    if (DM.recorder.recording) {
      const result = DM.recorder.stop();
      btn.classList.remove('recording'); btn.textContent = '● Record WAV';
      if (result) {
        const a = $('#wavDownload');
        a.href = result.url;
        a.download = 'drum-take-' + Math.round(result.duration) + 's.wav';
        a.hidden = false;
        $('#wavInfo').textContent = U.fmtTime(result.duration) + ' captured';
      }
    } else {
      DM.AudioEngine.resume();
      DM.recorder.start();
      btn.classList.add('recording'); btn.textContent = '■ Stop';
      $('#wavInfo').textContent = 'recording…';
      $('#wavDownload').hidden = true;
    }
  }

  /* --- sample library --------------------------------------------------- */

  async function doDownload() {
    const log = $('#dlLog');
    log.textContent = '';
    const append = (m) => { log.textContent += m + '\n'; log.scrollTop = log.scrollHeight; };
    append('Checking sources…');
    try {
      await DM.samples.downloadSamplePacks(append);
    } catch (e) {
      append('Error: ' + e.message);
    }
    // List manual sources with their pages so the user can grab ZIPs.
    append('\nManual CC0 sources (download a .zip, then Import ZIP):');
    DM.samples.SOURCES.forEach((s) => { if (s.page) append('  • ' + s.name + ' → ' + s.page); });
    await DM.app.refreshKits();
  }

  async function doImport(e) {
    const file = e.target.files[0];
    if (!file) return;
    const log = $('#dlLog');
    log.textContent = 'Importing ' + file.name + ' …\n';
    try {
      const r = await DM.samples.importPackFromFile(file);
      log.textContent += '✓ Imported "' + r.manifest.name + '" (' + r.slots + ' instruments)\n';
      await DM.app.refreshKits();
    } catch (err) {
      log.textContent += '✗ ' + err.message + '\n';
    }
    e.target.value = '';
  }

  async function doImportFolder(e) {
    const files = Array.from(e.target.files || []);
    if (!files.length) return;
    const log = $('#dlLog');
    log.textContent = 'Importing folder (' + files.length + ' files) …\n';
    try {
      const r = await DM.samples.importPackFromFolder(files);
      log.textContent += '✓ Imported "' + r.manifest.name + '" (' + r.slots + ' instruments)\n';
      await DM.app.refreshKits();
    } catch (err) {
      log.textContent += '✗ ' + err.message + '\n';
    }
    e.target.value = '';
  }

  /* --- selectors / cached kits ----------------------------------------- */

  async function refreshKitSelectors() {
    const builtin = DM.kits.list();
    const folder = (DM.app && DM.app.folderKits) || [];
    let cached = [];
    try { cached = await DM.storage.listKits(); } catch (e) { /* no IDB */ }

    const opts = (includeNone) => {
      const frag = document.createDocumentFragment();
      if (includeNone) frag.appendChild(U.el('option', { value: '', text: '— none —' }));
      const g1 = U.el('optgroup', { label: 'Synthesised (built-in)' });
      builtin.forEach((k) => g1.appendChild(U.el('option', { value: k.id, text: k.name })));
      frag.appendChild(g1);
      if (cached.length) {
        const g2 = U.el('optgroup', { label: 'Sample packs (cached)' });
        cached.forEach((k) => g2.appendChild(U.el('option', { value: k.id, text: (k.manifest && k.manifest.name) || k.id })));
        frag.appendChild(g2);
      }
      if (folder.length) {
        const g3 = U.el('optgroup', { label: 'Sample packs (server)' });
        folder.forEach((k) => g3.appendChild(U.el('option', { value: k.id, text: k.name || k.id })));
        frag.appendChild(g3);
      }
      return frag;
    };

    const kit1 = $('#kitSelect'); const cur1 = kit1.value;
    kit1.innerHTML = ''; kit1.appendChild(opts(false));
    if (cur1) kit1.value = cur1;

    const kit2 = $('#kit2Select'); const cur2 = kit2.value;
    kit2.innerHTML = ''; kit2.appendChild(opts(true));
    if (cur2) kit2.value = cur2;
  }

  async function refreshCachedKits() {
    const wrap = $('#cachedKits');
    let cached = [];
    try { cached = await DM.storage.listKits(); } catch (e) {}
    wrap.innerHTML = '';
    if (!cached.length) { wrap.appendChild(U.el('span', { class: 'muted', text: 'none yet' })); return; }
    cached.forEach((k) => {
      const name = (k.manifest && k.manifest.name) || k.id;
      wrap.appendChild(U.el('div', { class: 'cached-kit' }, [
        U.el('span', { text: name }),
        U.el('button', {
          class: 'btn btn-sm', text: 'Delete',
          onclick: async () => { await DM.storage.deleteKit(k.id); await DM.app.refreshKits(); },
        }),
      ]));
    });
  }

  /* --- engine/midi event subscriptions ---------------------------------- */

  function subscribe() {
    // Visual feedback for ANY triggered hit (clicks + MIDI both go through here)
    DM.AudioEngine.on('hit', ({ slot, velocity }) => flashPad(slot, velocity));

    DM.midi.on('state', (s) => {
      const badge = $('#midiStatus');
      if (s.enabled) { badge.textContent = 'MIDI: on'; badge.className = 'badge badge-on'; }
      else { badge.textContent = 'MIDI: ' + (s.supported ? 'denied' : 'unsupported'); badge.className = 'badge badge-off'; }
      if (s.error) console.warn('MIDI:', s.error);
    });

    DM.midi.on('devices', (devices) => {
      const sel = $('#deviceSelect'); const cur = sel.value;
      sel.innerHTML = '';
      sel.appendChild(U.el('option', { value: 'all', text: 'All inputs' }));
      devices.forEach((d) => sel.appendChild(U.el('option', { value: d.id, text: d.name })));
      sel.value = devices.find((d) => d.id === cur) ? cur : 'all';
      const badge = $('#midiStatus');
      if (devices.length) { badge.textContent = 'MIDI: ' + devices.length + ' device(s)'; badge.className = 'badge badge-on'; }
    });

    DM.midi.on('note', ({ slot, velocity, latencyMs }) => {
      flashPad(slot, velocity);
      updateLatency(latencyMs);
    });

    DM.midi.on('learned', ({ note, slot }) => {
      if (learningRow) { learningRow.classList.remove('learning'); learningRow = null; }
      padEls[slot] && padEls[slot].classList.remove('learning');
      buildMapping();
    });

    DM.loop.on('state', (s) => {
      $('#loopRecBtn').classList.toggle('active', s.recording);
      $('#loopRecBtn').textContent = s.recording ? '■ Stop Rec' : '● Loop Rec';
      $('#loopPlayBtn').classList.toggle('active', s.playing);
      $('#loopInfo').textContent = s.count
        ? s.count + ' hits · ' + s.loopLength.toFixed(1) + 's' : '';
    });
  }

  function updateLatency(midiMs) {
    const out = DM.AudioEngine.getLatencyMs();
    if (out != null) lastOutLatency = out;
    const badge = $('#latencyBadge');
    let txt = (lastOutLatency != null ? '~' + lastOutLatency + ' ms' : '~– ms');
    if (midiMs != null) badge.title = 'audio out ' + lastOutLatency + 'ms · midi handling ' + midiMs.toFixed(1) + 'ms';
    badge.textContent = txt;
  }

  return { init, refreshKitSelectors, refreshCachedKits, flashPad, updateLatency, buildMapping };
})();
