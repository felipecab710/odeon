# DAW Feature Comparison: Ableton · Audacity · Pro Tools · Odeon

Last updated: after metronome, export bounce, loop-from-selection, clip trim.

Odeon is a **DJ-aware DAW** — not a clone of any single product. This document maps industry-standard capabilities to our stack and defines the execution plan using the best available technology in our architecture (Tracktion Engine + native sidecar + Python analysis + Metal GPU timeline).

## Technology stack (Odeon)

| Layer | Technology | Role |
|-------|------------|------|
| Playback / mix / render | **Tracktion Engine** (C++, JUCE) | Route graph, transport, plugins, offline bounce |
| UI | **Tauri + React** | Studio, Select, Research, Settings |
| Analysis / AI | **FastAPI + librosa + Demucs + RunPod** | LUFS, stems, MixMoves, MOSS transitions |
| Waveforms | **`.odeon.wavecache` v2** (NumPy sidecar) | All display — never live decode in UI |
| Native timeline | **`odeon-timeline` crate** (wgpu/Metal) | Set Builder GPU strips + clips + automation |
| DJ model | **Mixxx-aligned** deck players + DJM strip | 4-deck Booth, constant-power crossfader |

---

## Summary scorecard

| Category | Ableton Live 12 | Audacity 3 | Pro Tools 2024 | Odeon |
|----------|-----------------|------------|----------------|-------|
| Timeline / arrangement | ●●●●● | ●●○○○ | ●●●●● | ●●●○○ |
| Transport | ●●●●● | ●●●●○ | ●●●●● | ●●●○○ |
| Mixer / routing | ●●●●● | ●●○○○ | ●●●●● | ●●○○○ |
| Audio editing | ●●●●○ | ●●●●● | ●●●●● | ●●○○○ |
| Recording | ●●●●● | ●●●●● | ●●●●● | ○○○○○ |
| MIDI | ●●●●● | ●●○○○ | ●●●●● | ○○○○○ |
| Plugins (VST/AU) | ●●●●● | ●●●○○ | ●●●●● | ●○○○○ |
| Automation | ●●●●● | ●●○○○ | ●●●●● | ●●●○○ |
| Export / bounce | ●●●●● | ●●●●● | ●●●●● | ●●○○○ |
| DJ / performance | ●●●●● | ○○○○○ | ○○○○○ | ●●●●○ |
| Analysis / AI | ●○○○○ | ●●○○○ | ●●○○○ | ●●●●● |

Legend: ● = full · ◐ = partial · ○ = missing

**Odeon overall: ~54% of a general-purpose DAW, ~78% of DJ set-building target.**

---

## 1. Timeline & arrangement

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Multitrack lanes | Session + Arrangement | Label tracks | Playlists | Studio + Set Builder | ✅ |
| Clip regions | Audio/MIDI clips | Waveform selection | Regions | Set Cards + engine clips | ✅ / ◐ |
| Beat grid + snap | ● | ◐ | ● | Set Builder beat snap | ✅ |
| Zoom / scroll | ● | ● | ● | Anchor zoom, minimap, native GPU | ✅ |
| Locators / markers | Locators | Labels | Memory locations | Set locators (localStorage) | ✅ |
| Clip drag | ● | ◐ | ● | DOM + native GPU | ✅ |
| Clip resize / trim | ● | ● | ● | Right-edge trim (Set Builder) | ✅ (new) |
| Comping / take lanes | ◐ | ○ | ● | Cosmetic UI only | ❌ |
| Ripple / shuffle edit | ● | ◐ | ● | — | ❌ |
| Folder / VCAs | Groups | — | VCA / folders | Track groups (Studio) | ◐ |
| Elastic audio / warp | ● | ◐ | Elastic Audio | — | ❌ |
| Session view (launch) | ● | — | — | Node graph (Set cards) | ◐ |

**Best technology for gaps:** Tracktion `WarpTime` + `tempoSequence` for elastic audio; TE clip launcher for non-linear performance; native comp playlists via TE take folders.

---

## 2. Transport

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Play / pause / stop | ● | ● | ● | Engine RPC | ✅ |
| Seek / scrub | ● | ● | ● | Engine + edit cursor | ✅ |
| Loop region | ● | ● | ● | Edit selection → loop | ✅ (new) |
| Metronome / click | ● | ◐ | ● | TE click track RPC | ✅ (new) |
| Count-in | ● | — | ● | UI only | ◐ |
| Record | ● | ● | ● | Button placeholder | ❌ |
| Punch in/out | ● | ◐ | ● | — | ❌ |
| Pre-roll / post-roll | ● | — | ● | — | ❌ |
| Tap tempo | ● | — | ● | — | ❌ |
| Link / MTC / MIDI clock | ● | — | ● | — | ❌ |

