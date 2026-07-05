/* =============================================================================
 * drumkit.js — stylised, clickable SVG drum kit
 * -----------------------------------------------------------------------------
 * Renders a front-view drum set into #drumkit. Every piece is a clickable
 * <g data-slot="…"> that triggers the audio engine, and flashes whenever that
 * slot is played from anywhere (mouse, MIDI, demo grooves, loop playback) via
 * the engine's 'hit' event — same feedback channel the pad grid uses.
 * ========================================================================== */

DM.drumkit = (function () {
  'use strict';

  const U = DM.util;

  // slot -> {title} — hihat_open/closed are the two cymbals of the same stand.
  const TITLES = {
    kick: 'Kick — bass drum',
    snare: 'Snare',
    rim: 'Rimshot / side stick (snare rim)',
    clap: 'Hand clap',
    hihat_open: 'Hi-hat open (top cymbal)',
    hihat_closed: 'Hi-hat closed (bottom cymbal)',
    hihat_pedal: 'Hi-hat pedal (chick)',
    tom_high: 'High tom',
    tom_mid: 'Mid tom',
    tom_low: 'Floor tom',
    crash: 'Crash cymbal',
    ride: 'Ride cymbal',
    cowbell: 'Cowbell',
  };

  const SVG = `
<svg viewBox="0 0 640 400" xmlns="http://www.w3.org/2000/svg" role="group" aria-label="Drum kit">
  <!-- stands -->
  <g class="dk-stand">
    <line x1="140" y1="70"  x2="118" y2="336"/>
    <line x1="505" y1="86"  x2="527" y2="336"/>
    <line x1="95"  y1="140" x2="95"  y2="336"/>
    <line x1="480" y1="270" x2="480" y2="336"/>
    <line x1="185" y1="258" x2="185" y2="336"/>
  </g>

  <g class="dk-piece" data-slot="crash">
    <ellipse class="dk-cym" cx="140" cy="62" rx="74" ry="14" transform="rotate(-8 140 62)"/>
    <circle class="dk-bell" cx="140" cy="62" r="7"/>
  </g>

  <g class="dk-piece" data-slot="ride">
    <ellipse class="dk-cym" cx="505" cy="78" rx="82" ry="15" transform="rotate(6 505 78)"/>
    <circle class="dk-bell" cx="505" cy="78" r="8"/>
  </g>

  <g class="dk-piece" data-slot="hihat_open">
    <ellipse class="dk-cym" cx="95" cy="116" rx="47" ry="9" transform="rotate(-5 95 116)"/>
  </g>
  <g class="dk-piece" data-slot="hihat_closed">
    <ellipse class="dk-cym" cx="95" cy="136" rx="47" ry="9"/>
  </g>
  <g class="dk-piece" data-slot="hihat_pedal">
    <rect class="dk-pedal" x="76" y="330" width="38" height="26" rx="5"/>
    <text class="dk-label" x="95" y="374">pedal</text>
  </g>

  <g class="dk-piece" data-slot="tom_high">
    <circle class="dk-shell" cx="258" cy="132" r="41"/>
    <circle class="dk-head"  cx="258" cy="132" r="32"/>
  </g>
  <g class="dk-piece" data-slot="tom_mid">
    <circle class="dk-shell" cx="374" cy="132" r="45"/>
    <circle class="dk-head"  cx="374" cy="132" r="36"/>
  </g>
  <g class="dk-piece" data-slot="tom_low">
    <circle class="dk-shell" cx="482" cy="222" r="52"/>
    <circle class="dk-head"  cx="482" cy="222" r="42"/>
  </g>

  <g class="dk-piece" data-slot="kick">
    <circle class="dk-shell" cx="316" cy="252" r="88"/>
    <circle class="dk-head"  cx="316" cy="252" r="72"/>
    <circle class="dk-dot"   cx="316" cy="252" r="14"/>
  </g>

  <g class="dk-piece" data-slot="cowbell">
    <path class="dk-metal" d="M303 150 L333 150 L327 177 L309 177 Z"/>
    <text class="dk-label" x="318" y="192">cowbell</text>
  </g>

  <g class="dk-piece" data-slot="snare">
    <circle class="dk-shell" cx="185" cy="212" r="46"/>
    <circle class="dk-head"  cx="185" cy="212" r="36"/>
  </g>
  <g class="dk-piece" data-slot="rim">
    <circle class="dk-rim" cx="185" cy="212" r="46"/>
  </g>

  <g class="dk-piece" data-slot="clap">
    <circle class="dk-clap" cx="580" cy="310" r="17"/>
    <g class="dk-spark">
      <line x1="580" y1="284" x2="580" y2="276"/>
      <line x1="598" y1="292" x2="604" y2="286"/>
      <line x1="562" y1="292" x2="556" y2="286"/>
    </g>
    <text class="dk-label" x="580" y="348">clap</text>
  </g>
</svg>`;

  const pieceEls = {}; // slot -> [g, …]

  function init() {
    const wrap = U.$('#drumkit');
    if (!wrap) return;
    wrap.innerHTML = SVG;

    U.$$('.dk-piece', wrap).forEach((g) => {
      const slot = g.getAttribute('data-slot');
      (pieceEls[slot] = pieceEls[slot] || []).push(g);

      const title = document.createElementNS('http://www.w3.org/2000/svg', 'title');
      title.textContent = TITLES[slot] || slot;
      g.appendChild(title);

      g.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        DM.AudioEngine.resume();
        DM.AudioEngine.play(slot, 110);
      });
    });

    // Flash on every hit, whatever triggered it.
    DM.AudioEngine.on('hit', ({ slot }) => flash(slot));
  }

  function flash(slot) {
    (pieceEls[slot] || []).forEach((el) => {
      el.classList.add('hit');
      clearTimeout(el._t);
      el._t = setTimeout(() => el.classList.remove('hit'), 110);
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }

  return { flash };
})();
