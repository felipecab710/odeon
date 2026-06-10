# Set Builder + DAW Parity Plan

Last updated: Phase H (metronome, export, loop-from-selection, clip trim).

See **`docs/DAW_COMPARISON.md`** for full Ableton / Audacity / Pro Tools matrix and Phases I–N.

## Current parity (~54% combined goal)

| Layer | % | Notes |
|-------|---|-------|
| Set arranger UI (DOM) | 78 | Full strips, automation editor, transitions, clip drag |
| Set arranger UI (native GPU) | 85 | Strips, clips, wavecache, automation curves, transitions, fader drag |
| Set preview engine | 65 | Full channel strip; crossfader; PFL via aux send (main unchanged) |
| DJ Booth / decks | 55 | True deck players; PFL/solo separated |
| Automation persistence | 55 | localStorage per set; not engine curves |
| Routing / busses | 35 | Headphones/Booth buses + AuxSend/AuxReturn; `setRouteAuxSend` RPC |
| Export / bounce | 55 | Export Audio + selection range + Audacity labels |
| Full DAW | 18 | Metronome + loop selection + clip trim |

## Shipped recently

- Unified native GPU panel (strips + timeline)
- `setTrackChannelMix` for set lanes (EQ/filter/cf/PFL)
- Automation persistence + GPU curve rendering
- GPU transition regions + edit cursor
- Strip → engine mix push on S/C/M; continuous RAF push via `useBoothSimulation` (not duplicate hooks)
- `createBus` + Headphones/Booth aux infrastructure
- True PFL: AuxSend to bus 0; solo independent of cue
- Native GPU fader drag + live fader cap position

## Phase C — Engine fidelity ✅

1. Continuous mix/automation push during playback
2. Mixer infrastructure — `bus:headphones` + AuxReturn on bus 0
3. True PFL — AuxSend to Headphones bus (main unchanged)
4. `setRouteAuxSend` RPC for explicit send levels

## Phase D — Native interaction parity (in progress)

1. GPU fader drag on strips ✅
2. GPU fader cap reflects mix state ✅
3. GPU edit cursor (scene has `cursor_sec`; rendering verified)
4. GPU EQ/trim knob drag — next
5. GPU automation edit (hit-test keyframes — blocked by Metal/DOM for full editor)
6. Clip resize in native hit-test — next

## Phase E — Routing DAW

1. Send matrix UI + booth monitor path
2. Booth bus separate physical output
3. Group tracks / VCA
4. Signal flow UI

## Phase F — Session model

1. Set preview → true deck players OR bus crossfader graph (retire ADR-0006 interim)
2. Engine-native automation curves (`AutomatableParameter`)
3. Beat sync coordinator (`EngineSync`)

## Phase G — Full DAW

MIDI, recording, plugins UI, comping, offline bounce, export — post Set Builder parity.

## Execution order (autonomous)

```
C1 mix push hook          ✅
C2 bus + aux return       ✅
C3 PFL via aux send       ✅
D1 native cursor          ✅ (rendering in place)
D2 strip fader GPU        ✅
D3 strip EQ knob GPU      ← next
E1 send matrix UI         ← after D stable
F1 deck vs timeline       ← product gate
```
