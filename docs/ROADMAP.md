# Roadmap

## Phase 1 — DAW-Style Playback + Analysis + Comparison (Current)

**Goal**: The first magical workflow.
Upload reference → Odeon creates DAW-style tracks → play in sync → import my stems → compare → get MixMoves.

- [x] Monorepo scaffolding
- [x] Shared TypeScript types + Pydantic models
- [x] FastAPI analysis service
- [x] Audio analysis: LUFS, true peak, RMS, crest factor, frequency profile (7 bands), stereo profile, tempo, section energy
- [x] Stem separation abstraction (NoOp + Demucs)
- [x] Track comparison + MixMove generation (level, EQ, stereo, pan, compression, reverb placeholder)
- [x] Mix Blueprint JSON export
- [x] Tauri + React desktop app
- [x] DAW-style UI: top bar, transport, track lanes, timeline ruler, mixer channels, inspector, comparison + mix moves panels
- [x] C++ audio engine (Tracktion Engine + JUCE)
- [x] JSON-RPC stdio sidecar protocol
- [x] Tauri sidecar bridge (all bridge commands wired)
- [x] Play / stop / seek
- [x] Mute / solo / volume / pan (UI + engine)
- [x] Level meters

---

## Phase 1B — Native Engine + Wavecache + Select (Shipped)

- [x] `.odeon.wavecache` v2 binary sidecar (NumPy pyramid, all levels, no bucket cap)
- [x] Binary parser on desktop (ArrayBuffer, `DataView`, LOD tile blitting)
- [x] Throttled prefetch (max 3 concurrent sidecar loads)
- [x] `shouldUseFinePeaks` threshold fixed (`spp < lodBlockSize`, not `spp < 8192`)
- [x] Path2D envelope rendering (single fill + stroke per channel per tile)
- [x] Tile-based bitmap cache (512px tiles, `blitVisibleTiles` scroll model)
- [x] WaveformCanvas decoupled from `AudioBuffer` / `webAudioEngine`
- [x] `bufferCache.ts` deleted; `useTrackBuffer.ts` deleted
- [x] Native engine `pause` RPC (preserve playhead; distinct from `stop`)
- [x] Native engine `moveClip`, `setMasterVolume`, `notifyTracksReady`
- [x] `transportStore` routes play/pause/stop/seek/loop → `engineClient`
- [x] `webAudioReady` gating removed; `engineTracksReady` gate added
- [x] `webAudioEngine.ts` + `useWebAudioSync.ts` deleted
- [x] `Mixer.tsx`, `TrackLane.tsx`, `trackGroupStore.ts` cleaned of Web Audio calls
- [x] `useEngineSync` pushes initial mix state + handles clip position change
- [x] `NavBar` + navigation shell (studio / select / research / settings)
- [x] `SelectHome`, `CatalogTable`, `TrackProfilePanel` (waveform preview via v2 sidecar)
- [x] `/select/*` FastAPI router (import, analyze, tags, collections, compatibility, stats)
- [x] `estimate_key_placeholder` (chroma CQT key estimation)
- [x] Placeholder `reference_stem` tracks with "Stem separation pending" label
- [x] `WAVEFORM_CACHE.md` + `ODEON_SELECT.md` documentation

---

## Phase 2 — Stems + Better Rendering

- [ ] Demucs stem separation active end-to-end (install demucs, trigger on reference upload)
- [ ] Reference stem tracks shown in timeline after separation
- [ ] Stem-level analysis per separated stem
- [ ] Timeline clip resize / move
- [ ] Better section detection (onset-based, not just energy chunking)
- [ ] Render output saved to audio/renders/ and playable in app
- [ ] Windows / Linux cross-platform sidecar builds

---

## Phase 3 — Section-Aware Comparison + A/B

- [ ] Section detection with real beat tracking (librosa)
- [ ] Compare drop-to-drop, verse-to-verse, intro-to-intro
- [ ] A/B playback toggle (Reference vs My Mix)
- [ ] Matched preview render: apply estimated gain/pan/EQ approximations to user tracks and render a comparison bounce
- [ ] Reference vs user waveform overlay in timeline
- [ ] Timeline zoom + scroll
- [ ] Export as Audio: render the matched preview as a downloadable WAV

---

## Phase 4 — Differentiable Mixing (Research → Product)

- [ ] Train DMC controller (Diff-MST architecture) on MUSDB18-HQ or MoisesDB
- [ ] Inference: reference + user stems → predicted parameter dicts
- [ ] Show DMC predictions alongside rule-based MixMoves in the AI panel
- [ ] User can accept/reject each predicted parameter
- [ ] Compression estimation: use crest factor delta + spectral shape to estimate comp settings
- [ ] Reverb estimation: RT60 proxy from decay tail analysis
- [ ] Confidence improvement: track-specific uncertainty quantification

---

## Phase 5 — DAW Export + Plugin Version

- [ ] REAPER ReaScript export: generate a .rpp session with predicted FX chains
- [ ] Ableton Live preset export: generate device presets
- [ ] Logic Pro channel strip export (when API allows)
- [ ] JUCE plugin version of the analysis engine (VST3/AU)
- [ ] Host the MixBlueprint analysis as a cloud service (optional)
- [ ] MixAssist: audio-language explanations (convert measurements into producer-facing coaching copy)
