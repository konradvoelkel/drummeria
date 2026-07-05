/* =============================================================================
 * utils.js — shared helpers and the global DM namespace
 * -----------------------------------------------------------------------------
 * The whole app hangs off a single global object `DM` (DrumMachine) so we don't
 * pollute the global scope and dependencies between modules stay explicit.
 * We use classic <script> tags (NOT ES modules) on purpose: ES modules are
 * blocked by the browser when you open index.html directly via file://, and a
 * hard requirement here is "works by just opening the file".
 * ========================================================================== */

window.DM = window.DM || {};

DM.util = (function () {
  'use strict';

  /** Clamp n into [min, max]. */
  function clamp(n, min, max) {
    return n < min ? min : n > max ? max : n;
  }

  /** Linear interpolation. */
  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  /** Uniform random in [min, max). */
  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  /** Random ± amount around 0. */
  function randSym(amount) {
    return (Math.random() * 2 - 1) * amount;
  }

  /** Decibels -> linear gain. */
  function dbToGain(db) {
    return Math.pow(10, db / 20);
  }

  /** Convert a MIDI note number to a semitone-relative playback rate. */
  function semitonesToRate(semitones) {
    return Math.pow(2, semitones / 12);
  }

  /** Format seconds (audioContext.currentTime style) into mm:ss. */
  function fmtTime(s) {
    s = Math.max(0, Math.floor(s));
    const m = Math.floor(s / 60);
    const r = s % 60;
    return m + ':' + String(r).padStart(2, '0');
  }

  /** Tiny event emitter used by the engines to talk to the UI. */
  function emitter() {
    const map = new Map();
    return {
      on(evt, fn) {
        if (!map.has(evt)) map.set(evt, new Set());
        map.get(evt).add(fn);
        return () => map.get(evt).delete(fn);
      },
      emit(evt, payload) {
        const set = map.get(evt);
        if (set) set.forEach((fn) => fn(payload));
      },
    };
  }

  /** querySelector shorthand. */
  const $ = (sel, root) => (root || document).querySelector(sel);
  const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));

  /** Create an element with attributes/children in one call. */
  function el(tag, attrs, children) {
    const node = document.createElement(tag);
    if (attrs) {
      for (const k in attrs) {
        if (k === 'class') node.className = attrs[k];
        else if (k === 'text') node.textContent = attrs[k];
        else if (k === 'html') node.innerHTML = attrs[k];
        else if (k.startsWith('on') && typeof attrs[k] === 'function') {
          node.addEventListener(k.slice(2).toLowerCase(), attrs[k]);
        } else if (attrs[k] != null) node.setAttribute(k, attrs[k]);
      }
    }
    if (children) {
      (Array.isArray(children) ? children : [children]).forEach((c) => {
        if (c == null) return;
        node.appendChild(typeof c === 'string' ? document.createTextNode(c) : c);
      });
    }
    return node;
  }

  return {
    clamp, lerp, rand, randSym, dbToGain, semitonesToRate,
    fmtTime, emitter, $, $$, el,
  };
})();
