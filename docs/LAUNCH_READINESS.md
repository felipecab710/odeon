# Launch Readiness Plan

Last updated: launch sweep (post Phase J + performance sprint).

Consolidates findings from codebase audit, `PERFORMANCE_PLAN.md`, `PARITY_PLAN.md`, and `AUDACITY_ARDOUR_PARITY.md`.

---

## Launch gate status

| Gate | Status | Notes |
|------|--------|-------|
| Desktop `tsc --noEmit` | ✅ | Fixed 12 TS errors (ResearchView, TransitionArrangementView, prefetch, main) |
| Desktop `pnpm build` | ✅ | Vite bundle ~582 KB main chunk — consider code-split post-launch |
| Audio engine build | ✅ | `./apps/audio-engine/scripts/build.sh` required on fresh clone |
| Engine `--selftest` | ✅ | 18/18 after renderMix + routeCount fix |
| Tauri sidecar present | ⚠️ | Binary gitignored — document in release checklist |
| CI pipeline | ❌ | No automated tsc/engine build on push |
| E2E tests | ❌ | Manual verification only |

---

## Critical fixes shipped (this sweep)

1. **TypeScript build** — all `noUnusedLocals` / type errors resolved; production build unblocked.
2. **Engine session isolation** — `useSetEngineSync` / `useDjEngineSync` gated on `enabled`; hidden Research no longer clears `engineTracksReady` when user is in Studio.
3. **Nav-aware set sync** — Research engine sync only runs when `navigationStore.view === "research"` and arrangement mode.
4. **Transport UX** — Set Builder transport controls hidden outside arrangement (no dual transport in Booth).
5. **renderMix regression** — full-session bounce uses proven `renderToFile(edit, file)` path; range export uses Parameters API.
6. **Per-view ErrorBoundary** — Studio / Select / Research / Settings isolated from full-app crash.
7. **Protocol alignment** — `RenderMixParams` includes `startSeconds`, `endSeconds`, `normalizePeak`.
8. **Dead code removed** — orphaned `useSetMixEnginePush.ts` deleted (booth RAF owns playback push).
9. **Waveform cache** — safe canvas detach via `detachBitmapCanvas` (Select renderer).

---

## Known inconsistencies (documented, not launch blockers)

| Issue | Impact | Plan |
|-------|--------|------|
| ADR-0006 interim timeline clips in arrangement | Set preview ≠ true 4-deck graph | Phase F in `PARITY_PLAN.md` |
| Triple mix-push paths (booth RAF + strip toggles + fader drag) | Extra RPC on gestures | Consolidate through `enginePushThrottle` (P2) |
| Global `engineTracksReady` shared across views | Edge-case transport state | Split per-session readiness (P1) |
| README still says "Phase 1" | Onboarding confusion | Update README scope |
| `App.tsx` keeps views mounted (`hidden`) | Hooks still run | Accept for launch; unmount post-launch if needed |
| Range export via Parameters API | Untested in selftest | Add integration test |

---

## Performance verification

Run before release candidate:

```bash
# 1. Build engine sidecar
./apps/audio-engine/scripts/build.sh

# 2. Desktop production build
cd apps/desktop && pnpm build

# 3. Engine selftest
./apps/audio-engine/build/odeon_engine_artefacts/Release/odeon_engine --selftest
```

In app (Set Builder → arrangement, native GPU on, 4+ lanes):

1. `localStorage.setItem("odeon:perf", "1")` → reload
2. Play with transition active — console should show mix RPC ~30 Hz not 120 Hz
3. Chrome Performance — `TransitionArrangementView` should not commit 60×/sec during playback
4. Toggle Native GPU off→on after Rust rebuild

See `docs/PERFORMANCE_PLAN.md` for architecture target and P2 backlog.

---

## Parity execution plan (post-launch v1.1)

Priority order for DAW parity — full detail in `AUDACITY_ARDOUR_PARITY.md` and `DAW_COMPARISON.md`.

### Wave 1 — Recording & session (Phase K)
- `setRecordEnable` / `startRecording` / `stopRecording` RPCs
- Track input device selection
- Record arm UI + punch on edit selection

### Wave 2 — Routing (Phase L)
- Send matrix UI → existing `setRouteAuxSend`
- Monitor bus dim/mono
- Booth physical output routing

### Wave 3 — Automation (Phase M)
- Volume/pan lanes (read-only display first)
- Write/touch on fader drag during play
- Persist engine curves (replace localStorage-only)

### Wave 4 — Import & plugins (Phase N–O)
- FFmpeg bridge for MP3/FLAC
- Tracktion plugin insert UI

### Wave 5 — True set preview (Phase F)
- Retire timeline-clip interim (ADR-0006)
- 4-deck graph OR bus crossfader in engine

### Wave 6 — Comping (Phase P)
- Take lanes on record
- Comp region promote

**Current parity estimate:** ~54% general DAW, ~78% DJ set-building, ~35% Audacity workflow, ~30% Ardour workflow.

---

## Release checklist

- [ ] Run `./apps/audio-engine/scripts/build.sh` on release machine
- [ ] Copy sidecar to `apps/desktop/src-tauri/binaries/odeon-engine-aarch64-apple-darwin`
- [ ] `pnpm build` in `apps/desktop` passes
- [ ] Engine `--selftest` 18/18
- [ ] Manual: Studio load project → play → export mix
- [ ] Manual: Research set → arrangement → play → export selection
- [ ] Manual: Select catalog → preview track
- [ ] Toggle native GPU after Rust changes
- [ ] Verify API service running (`pnpm dev` or production deploy)

---

## Related docs

- [PERFORMANCE_PLAN.md](./PERFORMANCE_PLAN.md)
- [PARITY_PLAN.md](./PARITY_PLAN.md)
- [DAW_COMPARISON.md](./DAW_COMPARISON.md)
- [AUDACITY_ARDOUR_PARITY.md](./AUDACITY_ARDOUR_PARITY.md)
- [ARCHITECTURE.md](./ARCHITECTURE.md)