**Best technology for gaps:** Tracktion `InputDevice` + `TransportControl` record APIs; `EditPlaybackContext` for punch; Ableton Link via TE module (licensed separately).

---

## 3. Mixer & routing

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Channel fader / pan | ● | ● | ● | Pro Tools scale faders | ✅ |
| Mute / solo | ● | ● | ● | Exclusive solo + groups | ✅ |
| 3-band EQ + filter | ● | ◐ | ● | TE EqualiserPlugin on DJ routes | ✅ |
| Crossfader (DJ) | ● | — | — | Mixxx constant-power | ✅ |
| PFL / cue | ● | — | ● | AuxSend → Headphones bus | ✅ |
| Aux sends / returns | ● | ◐ | ● | RPC + TE plugins; no UI matrix | ◐ |
| Main / HP / Booth buses | ● | — | ● | bus:headphones, bus:booth | ◐ |
| VCA / group faders | ● | — | ● | Track groups (Studio) | ◐ |
| Surround / Atmos | ● | ◐ | ● | Stereo only | ❌ |
| Metering (peak/RMS) | ● | ● | ● | Engine poll → UI | ✅ |
| Send matrix UI | ● | — | ● | — | ❌ |

**Best technology for gaps:** Full Mixxx `EngineMixer` bus graph on TE aux buses; React send matrix bound to `setRouteAuxSend`; ADR-0007 completion.

---

## 4. Audio editing

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Cut / copy / paste | ● | ● | ● | Set Builder undo only | ◐ |
| Fade in/out handles | ● | ● | ● | Transition curves only | ◐ |
| Normalize / gain | ● | ● | ● | Trim + fader | ✅ |
| Time stretch | ● | ◐ | ● | Deck rate only | ◐ |
| Pitch shift | ● | ◐ | ● | — | ❌ |
| Spectral edit | ◐ | ● | ◐ | — | ❌ |
| Noise reduction | ◐ | ● | ◐ | — | ❌ |
| Undo / redo | ● | ● | ● | Set Builder domain | ◐ |

**Best technology for gaps:** Tracktion clip fade curves; Rubber Band / Elastique (licensed) for stretch; TE `Edit` clipboard APIs.

---

## 5. Recording

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Audio record to track | ● | ● | ● | — | ❌ |
| MIDI record | ● | ◐ | ● | — | ❌ |
| Input monitoring | ● | ● | ● | — | ❌ |
| Multi-take / playlists | ◐ | ◐ | ● | — | ❌ |
| Automation record (mix) | ● | — | ● | Set Builder latch record | ✅ |

**Best technology:** Tracktion `InputDevice` record + `Edit` track record enable; disk writer on `audio/renders/` in Odeon Project folder.

---

## 6. MIDI

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| MIDI clips | ● | ◐ | ● | — | ❌ |
| Piano roll | ● | — | ● | — | ❌ |
| Quantize / groove | ● | — | ● | — | ❌ |
| MPE | ● | — | ● | — | ❌ |
| MIDI effects | ● | — | ● | — | ❌ |

**Best technology:** Tracktion Engine MIDI clip + step clip modules (vendor-ready); React piano roll component; no shortcuts — full TE integration required.

---

## 7. Plugins & FX

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Built-in EQ / dynamics | ● | ● | ● | TE EQ on routes (hidden) | ◐ |
| VST3 / AU hosting | ● | ◐ | ● | TE supports; no Odeon UI | ◐ |
| Plugin scan / browser | ● | ◐ | ● | — | ❌ |
| Sidechain | ● | — | ● | — | ❌ |
| Rack / chain UI | ● | — | ● | — | ❌ |

**Best technology:** Tracktion `PluginList` + JUCE format managers; Odeon plugin browser as React panel with TE RPC for insert/bypass/automation.

---

## 8. Automation

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Draw automation | ● | ◐ | ● | Set Builder lanes | ✅ |
| Record automation | ● | — | ● | Latch record (Set) | ✅ |
| Read / write / touch / latch | ● | — | ● | Global enable only | ◐ |
| Engine-native curves | ● | — | ● | localStorage + UI push | ◐ |
| GPU curve display | — | — | — | Native Metal renderer | ✅ |
| Per-parameter lanes | ● | — | ● | Volume/EQ/filter/CF | ✅ |

**Best technology:** Tracktion `AutomatableParameter` + `AutomationCurve` persisted in `project.odeon`; eliminate UI-only push loop.

---

## 9. Export & render

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Export selection | ● | ● | ● | — | ◐ |
| Bounce mix | ● | ● | ● | `renderMix` + Export Audio UI | ✅ (new) |
| Stem export | ● | ◐ | ● | Demucs (API); no UI | ◐ |
| Format options | ● | ● | ● | WAV only (TE renderer) | ◐ |
| Mix Blueprint JSON | — | — | — | Analysis export | ✅ |
| Offline with automation | ● | — | ● | Needs engine curves | ◐ |

