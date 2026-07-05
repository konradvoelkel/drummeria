/* =============================================================================
 * sample-loader.js — load, decode, download & import sample-based kits
 * -----------------------------------------------------------------------------
 * A "sample kit" record stored in IndexedDB looks like:
 *   { id, manifest, files: { "kick.wav": ArrayBuffer, ... } }
 *
 * The manifest (kit.json) maps slots -> velocity layers:
 *   { id, name, category, tune,
 *     instruments: { kick: { choke, layers:[{file,minVel,maxVel,gain,rate}] }, ...} }
 *
 * When a downloaded pack has NO kit.json we auto-build one from filenames
 * (kick/bd -> kick, sd/snare -> snare, hh/hat -> hi-hats, ...), so arbitrary
 * CC0 one-shot packs become playable kits.
 *
 * ─ CORS reality check ────────────────────────────────────────────────────────
 * Browsers block cross-origin fetch() unless the host sends CORS headers.
 * Most sample sites do NOT, so the always-works path is importPackFromFile()
 * (drag/drop or pick a .zip you downloaded). downloadPackFromUrl() works for
 * CORS-enabled hosts (e.g. raw.githubusercontent.com) and same-origin files.
 * ========================================================================== */

DM.samples = (function () {
  'use strict';

  /* Curated CC0 / royalty-free sources. Edit freely — each must be a direct
   * link to a .zip AND served with CORS headers to download in-browser.
   * Reliable alternative for any pack: download manually, then "Import ZIP". */
  const SOURCES = [
    {
      id: 'sampleradar-cc0',
      name: 'MusicRadar SampleRadar (CC0 drum hits)',
      page: 'https://www.musicradar.com/news/drums/1000-free-drum-samples',
      url: '', // no CORS-friendly direct zip — use Import ZIP after manual download
      note: 'Free CC0 drum hits. Download the ZIP from the page, then Import ZIP.',
    },
    {
      id: 'producerspace-cc0',
      name: 'ProducerSpace (CC0 packs)',
      page: 'https://producerspace.com/',
      url: '',
      note: 'CC0 packs. Download a ZIP, then Import ZIP.',
    },
    {
      id: 'freesound-cc0',
      name: 'Freesound.org (CC0 filter)',
      page: 'https://freesound.org/search/?f=license:%22Creative+Commons+0%22',
      url: '',
      note: 'Search CC0 one-shots, download a pack, then Import ZIP.',
    },
    // Example of a CORS-enabled direct download (raw.githubusercontent serves
    // Access-Control-Allow-Origin: *). Point this at any CC0 drum-pack zip:
    // { id:'gh-pack', name:'GitHub CC0 pack', url:'https://raw.githubusercontent.com/<user>/<repo>/main/pack.zip' },
  ];

  /** Heuristic: guess a canonical slot from a sample filename. */
  function slotForName(name) {
    const n = name.toLowerCase().replace(/.*\//, '');
    const has = (...keys) => keys.some((k) => n.includes(k));
    if (has('kick', 'bassdrum', 'bass_drum', 'bd', 'bdrum')) return 'kick';
    if (has('snare', 'sd', 'snr')) return 'snare';
    if (has('clap', 'clp', 'hand')) return 'clap';
    if (has('rim', 'sidestick', 'side_stick', 'cross')) return 'rim';
    if (has('cowbell', 'cow', 'bell') && !has('ride')) return 'cowbell';
    if (has('open') && has('hat', 'hh', 'hihat')) return 'hihat_open';
    if (has('pedal') && has('hat', 'hh', 'hihat')) return 'hihat_pedal';
    if (has('hat', 'hh', 'hihat')) return 'hihat_closed';
    if (has('crash', 'cymbal', 'cym')) return 'crash';
    if (has('ride')) return 'ride';
    if (has('floor', 'tom_low', 'lowtom', 'tom1', 'lo_tom')) return 'tom_low';
    if (has('hightom', 'tom_high', 'hi_tom', 'tom3')) return 'tom_high';
    if (has('tom')) return 'tom_mid';
    return null;
  }

  /** Build a manifest by classifying filenames when no kit.json is present. */
  function buildManifestFromFiles(files, id, name) {
    const instruments = {};
    const wavs = Object.keys(files).filter((f) => /\.(wav|ogg|mp3|flac)$/i.test(f));
    for (const file of wavs) {
      const slot = slotForName(file);
      if (!slot) continue;
      if (!instruments[slot]) {
        const choke = slot.startsWith('hihat') ? 'hihat' : (slot === 'crash' ? 'crash' : null);
        instruments[slot] = { choke, layers: [] };
      }
      instruments[slot].layers.push({ file });
    }
    // Spread multiple files of one slot across the velocity range (low->high).
    for (const slot in instruments) {
      const layers = instruments[slot].layers;
      const step = 127 / layers.length;
      layers.forEach((l, i) => {
        l.minVel = Math.round(i * step);
        l.maxVel = i === layers.length - 1 ? 127 : Math.round((i + 1) * step) - 1;
      });
    }
    return {
      id: id || 'imported',
      name: name || id || 'Imported Pack',
      category: 'imported',
      tune: 0,
      instruments,
    };
  }

  /** Decode all referenced sample files into AudioBuffers -> engine kit. */
  async function buildKitFromRecord(record) {
    const ctx = DM.AudioEngine.ensure();
    const { manifest, files } = record;
    const out = {
      id: manifest.id,
      name: manifest.name,
      category: manifest.category || 'imported',
      type: 'sample',
      tune: manifest.tune || 0,
      instruments: {},
    };

    for (const slot in manifest.instruments) {
      const inst = manifest.instruments[slot];
      const layers = [];
      for (const layer of inst.layers) {
        const raw = findFile(files, layer.file);
        if (!raw) continue;
        const ab = toArrayBuffer(raw).slice(0); // copy: decodeAudioData detaches
        let buffer;
        try {
          buffer = await ctx.decodeAudioData(ab);
        } catch (e) {
          console.warn('Could not decode', layer.file, e);
          continue;
        }
        layers.push({
          buffer,
          minVel: layer.minVel || 0,
          maxVel: layer.maxVel == null ? 127 : layer.maxVel,
          gain: layer.gain || 1,
          rate: layer.rate || 1,
        });
      }
      if (layers.length) out.instruments[slot] = { layers, choke: inst.choke || null };
    }
    return out;
  }

  function findFile(files, name) {
    if (files[name]) return files[name];
    // tolerate path prefixes inside the zip (folder/kick.wav)
    const key = Object.keys(files).find((k) => k.endsWith('/' + name) || k.endsWith(name));
    return key ? files[key] : null;
  }

  function toArrayBuffer(x) {
    if (x instanceof ArrayBuffer) return x;
    if (x.buffer) return x.buffer.slice(x.byteOffset, x.byteOffset + x.byteLength);
    return x;
  }

  /* --- loading kits ----------------------------------------------------- */

  /** Load a sample kit that lives in IndexedDB (downloaded/imported). */
  async function loadStoredKit(id) {
    const record = await DM.storage.getKit(id);
    if (!record) throw new Error('Kit not in cache: ' + id);
    return buildKitFromRecord(record);
  }

  /** Load a kit from the kits/<id>/ folder (HTTP only — fetch fails on file://). */
  async function loadManifestKit(id) {
    const base = 'kits/' + id + '/';
    const manifest = await fetch(base + 'kit.json').then((r) => {
      if (!r.ok) throw new Error('No kit.json for ' + id);
      return r.json();
    });
    const files = {};
    const names = new Set();
    Object.values(manifest.instruments).forEach((inst) =>
      inst.layers.forEach((l) => names.add(l.file)));
    await Promise.all([...names].map(async (file) => {
      const r = await fetch(base + file);
      if (r.ok) files[file] = await r.arrayBuffer();
    }));
    return buildKitFromRecord({ manifest, files });
  }

  /* --- importing / downloading packs ------------------------------------ */

  /** Turn an ArrayBuffer ZIP into a cached kit record (-> IndexedDB). */
  async function ingestZip(buffer, idHint, nameHint) {
    const keep = (n) => /\.(wav|ogg|mp3|flac|json)$/i.test(n);
    const files = await DM.unzip.extract(buffer, keep);

    let manifest = null;
    const manifestKey = Object.keys(files).find((k) => /(^|\/)kit\.json$/i.test(k));
    if (manifestKey) {
      try {
        manifest = JSON.parse(new TextDecoder().decode(files[manifestKey]));
      } catch (e) { console.warn('Bad kit.json, auto-mapping instead', e); }
    }
    if (!manifest) manifest = buildManifestFromFiles(files, idHint, nameHint);
    if (idHint) manifest.id = idHint;
    if (nameHint) manifest.name = nameHint;

    const slots = Object.keys(manifest.instruments).length;
    if (!slots) throw new Error('No recognisable drum samples found in ZIP.');

    // Store raw bytes (ArrayBuffers) so the kit survives reloads / works offline.
    const fileBufs = {};
    for (const k in files) {
      if (/\.json$/i.test(k)) continue;
      fileBufs[k] = toArrayBuffer(files[k]);
    }
    const record = { id: manifest.id, manifest, files: fileBufs };
    await DM.storage.saveKit(record);
    return { id: manifest.id, manifest, slots };
  }

  /** Import a local .zip the user picked/dropped. Always works (no network). */
  async function importPackFromFile(file, idHint, nameHint) {
    const buffer = await file.arrayBuffer();
    return ingestZip(buffer, idHint, nameHint || file.name.replace(/\.zip$/i, ''));
  }

  /**
   * Import a kit from a local FOLDER picked via <input webkitdirectory>
   * (e.g. any of the kits/<Machine Name>/ folders). Reads everything with the
   * File API — no fetch — so it works over file:// too, then caches the kit in
   * IndexedDB exactly like a ZIP import. Honours the folder's kit.json when
   * present, otherwise auto-maps filenames.
   */
  async function importPackFromFolder(fileList, idHint, nameHint) {
    const files = {};
    let manifest = null;
    let folderName = '';

    await Promise.all(Array.from(fileList).map(async (f) => {
      const parts = (f.webkitRelativePath || f.name).split('/');
      if (!folderName && parts.length > 1) folderName = parts[0];
      const path = parts.length > 1 ? parts.slice(1).join('/') : parts[0];
      if (/\.(wav|ogg|mp3|flac)$/i.test(path)) {
        files[path] = await f.arrayBuffer();
      } else if (/(^|\/)kit\.json$/i.test(path) && !manifest) {
        try { manifest = JSON.parse(await f.text()); }
        catch (e) { console.warn('Bad kit.json in folder, auto-mapping instead', e); }
      }
    }));

    if (!manifest) manifest = buildManifestFromFiles(files, idHint || folderName, nameHint || folderName);
    if (idHint) manifest.id = idHint;
    if (!manifest.id) manifest.id = folderName || 'imported-folder';
    if (!manifest.name) manifest.name = nameHint || folderName || manifest.id;

    // Only count instruments whose files were actually picked up.
    const slots = Object.keys(manifest.instruments).filter((slot) =>
      manifest.instruments[slot].layers.some((l) => findFile(files, l.file))).length;
    if (!slots) throw new Error('No recognisable drum samples found in the folder.');

    const record = { id: manifest.id, manifest, files };
    await DM.storage.saveKit(record);
    return { id: manifest.id, manifest, slots };
  }

  /** Download a .zip from a (CORS-enabled / same-origin) URL and cache it. */
  async function downloadPackFromUrl(url, idHint, nameHint) {
    const res = await fetch(url, { mode: 'cors' });
    if (!res.ok) throw new Error('HTTP ' + res.status + ' for ' + url);
    const buffer = await res.arrayBuffer();
    return ingestZip(buffer, idHint, nameHint);
  }

  /**
   * downloadSamplePacks() — attempt every source in SOURCES that has a direct
   * CORS-friendly url. Returns a report; sources without a url are skipped with
   * guidance to use Import ZIP. Caches anything successfully downloaded.
   * @param {(msg:string)=>void} [onProgress]
   */
  async function downloadSamplePacks(onProgress) {
    const log = onProgress || (() => {});
    const report = [];
    for (const src of SOURCES) {
      if (await DM.storage.hasKit(src.id)) {
        report.push({ id: src.id, status: 'cached' });
        log('✓ ' + src.name + ' already cached');
        continue;
      }
      if (!src.url) {
        report.push({ id: src.id, status: 'manual', note: src.note, page: src.page });
        log('↗ ' + src.name + ' — manual: ' + (src.note || 'download then Import ZIP'));
        continue;
      }
      try {
        log('↓ Downloading ' + src.name + ' …');
        const r = await downloadPackFromUrl(src.url, src.id, src.name);
        report.push({ id: src.id, status: 'downloaded', slots: r.slots });
        log('✓ ' + src.name + ' (' + r.slots + ' instruments)');
      } catch (e) {
        report.push({ id: src.id, status: 'error', error: String(e) });
        log('✗ ' + src.name + ' failed: ' + e.message + ' (try Import ZIP)');
      }
    }
    return report;
  }

  return {
    SOURCES,
    slotForName, buildManifestFromFiles, buildKitFromRecord,
    loadStoredKit, loadManifestKit,
    importPackFromFile, importPackFromFolder, downloadPackFromUrl, downloadSamplePacks,
  };
})();
