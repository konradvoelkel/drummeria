#!/usr/bin/env python3
"""
Build local sample kits from github.com/geikha/tidal-drum-machines.

That collection (~70 classic drum machines, the one Strudel uses) states no
license, so nothing it produces is committed: output goes to kits/local/,
which is gitignored, and app.js picks up kits/local/index.json on startup.

    git clone --depth 1 https://github.com/geikha/tidal-drum-machines /tmp/tdm
    python3 tools/import_tidal_drum_machines.py /tmp/tdm kits/local

Each machine folder holds <machine>-<sound>/ subfolders (bd, sd, hh, …); the
first take of each sound becomes that slot's sample.
"""
import json, os, re, shutil, sys

src, dst = sys.argv[1], sys.argv[2]
SLOTS = {'bd': 'kick', 'sd': 'snare', 'cp': 'clap', 'rim': 'rim', 'hh': 'hihat_closed',
         'oh': 'hihat_open', 'lt': 'tom_low', 'mt': 'tom_mid', 'ht': 'tom_high',
         'cr': 'crash', 'rd': 'ride', 'cb': 'cowbell'}
CHOKE = {'hihat_closed': 'hihat', 'hihat_pedal': 'hihat', 'hihat_open': 'hihat', 'crash': 'crash'}

def pretty(name):
    n = re.sub(r'(?<=[a-z])(?=[A-Z0-9])', ' ', name)
    return re.sub(r'(?<=[A-Z])(?=[A-Z][a-z])', ' ', n)

index = []
os.makedirs(dst, exist_ok=True)
for machine in sorted(os.listdir(os.path.join(src, 'machines'))):
    mdir = os.path.join(src, 'machines', machine)
    if not os.path.isdir(mdir):
        continue
    instruments = {}
    for sub in sorted(os.listdir(mdir)):
        suffix = sub.rsplit('-', 1)[-1]
        slot = SLOTS.get(suffix)
        sdir = os.path.join(mdir, sub)
        if not slot or not os.path.isdir(sdir):
            continue
        wavs = sorted(f for f in os.listdir(sdir)
                      if f.lower().endswith('.wav') and os.path.isfile(os.path.join(sdir, f))
                      and not os.path.islink(os.path.join(sdir, f)))
        if not wavs:
            continue
        rel = sub + '/' + wavs[0]                # first take of each sound
        os.makedirs(os.path.join(dst, machine, sub), exist_ok=True)
        shutil.copyfile(os.path.join(sdir, wavs[0]), os.path.join(dst, machine, rel))
        instruments[slot] = {'choke': CHOKE.get(slot), 'layers': [{'file': rel}]}
    if 'kick' not in instruments or 'snare' not in instruments and 'clap' not in instruments:
        shutil.rmtree(os.path.join(dst, machine), ignore_errors=True)
        continue
    if 'hihat_closed' in instruments:              # pedal "chick" = closed hat, softer
        instruments['hihat_pedal'] = {'choke': 'hihat', 'layers': [
            dict(instruments['hihat_closed']['layers'][0], gain=0.6)]}
    kid = 'local/' + machine
    manifest = {'id': kid, 'name': pretty(machine), 'category': 'drum machine',
                'tune': 0, 'instruments': instruments,
                '_source': 'github.com/geikha/tidal-drum-machines (no license stated; local use only)'}
    with open(os.path.join(dst, machine, 'kit.json'), 'w') as f:
        json.dump(manifest, f, indent=2)
    index.append({'id': kid, 'name': pretty(machine) + ' ★'})

with open(os.path.join(dst, 'index.json'), 'w') as f:
    json.dump({'_comment': 'Generated locally from tidal-drum-machines; not committed.', 'kits': index}, f, indent=2)
print(len(index), 'kits')
