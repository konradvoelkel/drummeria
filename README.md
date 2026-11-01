# 🥁 Drummeria — MIDI Drum Machine (browser-only)

[![Sponsor on GitHub](https://img.shields.io/badge/Sponsor-%E2%9D%A4-ea4aaa?logo=githubsponsors&logoColor=white)](https://github.com/sponsors/ipald)
[![Buy Me a Coffee](https://img.shields.io/badge/Buy%20me%20a%20coffee-%E2%98%95-FFDD00?logo=buymeacoffee&logoColor=black)](https://buymeacoffee.com/ipald)

**English** · [Italiano ⬇](#-drummeria--drum-machine-midi-solo-browser)

Turn a MIDI electronic drum kit into a professional drum machine — **pure browser,
no install, no backend, no frameworks**. HTML + CSS + vanilla JS using the Web MIDI
API, Web Audio API, IndexedDB and the Fetch API.

> 🧑‍💻 **How this project was made** — this project was built through
> **vibecoding**, using free platforms available online: the code was written
> iteratively in conversation with AI coding tools, then reviewed, tested and
> curated by hand. No paid tooling was involved.

## Quick start

**Option A — just open the file (zero setup):**
Double-click `index.html`. Click **Start**, connect your e-drums, play.
Built-in kits are **synthesised in real time**, so they work instantly and fully
offline. *(Automatic discovery of the `kits/` folder needs Option B because
browsers block `fetch()` of local files over `file://` — but **Import folder…**
loads any local kit folder from the UI even without a server.)*

**Option B — local server (enables folder sample kits + downloads):**
```bash
python3 -m http.server 8000
# open http://localhost:8000
```

> Web MIDI requires a secure context — `https://`, `http://localhost`, or a
> `file://` page — and a Chromium browser (Chrome/Edge/Opera). Safari/Firefox have
> limited or no Web MIDI support; the synthesised kits + clickable drum kit still work.

**Option C — play from another device on your LAN (e.g. a tablet with the MIDI keyboard):**
```bash
python3 serve_https.py
# open https://<this-computer>:8443 on the tablet, accept the self-signed cert warning
```
`http://<lan-ip>` is not a secure context, so Web MIDI would be missing there; this
server uses a self-signed certificate (created in `.cert/`) and redirects plain
`http://` on the same port to `https://`.

## No drums? No problem

You don't need a MIDI kit to hear the app:

- **Stylised drum kit** — a clickable SVG drum set at the centre of the page.
  Click any piece (kick, snare, hi-hats, toms, cymbals, cowbell, clap…) to hear
  it with the currently selected kit. Pieces flash whenever they are played,
  whatever the source (mouse, MIDI, grooves).
- **Demo grooves** — six hard-wired patterns (rock, funk, hip-hop boom bap,
  house, jazz swing, electro 808) you can start with one click to hear how each
  kit sounds in context. Tempo follows the BPM field; grooves are scheduled
  sample-accurately and are captured by the WAV recorder.

## What it does

- **Auto-detects MIDI devices** and lets you pick one (or listen to all).
- **General MIDI mapping** out of the box (kick 36, snare 38, HH 42/46, toms, crash
  49, ride 51, …) with per-pad **MIDI-learn** remapping.
- **Velocity sensitivity** — gain = velocity/127 by default, plus soft/hard/S-curve
  options. Hitting harder also opens filters for a brighter tone.
- **Hi-hat state machine** — open / **half-open** / closed driven by the foot pedal
  (CC4), with a pedal "chick", and a **choke group** so a closed hit silences a
  ringing open hat.
- **Keyboard sustain pedal (CC64) as a foot pedal** — plays the kick (or snare,
  clap, crash) on press, or acts as the hi-hat pedal; continuous/half-damper pedals
  are handled with hysteresis so one press is one hit. Untick **Keys play drums**
  to play the keyboard as a piano while the pedal keeps drumming.
- **Pedal-follow grooves** — tick **Follow foot pedal** and the demo groove takes
  its tempo from the sustain pedal: the first press starts it on beat 1, the second
  sets the tempo, later presses nudge tempo and timing (by **Follow strength**)
  while the groove stays on its grid. The pedal can just steer (groove plays a tight
  kick) or play live (groove kick muted). Two bars without a press stop it.
- **6 built-in synthesised kits**: Acoustic, Rock, Jazz, Electronic 808,
  Vintage Linn, Jazz Brushes.
- **Sample packs**: download/import ZIPs of CC0 one-shots → unzipped in-browser →
  cached in IndexedDB → available offline.
- **Audio engine**: low-latency scheduling, multi-velocity sample layers, envelope
  shaping, per-kit tuning, **humanization** (±10 ms timing, ±3 % pitch),
  **dual-kit layering**, master limiter.
- **Extras**: metronome, **loop recorder** (record a phrase, loop it), and a
  **WAV recorder** that exports a 16-bit PCM `.wav` of your performance.
- **Latency indicator** (audio output latency; MIDI handling time in the tooltip).

## Samples & licensing

The `kits/` folder ships **manifests only** (`kit.json`): one for every classic
drum-machine kit (TR-808, TR-909, LinnDrum, DMX, CR-78, …). The actual audio
files are **not distributed** with this repository — recordings sampled from
commercial drum machines may be rights-encumbered, so they are excluded via
`.gitignore`. Drop legally obtained one-shots with the file names referenced by
each `kit.json` into its folder and the kit becomes playable when served over
HTTP. The built-in synthesised kits are generated by code and carry no
licensing restrictions.

## Project structure

```
index.html              # UI skeleton + script load order
css/styles.css          # minimal dark UI
js/
  utils.js              # DM namespace + helpers
  storage.js            # IndexedDB wrapper (cached kits + settings)
  unzip.js              # dependency-free ZIP extractor (DecompressionStream)
  synth-engine.js       # procedural drum synthesis
  kits.js               # 6 built-in synthesised kit presets
  audio-engine.js       # voices, velocity curves, humanize, choke, mixer, layering
  sample-loader.js      # load/decode kits, downloadSamplePacks(), ZIP import
  midi-engine.js        # Web MIDI input, GM mapping, hi-hat pedal logic, learn
  recorder.js           # WAV capture + encoder
  metronome.js          # lookahead-scheduled click
  loop-recorder.js      # record/loop a phrase of hits
  drumkit.js            # stylised clickable SVG drum kit
  demo-loops.js         # hard-wired demo grooves (step sequencer)
  scal-profiler.js      # optional latency/jitter diagnostics (needs serve.py)
  ui.js                 # DOM wiring + visual feedback
  app.js                # bootstrap & orchestration
kits/
  index.json            # list of folder sample kits (HTTP discovery)
  <Machine Name>/kit.json  # manifest per kit (audio not distributed, see above)
```

## Adding real sample kits

**Easiest — Import ZIP** (always works, even offline):
1. Grab a CC0 / royalty-free drum pack `.zip` (see sources below).
2. Click **Import ZIP…**, choose the file.
3. The app unzips it, auto-maps filenames (kick/bd, snare/sd, hh/hat open/closed,
   tom, crash, ride, clap, rim, cowbell) to slots, caches it in IndexedDB, and adds
   it to the kit selector. Include a `kit.json` in the ZIP to control velocity
   layers and choke groups precisely (see the examples in `kits/`).

**Import folder…** (works over `file://` too): pick any local kit folder — e.g.
one of the `kits/<Machine Name>/` folders once you've dropped the WAVs in. It is
read entirely with the File API (no server needed), cached in IndexedDB and
added to the kit selector, honouring the folder's `kit.json` when present.

**Folder kits** (when running over HTTP): drop the WAV files referenced by each
`kits/<id>/kit.json` into that folder; they appear under "Sample packs (server)".

### `kit.json` format

```json
{
  "id": "my_kit",
  "name": "My Kit",
  "tune": 0,
  "instruments": {
    "snare": {
      "choke": null,
      "layers": [
        { "file": "snare_soft.wav", "minVel": 0,  "maxVel": 79 },
        { "file": "snare_hard.wav", "minVel": 80, "maxVel": 127 }
      ]
    },
    "hihat_open":   { "choke": "hihat", "layers": [ { "file": "hh_open.wav" } ] },
    "hihat_closed": { "choke": "hihat", "layers": [ { "file": "hh_closed.wav" } ] }
  }
}
```
Slots: `kick, snare, rim, clap, hihat_closed, hihat_pedal, hihat_open,
tom_low, tom_mid, tom_high, crash, ride, cowbell`.

### CC0 / royalty-free sources

`downloadSamplePacks()` will fetch any **CORS-enabled** direct `.zip` URLs you add
to `SOURCES` in `js/sample-loader.js` (e.g. `raw.githubusercontent.com` links).
Most sample sites don't send CORS headers, so for those use **Import ZIP** after a
manual download:

- MusicRadar **SampleRadar** — thousands of free CC0 drum hits
- **ProducerSpace** — CC0 packs
- **Freesound.org** — filter license = *Creative Commons 0*

> ⚠️ Only use samples you have the right to use. The built-in synthesised kits are
> generated by code and carry no licensing restrictions.

## Latency notes

The audio graph uses `latencyHint: 'interactive'` and schedules hits immediately on
the audio clock. Real-world MIDI→sound latency depends on your OS audio stack and
MIDI interface; on a typical setup with a USB e-kit in Chrome it lands in the
~5–15 ms range. The badge shows the context's reported output latency.

## Design decisions

- **Classic `<script>` tags, not ES modules** — ES modules are blocked over
  `file://`, and "works by opening the file" is a hard requirement here.
- **Synthesis-first** — built-in kits are procedural so the app is instant, tiny,
  and offline by default; real samples are an optional, cached upgrade.
- **Raw bytes in IndexedDB** — encoded audio (ArrayBuffers) is stored, then decoded
  to `AudioBuffer`s at load, so downloaded kits survive reloads and work offline.

---

# 🥁 Drummeria — Drum Machine MIDI (solo browser)

[English ⬆](#-drummeria--midi-drum-machine-browser-only) · **Italiano**

Trasforma una batteria elettronica MIDI in una drum machine professionale —
**solo browser, niente installazione, niente backend, niente framework**.
HTML + CSS + JavaScript vanilla con Web MIDI API, Web Audio API, IndexedDB e
Fetch API.

> 🧑‍💻 **Come è nato questo progetto** — questo progetto è stato realizzato in
> **vibecoding**, usando piattaforme gratuite disponibili online: il codice è
> stato scritto in modo iterativo dialogando con strumenti di AI coding, poi
> rivisto, testato e curato a mano. Nessuno strumento a pagamento.

## Avvio rapido

**Opzione A — apri il file e basta (zero setup):**
Doppio clic su `index.html`. Premi **Start**, collega la batteria elettronica e
suona. I kit integrati sono **sintetizzati in tempo reale**: funzionano subito e
completamente offline. *(La scoperta automatica della cartella `kits/` richiede
l'Opzione B, perché i browser bloccano le `fetch()` di file locali su `file://`
— ma **Import folder…** carica qualsiasi cartella di kit locale dalla UI anche
senza server.)*

**Opzione B — server locale (abilita i kit a campioni e i download):**
```bash
python3 -m http.server 8000
# apri http://localhost:8000
```

> La Web MIDI richiede un contesto sicuro — `https://`, `http://localhost` o una
> pagina `file://` — e un browser Chromium (Chrome/Edge/Opera). Safari/Firefox
> hanno supporto limitato o assente; i kit sintetizzati e la batteria cliccabile
> funzionano comunque.

## Niente batteria? Nessun problema

Non serve un kit MIDI per sentire l'app:

- **Batteria stilizzata** — un set di batteria SVG cliccabile al centro della
  pagina. Clicca un elemento qualsiasi (cassa, rullante, hi-hat, tom, piatti,
  campanaccio, clap…) per sentirlo con il kit selezionato. Gli elementi si
  illuminano ogni volta che vengono suonati, da qualunque sorgente.
- **Groove demo** — sei pattern cablati (rock, funk, hip-hop boom bap, house,
  jazz swing, electro 808) avviabili con un clic per capire come suona ogni kit
  nel suo contesto. Il tempo segue il campo BPM; lo scheduling è
  sample-accurate e i groove finiscono anche nella registrazione WAV.

## Cosa fa

- **Rileva i dispositivi MIDI** e permette di sceglierne uno (o ascoltarli tutti).
- **Mappatura General MIDI** pronta all'uso (cassa 36, rullante 38, HH 42/46, tom,
  crash 49, ride 51, …) con rimappatura **MIDI-learn** per singolo pad.
- **Sensibilità alla dinamica** — gain = velocity/127 di default, più curve
  soft/hard/S. Colpire più forte apre anche i filtri per un timbro più brillante.
- **Macchina a stati dell'hi-hat** — aperto / **semiaperto** / chiuso guidato dal
  pedale (CC4), con il "chick" del pedale e un **choke group**: un colpo chiuso
  silenzia un hat aperto ancora in coda.
- **6 kit sintetizzati integrati**: Acoustic, Rock, Jazz, Electronic 808,
  Vintage Linn, Jazz Brushes.
- **Sample pack**: scarica/importa ZIP di one-shot CC0 → decompressi nel browser →
  salvati in IndexedDB → disponibili offline.
- **Motore audio**: scheduling a bassa latenza, layer multi-velocity, inviluppi,
  intonazione per kit, **humanization** (±10 ms di timing, ±3 % di pitch),
  **layering di due kit**, limiter master.
- **Extra**: metronomo, **loop recorder** (registra una frase e mandala in loop) e
  **registratore WAV** che esporta la performance in `.wav` PCM 16 bit.
- **Indicatore di latenza** (latenza di uscita audio; tempo di gestione MIDI nel
  tooltip).

## Campioni e licenze

La cartella `kits/` contiene **solo i manifest** (`kit.json`): uno per ogni kit
di drum machine classica (TR-808, TR-909, LinnDrum, DMX, CR-78, …). I file
audio **non sono distribuiti** con questo repository: le registrazioni
campionate da drum machine commerciali potrebbero essere coperte da diritti,
quindi sono escluse tramite `.gitignore`. Inserendo nelle cartelle one-shot
ottenuti legalmente, con i nomi file indicati da ciascun `kit.json`, i kit
diventano suonabili quando l'app è servita via HTTP. I kit sintetizzati
integrati sono generati dal codice e non hanno vincoli di licenza.

## Aggiungere kit a campioni reali

**La via più semplice — Import ZIP** (funziona sempre, anche offline):
1. Procurati uno `.zip` di campioni CC0 / royalty-free (fonti più sotto).
2. Clicca **Import ZIP…** e scegli il file.
3. L'app lo decomprime, mappa automaticamente i nomi file agli slot, lo salva in
   IndexedDB e lo aggiunge al selettore dei kit. Includi un `kit.json` nello ZIP
   per controllare con precisione layer di velocity e choke group (vedi gli
   esempi in `kits/`).

**Import folder…** (funziona anche su `file://`): scegli una cartella di kit
locale — ad esempio una delle `kits/<Nome Macchina>/` dopo averci messo i WAV.
Viene letta interamente col File API (nessun server), salvata in IndexedDB e
aggiunta al selettore dei kit, rispettando il `kit.json` della cartella se
presente.

**Kit da cartella** (con server HTTP): metti i WAV referenziati da ogni
`kits/<id>/kit.json` nella sua cartella; compariranno tra i "Sample packs
(server)".

Fonti CC0 / royalty-free: MusicRadar **SampleRadar**, **ProducerSpace**,
**Freesound.org** (filtro licenza *Creative Commons 0*).

> ⚠️ Usa solo campioni che hai il diritto di usare.

## Note sulla latenza

Il grafo audio usa `latencyHint: 'interactive'` e programma i colpi direttamente
sul clock audio. La latenza reale MIDI→suono dipende dallo stack audio del
sistema e dall'interfaccia MIDI; con un e-kit USB in Chrome si aggira in genere
sui ~5–15 ms. Il badge mostra la latenza di uscita riportata dal contesto.

## Scelte di progetto

- **Tag `<script>` classici, niente moduli ES** — i moduli ES sono bloccati su
  `file://`, e "funziona aprendo il file" è un requisito non negoziabile.
- **Prima la sintesi** — i kit integrati sono procedurali: app istantanea,
  leggera e offline; i campioni reali sono un upgrade opzionale in cache.
- **Byte grezzi in IndexedDB** — si salvano gli ArrayBuffer codificati e si
  decodificano in `AudioBuffer` al caricamento: i kit scaricati sopravvivono ai
  reload e funzionano offline.
