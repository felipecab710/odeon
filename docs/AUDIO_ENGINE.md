# Odeon Audio Engine

> A native, route-graph-based, non-destructive multitrack session engine with
> DAW-grade transport, mixer, clips, rendering, persistence, and a native AI
> analysis seam — built on Tracktion Engine + JUCE, conceptually modeled on
> Ardour.

`apps/audio-engine` is a headless C++20 console app. It runs as a **Tauri
sidecar**: the Tauri Rust core spawns it and talks to it with line-delimited
JSON-RPC over stdin/stdout. The React UI never owns audio state — it only
reflects the session.

---

## 1. The core idea: the session owns the truth

The engine is **not** "a waveform player." Its center is the **`OdeonSession`**,
which owns time, the route graph, clips/sources, mixer state, rendering and
persistence. The UI is a projection of the session, not its source of truth.

```
OdeonSession  (the Ardour "Session": owns sample rate, transport, graph, files)
  ├── te::Engine               // Tracktion engine + audio device
  ├── te::Edit                 // the timeline/graph backing store
  ├── te::TransportControl     // play / stop / seek / loop / live playhead
  └── routes_: map<id, OdeonRoute>
        OdeonRoute             (the Ardour "Route": a track IS a path through the mixer)
          ├── te::AudioTrack*  // non-owning; the Edit owns it
          ├── role             // reference | user | analysis | bus | master
          ├── stemType         // drums | bass | vocals | music | ...
          ├── RouteMixState    // volumeDb, pan, mute, solo
          ├── clips[]          // AudioClip: position + source-offset + length
          ├── LevelMeasurer::Client   // lock-free metering tap
          └── analysisEnabled  // native AI seam
```

Source files:
- `src/OdeonDomain.h` — pure data model (enums, `AudioSource`, `AudioClip`,
  `RouteMixState`, `MeterData`) + JSON helpers. No Tracktion types, so it
  serializes cleanly to `project.odeon`.
- `src/OdeonRoute.h` — wraps a `te::AudioTrack` with Odeon semantics + meter
  client + AI seam.
- `src/OdeonSession.{h,cpp}` — the engine itself.
- `src/main.cpp` — JSON-RPC server (message-loop-pumped) and the `--selftest`
  proof harness.

---

## 2. Ardour concept mapping (studied from source, not forked)

Ardour was read read-only as an architectural reference. The patterns it
validated, and where they live in Odeon:

| Ardour concept | Ardour source (reference) | Odeon equivalent |
|---|---|---|
| `Session` owns everything | `session.h` | `OdeonSession` |
| `Route` = track as mixer path | `route.cc`, `graph.h:71-109` | `OdeonRoute` |
| Source → Region → Playlist (non-destructive) | `region.h:138-147` | `AudioSource` → `AudioClip` (position/offset/length) |
| Atomic session save (temp-write + rename, backup first) | `session_state.cc:879-905` | `OdeonSession::writeAtomic()` via `juce::TemporaryFile` + backup |
| RT-safe disk streaming (Butler thread + ring buffers) | `disk_reader.h:63,80` | Tracktion's disk-streaming graph (engine-provided) |
| Missing-file relink | `file_source.cc:233` | `openSession()` relink to `audio/imports/` + `missingSources` count |
| Never write the audio thread's ML/disk work inline | (RT discipline) | meter poll thread + async AI service; nothing heavy on the audio thread |

We **copied concepts, not code**: Odeon stays a clean Tracktion-based engine.

---

## 3. AI as a native subsystem (not a bolt-on)

AI is first-class in the engine, per the product principle "bold AI as a native
thing":

- **`role: "analysis"`** is a real route role. An analysis route is a native tap
  point in the graph.
- **`OdeonRoute::analysisEnabled`** + the **`analyze`** command flag a route and
  emit an async `analysisRequested` event. Heavy ML (Demucs, librosa, Diff-MST)
  runs in the **Python service** (`apps/api`) — **never on the audio thread**.
- Metering already proves the lock-free copy-out discipline: the audio thread
  fills a `LevelMeasurer::Client`; the poll thread reads it without locking the
  audio path. The same seam carries analysis audio in v2.
- Persistence reserves an **`analysis/`** folder in every project for cached
  analysis results as first-class session objects.

---

## 4. Bridge / command API

One JSON object per line on stdin: `{ "id": N, "method": "...", "params": {...} }`.
Responses and async events are one JSON object per line on stdout.

### Session lifecycle
| Method | Params | Notes |
|---|---|---|
| `createSession` / `createProject` | `projectId`, `projectDir?` | Creates the Odeon Project folder + empty edit. |
| `openSession` / `loadProject` | `projectId`, `projectDir?` | Rebuilds routes/clips from `project.odeon`; relinks missing sources. |
| `saveSession` / `saveProject` | — | Atomic write of `project.odeon` (+ backup). |
| `disposeSession` / `disposeProject` | — | Tears down the session. |

### Routes / clips
| Method | Params |
|---|---|
| `createTrack` | `trackId`, `name`, `role`, `stemType` |
| `addClip` / `loadAudioFile` | `trackId`, `clipId?`, `filePath`, `startTimeSeconds` |
| `removeTrack` | `trackId` |

### Transport
| Method | Params |
|---|---|
| `play` / `stop` | — |
| `seek` | `timeSeconds` |
| `setLoop` | `enabled`, `startSeconds`, `endSeconds` |
| `getTransportState` | — → `{ isPlaying, positionSeconds, bpm, looping }` |

