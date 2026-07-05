/* =============================================================================
 * app.js — bootstrap & orchestration
 * -----------------------------------------------------------------------------
 * Wires the start gesture, loads kits (synth or sample), restores/saves user
 * settings, and owns the only async-heavy operation the UI delegates: kit load.
 * ========================================================================== */

DM.app = (function () {
  'use strict';

  const DEFAULT_KIT = 'acoustic';

  // Sample kits served from the kits/ folder (populated when running over HTTP).
  let folderKits = [];

  /** Discover kits/index.json (HTTP only; silently ignored on file://). */
  async function discoverFolderKits() {
    try {
      const res = await fetch('kits/index.json');
      if (!res.ok) return;
      const data = await res.json();
      folderKits = (data.kits || []).filter((k) => !DM.kits.get(k.id)); // synth wins
    } catch (e) { /* file:// or no server — fine, synth kits still work */ }
  }

  /** Resolve a kit id to an engine-ready kit object (synth preset or samples). */
  async function loadKit(id) {
    const synth = DM.kits.get(id);
    if (synth) return synth;                       // built-in synthesised preset
    // Otherwise it's a sample kit: prefer the IndexedDB cache, then kits/ folder.
    try { return await DM.samples.loadStoredKit(id); }
    catch (e) { /* not cached */ }
    return await DM.samples.loadManifestKit(id);   // works when served over HTTP
  }

  async function selectKit(id) {
    try {
      const kit = await loadKit(id);
      DM.AudioEngine.setKit(kit);
      DM.storage.setSetting('lastKit', id).catch(() => {});
    } catch (e) {
      console.error('Could not load kit', id, e);
      alert('Could not load kit "' + id + '": ' + e.message);
    }
  }

  async function selectSecondaryKit(id) {
    if (!id) { DM.AudioEngine.setSecondaryKit(null); return; }
    try {
      DM.AudioEngine.setSecondaryKit(await loadKit(id));
    } catch (e) {
      console.error('Could not load layer kit', id, e);
    }
  }

  async function refreshKits() {
    await DM.UI.refreshKitSelectors();
    await DM.UI.refreshCachedKits();
  }

  /* --- settings persistence -------------------------------------------- */

  async function restoreSettings() {
    try {
      const map = await DM.storage.getSetting('mapping');
      if (map) DM.midi.setMappingTable(map);

      const vc = await DM.storage.getSetting('velCurve');
      if (vc) { DM.AudioEngine.setVelocityCurve(vc); const el = DM.util.$('#velCurve'); if (el) el.value = vc; }

      const hum = await DM.storage.getSetting('humanize');
      if (hum != null) { DM.AudioEngine.setHumanize({ enabled: hum }); const el = DM.util.$('#humanize'); if (el) el.checked = hum; }

      const vol = await DM.storage.getSetting('masterVol');
      if (vol != null) {
        DM.AudioEngine.setMasterVolume(vol / 100);
        const el = DM.util.$('#masterVol'); if (el) { el.value = vol; DM.util.$('#volOut').textContent = vol + '%'; }
      }
    } catch (e) { /* IndexedDB unavailable — run with defaults */ }
  }

  function wirePersistence() {
    DM.midi.on('learned', () => DM.storage.setSetting('mapping', DM.midi.getMapping()).catch(() => {}));
    const vc = DM.util.$('#velCurve');
    vc && vc.addEventListener('change', () => DM.storage.setSetting('velCurve', vc.value).catch(() => {}));
    const hum = DM.util.$('#humanize');
    hum && hum.addEventListener('change', () => DM.storage.setSetting('humanize', hum.checked).catch(() => {}));
    const vol = DM.util.$('#masterVol');
    vol && vol.addEventListener('change', () => DM.storage.setSetting('masterVol', +vol.value).catch(() => {}));
  }

  /* --- start ----------------------------------------------------------- */

  let started = false;
  async function start() {
    if (started) return; started = true;

    await DM.AudioEngine.resume();        // unlock audio (needs the gesture)
    await restoreSettings();
    await discoverFolderKits();
    await refreshKits();

    // Load last-used kit (falls back to default), then enable MIDI.
    let lastKit = DEFAULT_KIT;
    try { lastKit = (await DM.storage.getSetting('lastKit')) || DEFAULT_KIT; } catch (e) {}
    if (!DM.kits.get(lastKit)) {
      // cached sample kit may have been deleted — verify, else default
      try { if (!(await DM.storage.hasKit(lastKit))) lastKit = DEFAULT_KIT; } catch (e) { lastKit = DEFAULT_KIT; }
    }
    const sel = DM.util.$('#kitSelect'); if (sel) sel.value = lastKit;
    await selectKit(lastKit);

    await DM.midi.enable();

    // Latency readout now that the context exists.
    DM.UI.updateLatency(null);
    setInterval(() => DM.UI.updateLatency(null), 2000);

    // Dismiss the gate.
    const ov = DM.util.$('#startOverlay'); if (ov) ov.style.display = 'none';
  }

  function init() {
    DM.UI.init();
    wirePersistence();
    const btn = DM.util.$('#startBtn');
    if (btn) btn.addEventListener('click', start);
    // Also allow starting by hitting a key (common for performers).
    document.addEventListener('keydown', function once(e) {
      if (e.key === 'Enter' || e.key === ' ') { start(); document.removeEventListener('keydown', once); }
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return {
    start, selectKit, selectSecondaryKit, loadKit, refreshKits,
    get folderKits() { return folderKits; },
  };
})();
