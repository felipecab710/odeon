# Odeon DJ Research — Mixxx Technology + Studio Engine

DJ Research (Set Builder, Booth twin, Pioneer UI) uses the **same playback technology
stack as Mixxx 2.5**, implemented on top of Odeon's existing **multi-route native
engine** (`apps/audio-engine`) — not a separate HTML-audio path.

Reference codebase: `/Users/felipecab7/Downloads/mixxx-2.5`

---

## Design principle

| Layer | Mixxx 2.5 | Odeon today | Target |
|-------|-----------|-------------|--------|
| **Audio I/O** | `SoundManager` (Main/Head/Booth) | Tracktion device + `PlaybackEngineSettings` | Same engine, add cue/booth buses |
| **Mixer** | `EngineMixer` + 3 orientation buses | Per-route `VolumePlugin` + master | `OdeonDjMixer` with A/THRU/B buses |
| **Decks** | `EngineDeck` → `EngineBuffer` → `CachingReader` | Timeline clips OR HTML `<Audio>` in Select | 4 independent deck players in engine |
| **Controls** | `CueControl`, `LoopingControl`, `SyncControl` | `PlayerStrip` UI (browser audio) | Engine RPC + Zustand booth store |
| **Waveforms** | Offline `AnalyzerWaveform` + `VisualPlayPosition` | `.odeon.wavecache` + canvas LOD | Already aligned — keep cache-first |
| **UI** | Skins bound to `ControlObject` | React + Zustand + Pioneer twin | Booth store = control bus |

**Rule:** Research/Booth/Select preview decks must converge on `odeon-engine`.
Studio timeline sessions and DJ booth sessions are different *views* over the same
engine primitives (routes, clips, mixer, transport).

---

## Mixxx → Odeon mapping

### Deck player (per CDJ)

```
Mixxx                          Odeon (target)
─────────────────────────────────────────────────────
PlayerManager                  DjSession (4 deck slots)
Deck                           OdeonRoute role=deck
EngineBuffer                   DeckPlayer (rate, seek, keylock)
CachingReader + ReadAhead      Tracktion disk streaming + hint API
CueControl / HotcueControl     setDeckCue / jumpDeckHotcue RPC
LoopingControl                 setDeckLoop RPC
SyncControl + EngineSync       DjSyncCoordinator (leader/follower BPM)
```

Mixxx refs:
- `src/mixer/playermanager.cpp` — 4 decks max
- `src/engine/enginebuffer.h` — playback brain
- `src/engine/cachingreader/cachingreader.h` — async decode + hints
- `src/engine/controls/cuecontrol.h` — hot cues

### Mixer (DJM-A9)

```
Mixxx                          Odeon (target)
─────────────────────────────────────────────────────
EngineMixer                    OdeonDjMixer (inside OdeonSession)
EngineXfader (constant-power)  deckMixEngine.crossfaderWeight()
LEFT / CENTER / RIGHT assign   CfAssign A / THRU / B
PFL (headphone cue)            RouteRole::bus "headphones" + PFL tap
EqualizerEffectChain           per-deck EQ plugin chain (3-band + filter)
ChannelMixer (ramped gain)     ramped volume to avoid clicks
```

Mixxx refs:
- `src/engine/enginemixer.h` — main/head/booth buffers
- `src/engine/enginexfader.cpp` — crossfader curves
- `src/engine/channels/enginechannel.h` — `setPfl()`, orientation

### Multi-channel output

Mixxx `SoundManager` output types:
`Main`, `Headphones`, `Booth`, `Deck`, `Microphone`, `Auxiliary`

Odeon Studio already has:
- `OdeonRoute` graph with `RouteRole::bus` (unused, ready for cue/booth)
- `PlaybackEngineSettings` with device/buffer/disk-cache (Settings view)
- Per-route metering @ 20 Hz (`trackMeters` events)

**Target:** `EngineMixer::process()` produces `m_main`, `m_head`, `m_booth` —
map to Tracktion aux buses or multi-output device paths.

---

## What Odeon already has (Mixxx-aligned)

### Select `PlayerStrip` (UI patterns, not engine yet)
Mirrors Mixxx `CueControl`, `LoopingControl`, waveform modes (RGB/HSV/Simple).
**Migration:** replace `<Audio>` with deck RPC once `createDeck` lands in engine.

Files:
- `apps/desktop/src/components/select/PlayerStrip.tsx`
- `apps/desktop/src/components/select/WaveformRenderer.tsx` — Mixxx algorithms

### Booth / Set Builder (visual + partial engine)
- `boothStore.ts` — 4-deck + DJM state (Mixxx control-bus equivalent)
- `boothSimulation.ts` — automation driver (→ `SyncControl` + xfader)
- `deckMixEngine.ts` — constant-power crossfader (→ `EngineXfader`)
- `useSetEngineSync.ts` — loads set lanes as timeline clips (**interim**)

