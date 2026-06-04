# Audio Engine

## Overview

`apps/audio-engine` is a headless C++ console application that implements the `AudioEngineBridge` using Tracktion Engine and JUCE.

It runs as a **Tauri sidecar**: the Tauri Rust core spawns it as a child process and communicates via line-delimited JSON-RPC over stdin/stdout.

## Architecture

```
main.cpp
  └── JSON-RPC read loop (stdin)
        └── dispatch() → EngineHost methods
              ├── EngineHost::createProject()   → tracktion::Engine + Edit
              ├── EngineHost::createTrack()     → AudioTrack in Edit
              ├── EngineHost::addClip()         → WaveAudioClip
              ├── EngineHost::play/stop/seek()  → TransportControl
              ├── EngineHost::setVolume/Pan()   → VolumeAndPanPlugin
              ├── EngineHost::mute/solo()       → AudioTrack flags
              ├── EngineHost::getTrackMeters()  → LevelMeterPlugin
              └── EngineHost::renderMix()       → Renderer
  └── Meter poll thread (50ms) → emits transportState + trackMeters events to stdout
```

## AudioEngineBridge API

| Method | Description |
|--------|-------------|
| `createProject(projectId)` | Create a new in-memory Tracktion Edit |
| `loadProject(projectId)` | Load an existing project (v1: same as create) |
| `createTrack(trackId, name, role, stemType)` | Add an AudioTrack to the Edit |
| `loadAudioFile(trackId, filePath)` | Load a WAV as a clip at t=0 |
| `addClip(trackId, filePath, startTimeSeconds)` | Insert a WaveAudioClip at an offset |
| `removeTrack(trackId)` | Remove a track from the Edit |
| `play()` | Start TransportControl playback |
| `stop()` | Stop playback, return to position 0 |
| `seek(timeSeconds)` | Set playback position |
| `getTransportState()` | Return `{isPlaying, positionSeconds, bpm}` |
| `setTrackVolume(trackId, volumeDb)` | Set VolumeAndPanPlugin gain |
| `setTrackPan(trackId, pan)` | Set VolumeAndPanPlugin pan (-1..1) |
| `muteTrack(trackId, muted)` | Mute or unmute a track |
| `soloTrack(trackId, soloed)` | Solo or unsolo a track |
| `getTrackMeters()` | Return `{trackId: {leftDb, rightDb}}` for all tracks |
| `renderMix(outputFilePath)` | Offline stereo bounce to WAV |
| `disposeProject()` | Clear the Edit and all tracks |

## Playback Requirements

- **Sample-accurate synchronization**: All clips start at the same sample boundary. Tracktion Engine's Edit ensures this natively.
- **Stable clocking**: Audio output via CoreAudio (macOS) through JUCE's DeviceManager.
- **No drift**: Tracktion Engine's graph-based processing handles buffer alignment.
- **Latency**: Device latency depends on the system audio buffer size. Typical: 5–15ms at 512 samples / 44100 Hz on macOS.

## Render

`renderMix()` uses Tracktion's `Renderer::renderToFile()` for offline bounce:
- 44100 Hz, 24-bit stereo WAV
- No normalization by default
- Full edit length (determined by longest clip)

## Async Events

The engine emits events to stdout every 50ms:

```json
{"event": "transportState", "isPlaying": false, "positionSeconds": 0.0, "bpm": 120.0}
{"event": "trackMeters", "meters": {"track-1": {"leftDb": -40.1, "rightDb": -39.7}}}
{"event": "engineReady", "version": "0.1.0"}
```

The Rust sidecar bridge forwards these to the React frontend as Tauri events.

## Building

```bash
cd apps/audio-engine
./scripts/build.sh
```

Requirements:
- CMake ≥ 3.22
- Apple clang (Xcode Command Line Tools)
- Git (for submodules)

The script adds `tracktion_engine` as a git submodule (which includes JUCE), then configures and builds a Release binary.

Output: `apps/desktop/src-tauri/binaries/odeon-engine-<target-triple>`

## Licensing

Tracktion Engine is dual-licensed:

- **GPLv3** (open source): free for open-source projects. You must publish your source code under GPL.
- **Commercial**: paid per-developer subscription from [tracktion.com/develop/tracktion-engine](https://www.tracktion.com/develop/tracktion-engine)
  - Personal: free for personal use / revenue < $5k/year
  - Indie: $35/month/developer for revenue < $200k/year
  - Enterprise: custom pricing

JUCE also requires a separate license for commercial distribution from [juce.com](https://juce.com).

**Before distributing Odeon commercially, acquire both a Tracktion Engine and a JUCE commercial license.**
