# Launch Distribution Plan

How users download, install, and run Odeon without a dev environment.

---

## Architecture (release)

```
Odeon.app
├── Contents/MacOS/odeon-desktop      ← Tauri shell
├── Contents/Resources/
│   ├── odeon-engine-aarch64-apple-darwin   ← audio sidecar (Tauri externalBin)
│   └── api-bundle/                         ← Python venv + FastAPI
│       ├── venv/bin/python
│       ├── app/
│       └── run_server.py
└── User data → ~/Library/Application Support/com.odeon.desktop/
```

On launch, Tauri:
1. Spawns **bundled API** (uvicorn on `127.0.0.1:8000`) with `ODEON_DATA_DIR` set
2. Spawns **odeon-engine** sidecar for playback
3. Frontend polls `/health` until ready

---

## Build pipeline

| Step | Script | Output |
|------|--------|--------|
| 1 | `pnpm install` | JS deps |
| 2 | `apps/audio-engine/scripts/build.sh` | `binaries/odeon-engine-*` |
| 3 | `scripts/release/prepare-api-bundle.sh` | `resources/api-bundle/` |
| 4 | `pnpm tauri build --config tauri.release.conf.json` | `.app` |
| 5 | `hdiutil create …` (in build-macos.sh) | `.dmg` |

**One command:** `./scripts/release/build-macos.sh`

**CI:** `.github/workflows/release-macos.yml` on tag `v*`

---

## Release checklist

- [ ] Bump version in `tauri.conf.json` + `package.json`
- [ ] Run `./scripts/release/build-macos.sh` on Apple Silicon Mac
- [ ] Test fresh .dmg on clean user account
- [ ] Upload DMG to GitHub Release with notes
- [ ] Update INSTALL.md download URL with real org/repo

---

## Known v0.1 limits

| Item | Status |
|------|--------|
| macOS Apple Silicon | ✅ Primary target |
| macOS Intel | ⚠️ Build on x64 host |
| Windows / Linux | ❌ Not in v0.1 |
| Code signing / notarization | ❌ Users use "Open Anyway" |
| Demucs in bundle | ❌ Optional pip install |
| Auto-update | ❌ Manual download |

---

## Post-launch (v0.1.1+)

1. Apple Developer ID signing + notarization
2. GitHub Releases auto-upload from CI
3. Intel macOS + Windows builds
4. Optional Demucs download on first use
5. In-app update checker

---

## Related

- [INSTALL.md](./INSTALL.md) — user-facing install guide
- [LAUNCH_READINESS.md](./LAUNCH_READINESS.md) — quality gates
- [PRODUCTION_PERFORMANCE.md](./PRODUCTION_PERFORMANCE.md) — perf verification