### Mixer / meters
| Method | Params |
|---|---|
| `setTrackVolume` | `trackId`, `volumeDb` |
| `setTrackPan` | `trackId`, `pan` (-1..1) |
| `muteTrack` | `trackId`, `muted` |
| `soloTrack` | `trackId`, `soloed` |
| `getTrackMeters` | — → per-route `{ leftDb, rightDb, peakLeftDb, peakRightDb, rmsLeftDb, rmsRightDb }` |

### Render / AI
| Method | Params |
|---|---|
| `renderMix` | `outputFilePath` (→ `audio/renders/`) |
| `analyze` | `trackId` (native AI seam) |

### Async events (stdout, no `id`)
- `engineReady` — engine booted.
- `transportState` — `{ isPlaying, positionSeconds (live playhead), bpm, looping }`, ~20Hz.
- `trackMeters` — `{ meters: { trackId: {…dB…} } }`, ~20Hz.
- `analysisRequested` — a route requested analysis.
- `engineError` — non-fatal error (also appended to `logs/engine.log`).

---

## 5. Playback + threading model

- **Audio thread** (CoreAudio callback, RT): runs the Tracktion graph; fills
  level measurers. No locks, no disk, no ML.
- **Message thread** (= the process main thread): the server loop pumps
  `MessageManager::runDispatchLoopUntil(20)` and reads stdin non-blocking via
  `select()`. This gives playback a stable transport clock independent of React
  timing, while still processing RPC. The **live playhead** is read from
  `EditPlaybackContext::getPosition()`, not the static transport position.
- **Meter poll thread** (50ms): reads lock-free level data and emits
  `transportState` + `trackMeters`.
- **Disk streaming**: handled by Tracktion's butler/ring-buffer graph.

---

## 6. Persistence — the Odeon Project folder

```
<Project>/
  project.odeon          # JSON source of truth (schemaVersion, routes, clips, mix)
  session.tracktionedit  # Tracktion's backing edit file
  audio/
    imports/             # imported source files (never overwritten)
    stems/               # separated stems
    renders/             # bounce output
  analysis/              # cached AI analysis (first-class)
  backups/               # timestamped project.odeon backups
  logs/                  # engine.log
```

- **Atomic writes**: write to a temp file, then `overwriteTargetFileWithTemporary()`
  (rename). The previous `project.odeon` is copied to `backups/` first.
- **Schema version** is stored so future migrations are possible.
- **Sources are never overwritten** — renders go only to `audio/renders/`.
- **Missing-file handling**: `openSession` tries the stored path, then
  `audio/imports/<name>`, and reports a `missingSources` count instead of
  crashing.

---

## 7. Reliability gate — `--selftest`

`odeon-engine --selftest` is the headless proof harness. It exits nonzero on any
failure. Current status: **18/18 gates pass.**

It builds an 8-route session (4 reference + 4 user stems), and verifies:
1. generates 8 test WAVs
2. `createSession`
3. creates 8 routes
4. adds 8 clips at t=0
5. live playback advances (sample-synced) — *skipped automatically when the
   environment has no audio output device; the render check below is the
   device-independent sync proof*
6. seek to 1.0s
7. `setLoop` 0..2s
8. `setTrackVolume`, `setTrackPan`, `muteTrack`, `soloTrack`
9. `getTrackMeters` returns data for all routes
10. renders a stereo bounce **and reads it back**: confirms it is stereo, ~4s,
    and **non-silent** — i.e. all 8 routes were summed through the graph
11. `saveSession` → dispose → reopen with identical route count (8)
12. missing file handled gracefully (returns `ok:false`, no crash)

---

## 8. Build & run

```bash
# Build the native engine (Tracktion + JUCE, C++20)
cd apps/audio-engine
cmake -S . -B build -DCMAKE_BUILD_TYPE=Release -DTE_ADD_EXAMPLES=OFF
cmake --build build --config Release --parallel

# Prove it
./build/odeon_engine_artefacts/Release/odeon_engine --selftest

# The binary is placed for Tauri at:
#   apps/desktop/src-tauri/binaries/odeon-engine-aarch64-apple-darwin

# Build the native macOS app (bundles the engine sidecar):
cd ../desktop
pnpm tauri build      # → src-tauri/target/release/bundle/macos/Odeon.app
# or, for live development:
pnpm tauri dev
```

Requirements that bit us (documented so they don't again):
- Tracktion requires **C++20** (`std::ranges` / concepts). `LANGUAGES C CXX`.
- Use **Tracktion's** `DeviceManager::initialise(0, 2)`, not the raw JUCE device
  manager — otherwise the engine's audio callback is never wired.
- Read the live playhead from `EditPlaybackContext`, not the static transport
  position.

---

## 9. Roadmap (v2 → v4)

- **v2**: real per-sample RMS via a dedicated `OdeonAnalyzerTap` node;
  lock-free copy-out of analysis audio to the Python service; plugin hosting
  (VST3/AU) on routes; automation lanes.
- **v3**: buses/groups (`role: "bus"`), sidechain routing, true non-destructive
  editing UI (trim/split/fade on clips), waveform cache.
- **v4**: matched-preview rendering driven by MixMoves, reference/user A/B
  bus, multi-format export, project-level undo/redo across the route graph.
