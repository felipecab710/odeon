# Audio Engine — Odeon

C++ headless console application using Tracktion Engine + JUCE.
Communicates with the Tauri desktop app via JSON-RPC over stdin/stdout (sidecar pattern).

## Prerequisites

- CMake ≥ 3.22  (`brew install cmake`)
- Apple clang (Xcode Command Line Tools)
- Rust / `rustc` (for target-triple detection in build.sh)

## Build

```bash
cd apps/audio-engine
./scripts/build.sh
```

The script:
1. Fetches the `tracktion_engine` git submodule (includes JUCE).
2. Configures a Release CMake build.
3. Copies the binary to `apps/desktop/src-tauri/binaries/odeon-engine-<target-triple>`.

## Standalone test

```bash
echo '{"id":1,"method":"createProject","params":{"projectId":"test"}}' \
  | ./build/odeon_engine_artefacts/Release/odeon_engine
```

Expected stdout:
```
{"event":"engineReady","version":"0.1.0"}
{"id":1,"result":{"ok":true,"result":"test"}}
```

## Licensing

Tracktion Engine is dual-licensed: **GPLv3** (open source) or **commercial** (paid tier).

- For **open-source / GPL projects**: the bundled GPLv3 license applies automatically.
- For **closed-source / commercial distribution**: you must obtain a separate commercial license from [Tracktion Software Corporation](https://www.tracktion.com/develop/tracktion-engine) **and** an appropriate JUCE license from [juce.com](https://juce.com).

The Indie tier is $35/month/developer for companies under $200k annual revenue.
