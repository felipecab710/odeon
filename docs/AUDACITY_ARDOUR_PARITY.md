# Audacity & Ardour Parity Analysis

Deep comparison of Odeon against **Audacity** (local: `~/Downloads/audacity-master`, AU3 engine + AU4 Qt shell) and **Ardour** (GitHub source — local checkout was an empty stub; analysis via upstream `Ardour/ardour`).

Odeon’s strengths (Set Builder, Booth twin-deck, MOSS transitions, catalog intelligence, wavecache display, native GPU timeline) are out of scope here — this doc lists **gaps** and the execution backlog to reach parity on classic DAW workflows.

---

## Summary

| Area | Audacity | Ardour | Odeon today | Gap severity |
|------|----------|--------|-------------|--------------|
| Non-destructive multitrack | Partial (AU3 clips) | Full | Set Builder + stems | Medium |
| Recording | Full | Full | None | **Critical** |
| Plugin hosting (VST/LV2/AU) | Full + Nyquist | Full | Tracktion internal only | **Critical** |
| Realtime + offline FX | Full | Full | Limited / none in UI | High |
| Import/export formats | FFmpeg breadth | Many + stems | WAV-focused | High |
| Label / locator system | Labels track | Locations | Set locators ✅ | Low |
| Time-range export | Selection export | Range + stems | `renderMix` range ✅ (new) | Medium |
| Automation | Envelope + macro | Read/write/touch/latch | None in UI | **Critical** |
| Comping / playlists | N/A | Full | None | High |
| Routing matrix | Basic | Sends/VCAs/PFL | Aux send/PFL partial | High |
| MIDI + tempo map | N/A | Full | None | High |
| Spectral edit | Full | Partial | None | Medium |
| Undo history | SQLite project | Session undo | Set undo only | Medium |
| PDC / latency comp | Basic | Full | Engine implicit | Medium |

**Estimated parity:** ~35% Audacity workflow, ~30% Ardour workflow, ~78% DJ set-building (unchanged).

---

## Audacity — Missing in Odeon

### Recording & monitoring
- [ ] Multi-track record arm per track
- [ ] Input device / channel selection per track
- [ ] Punch in/out on timeline selection
- [ ] Timer record / sound-activated record
- [ ] Software monitoring latency compensation

### Destructive & spectral editing
- [ ] Cut / copy / paste / split on sample selection
- [ ] Spectrogram view + spectral selection tools
- [ ] Noise reduction, click removal, repair effects
- [ ] Amplitude envelope per clip (Audacity envelope tool)

### Effects & analysis
- [ ] Built-in effect suite (EQ, compressor, normalize, etc.)
- [ ] Nyquist scripting
- [ ] VST3 / LV2 / AU / LADSPA plugin scan + chain UI
- [ ] Realtime effect preview vs offline apply
- [ ] Plot spectrum, find clipping, loudness analysis

### Import / export
- [ ] FFmpeg import (MP3, AAC, OGG, FLAC, etc.)
- [ ] Batch export / chains
- [ ] Export multiple formats in one pass
- [ ] Metadata (ID3, etc.)
- [x] Export time selection → `renderMix(startSeconds, endSeconds)` (Phase J)

### Labels & markers
- [x] Point markers on timeline (Set locators)
- [x] Import/export Audacity label text format (Phase J)
- [ ] Label-linked selection + snap to labels
- [ ] Region labels (start/end pairs) as first-class objects

### Project & undo
- [ ] SQLite project file with full edit history
- [ ] Crash recovery autosave
- [ ] Import raw / label-only projects

---

## Ardour — Missing in Odeon

### Session & transport
- [ ] Session templates (recording / mixing / mastering)
- [ ] Count-in bars/beats wired to engine
- [ ] External sync (MTC/LTC/MIDI clock)
- [ ] Varispeed / master pitch

### Routing & mixing
- [ ] Full send/return matrix UI (bus:booth/headphones exist; matrix missing)
- [ ] VCA groups
- [ ] Monitor section (dim, mono, cut)
- [ ] Surround / multibus panner
- [ ] Plugin sidechain routing UI

### Recording & editing
- [ ] Record enable + disk streaming
- [ ] Playlists per track (multiple takes)
- [ ] Comping UI (take lanes, promote)
- [ ] Crossfade editor on overlaps
- [ ] Ripple / roll edit modes

### Automation
- [ ] Automation modes: Off / Read / Write / Touch / Latch
- [ ] Lane per parameter (volume, pan, plugin params)
- [ ] Evoral-style curve editing on timeline

### MIDI & tempo
- [ ] MIDI tracks + piano roll
- [ ] Tempo map (ramp, odd meters)
- [ ] MIDI export in bounce

### Export
- [x] Export marked time range (Phase J)
- [ ] Export per-track stems in one dialog
- [ ] Export with realtime vs offline toggle
- [ ] Silence trim + peak/RMS normalize options in UI
- [ ] Import/export Ardour locations file

### Plugins
- [ ] LV2 / VST3 / AU scan UI
- [ ] Plugin manager (Favorites, blacklist)
- [ ] Plugin latency/PDC display

---

## Odeon-only advantages (keep investing)

- DJ set card model + MOSS transition engine
- Booth twin-deck simulation with engine-accurate preview
- Catalog / Select intelligence (BPM, key, stems)
- Wavecache-only display (ADR-0004) — fast zoom
- Native Metal/wgpu timeline spike

---

## Execution backlog (Phases J–P)

### Phase J — Export & labels ✅ (this batch)
| Item | Status |
|------|--------|
| `renderMix` time range + peak normalize | ✅ |
| Export Selection in TopBar | ✅ |
| Audacity label import/export for set locators | ✅ |
| Set edit range from locator → next locator | ✅ |

### Phase K — Recording foundation
- Engine RPC: `setRecordEnable`, `startRecording`, `stopRecording`
- Track input routing from `listAudioDevices`
- Record arm UI on track headers
- Punch on edit selection

### Phase L — Routing matrix
- Send level UI per track → aux buses
- Monitor bus dim/mono
- VCA group stub (solo-safe)

### Phase M — Automation v1
- Volume/pan automation lanes (read-only first)
- Write touch on fader drag during play
- Serialize automation in set JSON

### Phase N — Import breadth
- FFmpeg bridge for MP3/FLAC import
- Stem batch import progress UI

### Phase O — Plugin UI
- Tracktion plugin list + insert slot UI
- Preset save/load

### Phase P — Comping / playlists
- Take lanes on record
- Comp region promote

---

## Reference paths

| Repo | Path | Notes |
|------|------|-------|
| Audacity | `~/Downloads/audacity-master` | Valid AU3/AU4 tree |
| Ardour | `git clone https://github.com/Ardour/ardour.git` | Local folder was README-only stub |

Related: [DAW_COMPARISON.md](./DAW_COMPARISON.md), [PARITY_PLAN.md](./PARITY_PLAN.md), [PERFORMANCE_PLAN.md](./PERFORMANCE_PLAN.md).
