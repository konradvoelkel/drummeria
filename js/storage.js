/* =============================================================================
 * storage.js — IndexedDB wrapper for cached sample packs + app settings
 * -----------------------------------------------------------------------------
 * Two object stores:
 *   - "kits"     : one record per downloaded/imported kit  { id, manifest, files }
 *                  files = { "kick.wav": ArrayBuffer, ... }  (raw encoded audio)
 *   - "settings" : free-form key/value (mapping, last kit, velocity curve, ...)
 *
 * Storing raw ArrayBuffers (not decoded AudioBuffers — those aren't structured-
 * cloneable) means downloaded kits survive reloads and work fully offline.
 * ========================================================================== */

DM.storage = (function () {
  'use strict';

  const DB_NAME = 'drum-machine';
  const DB_VERSION = 1;
  let dbPromise = null;

  function open() {
    if (dbPromise) return dbPromise;
    dbPromise = new Promise((resolve, reject) => {
      if (!('indexedDB' in window)) {
        return reject(new Error('IndexedDB not supported in this browser.'));
      }
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains('kits')) {
          db.createObjectStore('kits', { keyPath: 'id' });
        }
        if (!db.objectStoreNames.contains('settings')) {
          db.createObjectStore('settings');
        }
      };
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => reject(req.error);
    });
    return dbPromise;
  }

  function tx(store, mode) {
    return open().then((db) => db.transaction(store, mode).objectStore(store));
  }

  function reqToPromise(request) {
    return new Promise((resolve, reject) => {
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  /* ---- kits ------------------------------------------------------------- */

  async function saveKit(record) {
    // record: { id, manifest, files }
    const store = await tx('kits', 'readwrite');
    return reqToPromise(store.put(record));
  }

  async function getKit(id) {
    const store = await tx('kits', 'readonly');
    return reqToPromise(store.get(id));
  }

  async function deleteKit(id) {
    const store = await tx('kits', 'readwrite');
    return reqToPromise(store.delete(id));
  }

  async function listKits() {
    const store = await tx('kits', 'readonly');
    const all = await reqToPromise(store.getAll());
    // Don't ship the heavy file blobs around when only metadata is needed.
    return all.map((k) => ({ id: k.id, manifest: k.manifest }));
  }

  async function hasKit(id) {
    return !!(await getKit(id));
  }

  /* ---- settings --------------------------------------------------------- */

  async function setSetting(key, value) {
    const store = await tx('settings', 'readwrite');
    return reqToPromise(store.put(value, key));
  }

  async function getSetting(key, fallback) {
    const store = await tx('settings', 'readonly');
    const v = await reqToPromise(store.get(key));
    return v === undefined ? fallback : v;
  }

  /** Rough estimate of cache usage, when the browser exposes it. */
  async function estimate() {
    if (navigator.storage && navigator.storage.estimate) {
      try { return await navigator.storage.estimate(); } catch (e) { /* ignore */ }
    }
    return null;
  }

  return {
    saveKit, getKit, deleteKit, listKits, hasKit,
    setSetting, getSetting, estimate,
  };
})();