**Interim limitation:** set preview uses overlapping timeline clips, not true
independent deck players. This is why play/sync feels DAW-like, not CDJ-like.

### Studio multi-channel engine
- `OdeonSession` — session owns transport + route graph
- `createTrack` / `addClip` / `setTrackVolume` / `muteTrack` / `soloTrack`
- `RouteRole::bus` reserved for group/cue routing
- `docs/AUDIO_ENGINE.md` — route-graph model (Ardour-style, compatible with Mixxx bus thinking)

---

## Engine ownership (views)

| Nav view | Engine project | Sync hook |
|----------|---------------|-----------|
| **Studio** | `project.id` (DAW session) | `useEngineSync` |
| **Research** (Nodes/Studio/Booth) | `odeon-set-preview` | `useSetEngineSync` |

Never run both sync hooks simultaneously — `createSession` disposes the prior session.

---

## Implementation phases

### Phase A — Shared types + control bus (desktop)
- [x] `boothStore` — 4 decks + DJM mixer state
- [x] `deckMixEngine` — xfader math (Mixxx `EngineXfader`)
- [ ] `packages/shared/src/dj-types.ts` — deck/mixer/sync types shared with engine protocol
- [ ] Unify `PlayerStrip` hot-cue/loop state shape with booth deck state

### Phase B — True deck players (engine) — in progress
Added to `engine-protocol.ts` + `OdeonSession` + Booth `useDjEngineSync`:

```
createDjSession({ numDecks: 4 })     ✓
loadDeck(deckId, filePath)           ✓
deckSeek / deckSetRate               ✓
getDjState                           ✓
deckPlay / deckPause                 → shared transport (play/pause)
deckSetHotcue / deckJumpHotcue / deckSetLoop   (pending)
setDeckEq / setDeckFilter            (pending — Phase C)
setCrossfader / setDeckOrientation   → desktop deckMixEngine (pending engine DSP)
setPflDeck / setHeadMix              (pending — Phase C)
```

Each deck = `OdeonRoute` with `role=deck`, own `EngineBuffer`-equivalent
(Tracktion clip at position 0, rate scalar, not timeline arrangement).

### Phase C — DJ mixer DSP (engine)
- 3-bus crossfader (`EngineMixer` pattern)
- Per-deck `EqualizerEffectChain` (always-on 3-band)
- Separate `m_head` mix with `head_mix` blend
- Booth monitor tap

### Phase D — Sync + Research AI
- `DjSyncCoordinator` — leader deck, BPM propagate (Mixxx `EngineSync`)
- MOSS transition plans drive `SyncControl` + xfader automation
- `VisualPlayPosition` — interpolate playhead between 20 Hz engine events for CDJ screens

### Phase E — Retire interim paths
- Remove HTML `<Audio>` from `PlayerStrip`
- Replace `useSetEngineSync` timeline clips with 4-deck load for booth preview
- Single waveform cache pipeline (already shared)

---

## File map (Odeon)

| Concern | Path |
|---------|------|
| Booth UI | `apps/desktop/src/components/booth/` |
| Booth state | `apps/desktop/src/stores/boothStore.ts` |
| Simulation | `apps/desktop/src/lib/boothSimulation.ts` |
| Xfader math | `apps/desktop/src/lib/deckMixEngine.ts` |
| Set→engine sync (interim) | `apps/desktop/src/lib/useSetEngineSync.ts` |
| Select deck UI | `apps/desktop/src/components/select/PlayerStrip.tsx` |
| Waveform (Mixxx modes) | `apps/desktop/src/components/select/WaveformRenderer.tsx` |
| Engine session | `apps/audio-engine/src/OdeonSession.{h,cpp}` |
| Route graph | `apps/audio-engine/src/OdeonRoute.h`, `OdeonDomain.h` |
| Protocol | `packages/shared/src/engine-protocol.ts` |
| Shared DJ types | `packages/shared/src/dj-types.ts` |

---

## Mixxx files to keep open while building

```
mixxx-2.5/src/engine/enginemixer.cpp       — main/head/booth mix
mixxx-2.5/src/engine/enginexfader.cpp      — crossfader curves
mixxx-2.5/src/engine/enginebuffer.h        — deck playback
mixxx-2.5/src/engine/controls/cuecontrol.h   — hot cues
mixxx-2.5/src/engine/controls/loopingcontrol.h
mixxx-2.5/src/engine/sync/enginesync.h     — beat sync
mixxx-2.5/src/waveform/visualplayposition.h — playhead interpolation
mixxx-2.5/src/analyzer/analyzerwaveform.h  — offline waveform
```
