# Production Performance Analysis

**Date:** 2026-06-10  
**Verdict:** ✅ **Ready for real users tomorrow** on macOS with native GPU, with the caveats below.

This analysis covers runtime hot paths, build metrics, and remaining risks after the launch-readiness sweep.

---

## Executive summary

| Area | Status | User impact |
|------|--------|-------------|
| Set Builder playback (4+ lanes) | ✅ Good | 30 Hz engine mix push, smooth native playhead |
| Native GPU timeline | ✅ Good | Scene updates coalesced to 1/frame; playhead via direct IPC |
| Studio mixer meters | ✅ Good | Per-track Zustand subscribe — no full-tree cascade |
| Fader drag / strip toggles | ✅ Fixed | Was unbounded RPC during drag; now ~60 Hz max + force on release |
| Booth simulation RAF | ✅ Fixed | Layout memoized — RAF loop no longer restarts every parent render |
| First load bundle | ⚠️ Acceptable | 582 KB main chunk — ~2–3 s on slow networks |
| Windows/Linux | ❌ Not ready | Native embed macOS-only |
| Recording / heavy FX | N/A | Not in scope for tomorrow |

---

## Architecture (verified)

```
Engine transport events (~20 Hz throttled)
  → transportStore (skip <8 ms deltas while playing)
  → useNativeTimelineEmbed RAF → updateNativeTimelinePlayhead (no React)

Engine meters
  → engineStore.updateMeters (unchanged tracks preserved)
  → ProToolsMeterCanvas / TrackHeaderMeter (per-track subscribe)

useBoothSimulation RAF (60 fps UI)
  → computeBoothSnapshot (layout memoized)
  → boothStore (snapKey dedup — skip identical frames)
  → pushBoothToEngine (30 Hz max while playing)

Native GPU scene
  → buildScene deps change → RAF-coalesced updateNativeTimelineScene (max 60/s)
  → scroll/zoom/cursor/mix state triggers rebuild (expected)

Strip gestures
  → shouldPushEngineMixGesture (16 ms) during fader drag
  → syncSetPreviewMixes(true) on release / button click
  → shouldPushEngineMix (33 ms) while playing
```

---

## Fixes applied (this analysis)

| ID | Issue | Fix |
|----|-------|-----|
| PP-1 | Fader drag fired `pushSetEngineMixes` on every mousemove (~120+ RPC/s) | `shouldPushEngineMixGesture` + force push on mouseup |
| PP-2 | Strip S/C/M toggles bypassed playback throttle | `syncSetPreviewMixes(force)` respects 30 Hz when playing |
| PP-3 | `useBoothSimulation` called `computeSetLayout` every render → RAF effect restarted | `useMemo` on layout |
| PP-4 | Native scene IPC on every `buildScene` dep change (scroll + cursor) | RAF-coalesce scene push to 1/frame |
| PP-5 | Gesture throttle API | `shouldPushEngineMixGesture` in `enginePushThrottle.ts` |

---

## Build & binary metrics

| Metric | Value | Threshold |
|--------|-------|-----------|
| `tsc --noEmit` | ✅ Pass | Required |
| `pnpm build` | ✅ 1.76 s | — |
| Main JS bundle | 581 KB (172 KB gzip) | <1 MB OK for desktop |
| Engine selftest | 18/18 | Required |
| `cargo check` | ✅ Pass | Required |

**Fresh clone requirement:** `./apps/audio-engine/scripts/build.sh` — sidecar not in git.

---

## Manual verification (do before release)

### 1. Enable perf overlay
```js
localStorage.setItem("odeon:perf", "1")
location.reload()
```

### 2. Set Builder stress test
- Research → Set with **4+ tracks** → **Timeline** mode
- Enable **Native GPU**
- **Play** through a transition region
- **Drag a fader** on native strip column

**Expect:**
- Console: no sustained `[odeon:perf] frame: >20ms` spam
- Mix engine RPC ~**30/s** during playback (not 120/s)
- Fader drag: UI updates every frame; audio follows within 1 frame

### 3. Studio stress test
- Load project with 8+ tracks
- Play + scroll timeline
- Meters animate without stuttering transport

### 4. View switching
- Studio → Research → Studio
- Play button in Studio still works (engineTracksReady not cleared)

---

## Remaining risks (post-launch backlog)

| Risk | Severity | Mitigation |
|------|----------|------------|
| Full scene IPC on scroll/zoom | Medium | P2: viewport-only channel (`timeline-embed:viewport` exists for reverse sync) |
| 582 KB main bundle | Low | Code-split ResearchView / SelectView |
| Transition plan API N+1 on set load | Low | Batch endpoint or cache |
| No automated perf CI | Medium | Add `tsc` + selftest to GitHub Actions |
| Python analysis (Demucs) CPU spike | Expected | Background job; not on audio thread |
| ADR-0006 timeline-clip preview | Product | Not a perf issue; fidelity gap |

---

## What real users will experience tomorrow

**Good:**
- Set building with overlapping lanes, automation curves, transitions
- Booth mirror with waveform-driven meters
- Export mix / selection / locators
- Native GPU timeline at 60 fps with Metal/wgpu wavecache
- Count-in, metronome, loop-from-selection

**Limitations to set expectations:**
- macOS only for native GPU timeline (DOM fallback elsewhere)
- No multitrack recording yet
- No VST plugin UI
- Large catalog analysis (stem separation) can take 1–2 min per track

---

## Related docs

- [PERFORMANCE_PLAN.md](./PERFORMANCE_PLAN.md) — architecture + P2 backlog
- [LAUNCH_READINESS.md](./LAUNCH_READINESS.md) — gates + release checklist
- [AUDACITY_ARDOUR_PARITY.md](./AUDACITY_ARDOUR_PARITY.md) — post-launch parity waves
