# Odeon

**Reference-aware AI mixing workbench for music producers.**

Odeon estimates plausible mix characteristics from a reference song, creates DAW-style tracks, and generates human-editable, DAW-ready mix moves that move your stems closer to the reference.

> Odeon does not recover the exact original engineer's plugin chain, does not know which plugins were used, and does not claim to create a finished professional mix. It estimates mix characteristics and creates actionable guidance.

---

## What Odeon Does

1. Upload a reference WAV → Odeon creates a DAW-style session
2. Odeon splits the reference into stems (drums, bass, vocals, other)
3. Import your own stems (My Drums, My Bass, My Vocals, My Synths…)
4. Odeon plays all tracks sample-synced in a DAW-style interface
5. Odeon compares your stems against the reference stems
6. Odeon generates MixMoves: level, EQ, compression, stereo, pan, reverb guidance
7. Export a Mix Blueprint JSON with all analysis and editable parameters

---

## Architecture

Three processes, strict separation of concerns:

| Process | Stack | Responsibility |
|---------|-------|---------------|
| `apps/desktop` | Tauri v2 + React + TypeScript + Tailwind | UI, file management |
| `apps/api` | Python FastAPI + SQLite | Audio analysis, comparison, MixMove generation |
| `apps/audio-engine` | C++ / Tracktion Engine + JUCE | Native sample-synced playback, rendering |

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for full details.

---

## Running Odeon

### Prerequisites

```bash
# Check installed
node --version      # Need ≥ 20
python3 --version   # Need ≥ 3.12
rustc --version     # Need ≥ 1.70
cmake --version     # Need ≥ 3.22
ffmpeg -version     # Needed by analysis
```

Install missing tools:
```bash
# Rust (if missing)
curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs | sh

# pnpm (if missing)
npm install -g pnpm

# cmake (if missing)
brew install cmake
```

### 1. Python Analysis API

```bash
cd apps/api
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
uvicorn app.main:app --reload --port 8000
```

API runs at http://localhost:8000. Test with:
```bash
curl http://localhost:8000/health
```

### 2. Native Audio Engine (one-time build)

```bash
cd apps/audio-engine
./scripts/build.sh
```

This will:
- Install cmake if missing (via Homebrew)
- Clone the Tracktion Engine + JUCE git submodules
- Configure and build a Release binary
- Place it at `apps/desktop/src-tauri/binaries/odeon-engine-<target-triple>`

First build takes several minutes (downloads JUCE, compiles ~500 source files).

### 3. Desktop App

```bash
cd apps/desktop
pnpm install
pnpm tauri dev
```

The Tauri window opens. The engine sidecar starts automatically.

---

## What Currently Works (Phase 1)

- [x] DAW-style UI: top bar, transport, track lanes, timeline ruler, mixer, inspector, AI moves panel
- [x] Create project
- [x] Upload reference WAV → creates Reference Full Mix track
- [x] Analyze reference: LUFS, true peak, RMS, crest factor, frequency profile (7 bands), stereo profile, tempo estimate, section energy
- [x] Stem separation abstraction: NoOpStemSeparator (default) + DemucsStemSeparator (if `demucs` is installed)
- [x] Import user stems (multiple files)
- [x] Per-track analysis: all the same metrics
- [x] Track comparison: delta computation across all metrics
- [x] MixMove generation: level, EQ, stereo, pan, compression, reverb placeholder
- [x] Mix Blueprint JSON export
- [x] Native audio engine interface (AudioEngineBridge): JSON-RPC protocol over stdio
- [x] Tauri sidecar bridge: all commands wired
- [x] Mute / solo / volume / pan per track (UI + engine)
- [x] Level meters (via engine polling)
- [x] Transport: play, stop, seek (via native engine)

---

## Limitations

- Stem separation requires `demucs` installed separately (`pip install demucs`)
- Reverb analysis is a placeholder — estimated in Phase 3
- Section detection is energy-based heuristic, not ground truth
- Waveform rendering is frequency-profile bars (visual placeholder), not actual waveform
- Engine binary must be built manually once (`./scripts/build.sh`)
- macOS only for this release; Windows/Linux cross-compile in Phase 2

---

## Next Steps

See [docs/ROADMAP.md](docs/ROADMAP.md) for the full phased plan.

Phase 2: Demucs stem separation active, reference stem track creation, waveform rendering.
Phase 3: Section-aware comparison, A/B playback, matched preview render.
Phase 4: Diff-MST-inspired differentiable mixing parameter prediction.
Phase 5: REAPER/Ableton/Logic export, JUCE plugin version.

---

## Repo Structure

```
/odeon
  /apps
    /desktop          Tauri + React + TS desktop app
    /api              Python FastAPI analysis service
    /audio-engine     C++ Tracktion Engine + JUCE audio engine
  /packages
    /shared           Shared TS types + JSON schemas
  /audio              Runtime storage (gitignored user files)
  /research
    /experiments      Python experiments (Diff-MST etc.)
    /references       Research notes
  /docs               Architecture, data model, API, roadmap docs
```

---

## License

Core app code: see LICENSE.
Tracktion Engine: dual GPLv3 / commercial — see [apps/audio-engine/README.md](apps/audio-engine/README.md).
JUCE: requires separate license from juce.com for commercial distribution.
