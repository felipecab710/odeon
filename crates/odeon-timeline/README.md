# odeon-timeline

Native GPU timeline renderer for Odeon Set Builder (Phase 0 spike).

## Architecture

- **`viewport.rs`** — `TimelineViewport` + anchor zoom (port of `SetTimelineContext` / Audacity `ZoomInfo`)
- **`grid.rs`** — beat grid tick collection (port of `setBeatGrid.ts`)
- **`spike/`** — wgpu + winit demo window (single renderer, one clock)

## Run the spike

```bash
cd apps/desktop/src-tauri
cargo build --bin timeline-spike
./target/debug/timeline-spike
```

Or from the app: **Set Builder → Native** button (spawns the spike process).

## Controls

| Input | Action |
|-------|--------|
| Cmd/Ctrl + scroll / pinch | Cursor-anchored zoom |
| Scroll (no modifier) | Pan horizontally |
| `R` | Reset zoom |

Green HUD bar = p99 frame time under 8.3ms (120Hz budget). Red = over budget.

## Next (Phase 1 — in progress)

- **Embedded panel** in main Set Builder window (click **Native** in timeline toolbar)
- Child NSWindow parented to Tauri, wgpu render loop, real clip layout from set state
- React measures timeline rect via ResizeObserver; web paint hidden while native is active

## After Phase 1

- Bidirectional viewport sync (native zoom → minimap + transport)
- Playhead from `odeon-engine` transport stream (not React poll)
- Phase 2: GPU waveform LOD from `.odeon.wavecache`
