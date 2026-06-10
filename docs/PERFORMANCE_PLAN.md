# Performance Plan — Launch Readiness

Last updated: after P0/P1 performance sprint.

## Goals

- Stable 60 fps UI during Set Builder playback with native GPU
- Engine RPC budget ≤ ~30 Hz during automation (not 120+ Hz)
- Meter updates isolated from full React tree re-renders
- No duplicate RAF loops for the same subsystem

## Baseline issues (fixed)

| ID | Issue | Fix |
|----|-------|-----|
| P0-1 | Duplicate `useSetMixEnginePush` + `useBoothSimulation` engine pushes | Removed duplicate hook from ResearchView |
| P0-2 | `useSetMixEnginePush` double-push (effect + RAF) | Hook now one-shot only; booth owns playback loop |
| P0-3 | Transition bypasses RPC dedup → full push every frame | Fingerprint includes playhead; 30 Hz throttle |
| P1-1 | `TransitionArrangementView` 60 fps re-render for native playhead | Smooth playhead in `useNativeTimelineEmbed` (no React state) |
| P1-2 | Transport store ~20 Hz full-tree updates | Skip sub-8 ms position deltas while playing |
| P1-3 | `TrackHeaderMeter` re-renders all lanes on any meter event | Zustand subscribe + local state per track |
| P1-4 | `computeBoothSnapshot` recomputes layout every frame | Precomputed layout passed from hook |
| P1-5 | `setCrossfader` every lane push | Cached last crossfader position |
| PP-1 | Fader drag unbounded engine RPC | `shouldPushEngineMixGesture` + force on mouseup |
| PP-2 | Booth RAF restarted every parent render | Memoize `computeSetLayout` in `useBoothSimulation` |
| PP-3 | Native scene IPC burst on scroll/cursor | RAF-coalesce `updateNativeTimelineScene` |

## Architecture (target)

```
Engine meter poll (50 ms)
  → transportStore (throttled position)
  → engineStore.updateMeters (unchanged tracks preserved)
  → ProToolsMeterCanvas / TrackHeaderMeter (subscribe, no React cascade)

useBoothSimulation RAF (60 fps)
  → boothStore snapshot (snapKey dedup)
  → pushBoothToEngine (30 Hz max while playing)

useNativeTimelineEmbed RAF (60 fps)
  → updateNativeTimelinePlayhead (direct IPC, no React)

Scene rebuild (on scroll/zoom/mix UI only)
  → timeline_embed_set_scene (coalesced in Rust)
```

## Remaining (Phase P2)

| Item | Priority | Approach |
|------|----------|----------|
| Zoomed CDJ waveform bitmap cache | P1 | Key `(cacheKey, t0, t1, physW)` blit per frame |
| Viewport-only native scene channel | P1 | Partial IPC `{ scroll_left, pps }` |
| Mixer strip granular subscribe | P2 | Pattern from ProToolsMeterCanvas |
| Waveform tile cache coarser pps during zoom | P2 | Round pps in fastMode |
| Dev perf overlay | P2 | `odeon:perf` HUD with RPC rate + frame p99 |
| Windows/Linux native embed | P2 | Platform parity |

## Verification

1. Enable dev perf: `localStorage.setItem("odeon:perf", "1")` + reload
2. Set Builder arrangement → play with 4+ lanes, native GPU on
3. Chrome Performance: main thread should not show 60×/sec full TransitionArrangementView commits
4. Engine sidecar: mix RPC rate ~30/s not 120/s during transitions

## References

- `apps/desktop/src/lib/perfDiagnostics.ts` — frame monitor
- `apps/desktop/src/lib/enginePushThrottle.ts` — mix push budget
- `apps/desktop/src/components/mixer/ProToolsMeterPanel.tsx` — meter subscribe pattern