**Best technology:** Tracktion `Renderer::renderToFile` (in use); extend with selection range + TE automation curves; MP3/FLAC via JUCE encoders.

---

## 10. DJ & performance (Odeon differentiator)

| Feature | Ableton | Serato/Traktor | Odeon | Status |
|---------|---------|----------------|-------|--------|
| 4-deck players | ◐ (2+2) | ● | TE deck players | ✅ |
| Hot cues / loops | ● | ● | Engine RPC + UI | ✅ |
| Beat sync | ● | ● | UI coordinator (partial) | ◐ |
| Crossfader | ● | ● | Mixxx math + engine | ✅ |
| Waveform (RGB/HSV) | ◐ | ● | Mixxx modes in Select | ✅ |
| Booth twin UI | — | — | Pioneer schematic | ✅ |
| MOSS transitions | — | — | AI + automation | ✅ |
| Set arrangement | ● Session | — | Set Builder | ✅ |
| True deck preview | ● | ● | Timeline clips (interim) | ◐ |

**Best technology:** Retire ADR-0006 — Set preview via `useDjEngineSync` + bus crossfader graph; `EngineSync` beat phase lock.

---

## 11. Analysis & AI (Odeon differentiator)

| Feature | Ableton | Audacity | Pro Tools | Odeon | Status |
|---------|---------|----------|-----------|-------|--------|
| Loudness / spectrum | ◐ | ● | ● (SoundID) | Full analysis pipeline | ✅ |
| Stem separation | ◐ | ◐ | ◐ | Demucs abstraction | ◐ |
| Reference comparison | — | ◐ | ◐ | MixMoves + Compare panel | ✅ |
| Transition intelligence | — | — | — | MOSS + 1001TL graph | ✅ |
| Catalog / compatibility | — | — | — | Select view | ✅ |

---

## Execution plan (no shortcuts)

Phases ordered by dependency and product value. Each phase uses the **best technology** named above — no HTML audio fallbacks, no fake meters, no UI-only routing.

### Phase H — Transport & export foundation ✅ (this commit)

- [x] Tracktion click track via `setClickTrack` RPC
- [x] Session tempo via `setSessionTempo` RPC
- [x] Loop from edit selection (Pro Tools–style)
- [x] Export Audio UI → `Renderer::renderToFile`
- [x] Set Card duration trim (native + DOM)

### Phase I — Routing completion (2–3 weeks)

1. Send matrix UI → `setRouteAuxSend` (Headphones/Booth/custom)
2. Booth monitor path to separate output device (TE `OutputDevice`)
3. Head mix / booth level RPCs (`setHeadMix`, `setBoothLevel`)
4. Complete ADR-0007 main/HP/booth summing

**Tech:** Tracktion AuxSend/AuxReturn + `Edit::setAuxBusName`; React signal-flow panel.

### Phase J — Set preview truth (2 weeks)

1. Retire timeline-clip interim (ADR-0006)
2. Set preview → 4-deck `useDjEngineSync` + bus crossfader
3. `EngineSync` beat phase alignment
4. Visual playhead on all CDJ screens

**Tech:** Existing `OdeonDjDeck` + `deckMixEngine`; Mixxx sync model.

### Phase K — Engine-native automation (2 weeks)

1. Serialize automation to `project.odeon`
2. TE `AutomatableParameter` curves on routes
3. Offline bounce includes automation
4. Read/write/touch/latch modes

**Tech:** Tracktion automation recording + simplification.

### Phase L — Recording (3 weeks)

1. Input device list + route record arm
2. Audio record to route (TE `InputDevice`)
3. Punch in/out
4. Metronome count-in before record

**Tech:** Tracktion record APIs; no Web Audio.

### Phase M — MIDI & plugins (4–6 weeks)

1. MIDI input → TE virtual MIDI
2. MIDI clip + piano roll (React)
3. VST3/AU scan + insert UI
4. Built-in FX browser (TE plugins)

**Tech:** Tracktion Engine MIDI + JUCE plugin formats.

### Phase N — Pro editing (ongoing)

1. Comping / take lanes
2. Elastic audio (Rubber Band license)
3. Clip fade handles
4. Ripple edit
5. A/B matched preview bounce

---

## What Odeon should NOT copy blindly

| Product | Skip | Why |
|---------|------|-----|
| Audacity | Destructive edit as default | Odeon is non-destructive TE session |
| Ableton | Session view as primary | Set Builder + Booth is our model |
| Pro Tools | HDX / DSP dependency | Native CPU + TE graph is our path |
| All | Web Audio playback | ADR-0003/0004 — engine + wavecache only |

---

## References

- `docs/PARITY_PLAN.md` — Set Builder parity tracker
- `docs/ROADMAP.md` — product phases
- `docs/adr/` — architecture decisions
- Tracktion `FEATURES.md` — engine capability ceiling
