# Odeon

Odeon is a DJ-aware DAW for building sets, comparing mixes, and previewing transitions — with native playback and catalog intelligence.

## Product views

**Studio**:
The main multitrack DAW view — timeline, mixer, transport, and track inspection for reference/user stem comparison.
_Avoid_: DAW mode, editor

**Select**:
The catalog intelligence view — import tracks, browse analysis, filter by compatibility, preview waveforms.
_Avoid_: Library, browser (when meaning the catalog product area)

**Research**:
The set-building and DJ preview area — Set Builder arrangement, Booth twin, and transition planning.
_Avoid_: Lab, experiments

**Settings**:
Playback engine and device configuration.
_Avoid_: Preferences (acceptable in UI copy only)

## Session & playback

**Session**:
The native engine's live playback state — transport position, route graph, route clips, and mixer. Exists in memory while the sidecar runs; serialized into `project.odeon` when saved.
_Avoid_: Project (when meaning live state), engine instance, Odeon Project (that's the folder on disk)

**Odeon Project**:
The persisted workspace folder on disk — `project.odeon`, source imports, renders, analysis cache, and backups. Saving a session writes into an Odeon Project; loading rebuilds the session from it.
_Avoid_: Session (live state), Studio Project (that's the API document in SQLite)

**Studio Project**:
The API/database document (`OdeonProject`) for Studio workflow — tracks, mix moves, analysis status, and metadata in SQLite. Synced to the engine session via `useEngineSync`; separate from the Odeon Project folder though both serve the same Studio workflow.
_Avoid_: Odeon Project (folder), Session (engine), project (bare — qualify which kind)

**Route**:
An audio path through the mixer graph. A track lane in the UI corresponds to a route in the session.
_Avoid_: Track (when meaning the graph node — use Route), channel (when meaning DAW track)

**Clip**:
A non-destructive placement of audio on a route at a timeline position, with optional source offset and length. In Research/Set Builder domain speech, refer to the product concept as **Set Card**; "clip" in code is UI-only.
_Avoid_: Region, segment, block (in engine/domain speech)

## Catalog & comparison

**Catalog Entry**:
A track in the Select library with file path, analysis metadata, tags, and compatibility data.
_Avoid_: Track (when meaning catalog item), song, asset

**Reference track**:
The uploaded reference full mix, or a stem separated from it — the baseline for comparison.
_Avoid_: Original, master (when meaning reference)

**User stem**:
A stem the user imports to compare against the reference (drums, bass, vocals, etc.).
_Avoid_: My track, import

**Stem**:
A separated component of a mix (drums, bass, vocals, music, FX, etc.).
_Avoid_: Layer (when meaning stem), part

**MixMove**:
An evidence-backed recommendation for a mix adjustment (level, EQ, stereo, dynamics) with confidence and DAW-ready parameters.
_Avoid_: Suggestion, tip, fix

## Set building & DJ

**Set**:
An ordered collection of catalog tracks arranged for a DJ performance, with timeline positions and transitions.
_Avoid_: Playlist, project (when meaning a DJ set)

**Set Card**:
One track's slot in a set — its identity in the node graph and its placement on the arrangement timeline (start time, duration, overlap with neighbours).
_Avoid_: Clip (domain/docs — reserved for UI component names only, e.g. `TrackBlock`, `SetMinimapClip`), item, block

**Arrangement placement**:
Where a Set Card sits on the beat-grid timeline (start seconds, overlap). Not a separate entity from the Set Card — just its timeline coordinates.
_Avoid_: Clip (in domain speech), region, segment

**Set Builder**:
The Research sub-view for arranging set cards on a beat-grid timeline with per-deck strips and automation.
_Avoid_: Arranger (generic), timeline view

**Transition**:
The planned blend region between two consecutive Set Cards — overlap on the timeline, MOSS FX plan, and automation curves. A product-level arrangement concept, not a mixer control.
_Avoid_: Crossfade (that's the DJM control or its bus effect — see Crossfader), blend, fade

**Deck**:
One of four independent DJ player slots (CDJ model) — load, seek, rate, hot cues, loops.
_Avoid_: Player (generic), channel (when meaning CDJ slot)

**Booth**:
The 4-deck + DJM mixer twin for previewing a set — Watch (simulation) or Drive (interactive) modes.
_Avoid_: Twin, mixer view

**Automation lane**:
Per-deck parameter curves on the set timeline (volume, EQ, filter, crossfader) — drawn or recorded keyframes.
_Avoid_: Envelope, modulation track

## Mixer (DJ)

**Crossfader**:
The DJM control that blends decks across A / THRU / B orientation buses with constant-power curves. Automatable on the set timeline; distinct from a **Transition** (the planned region between Set Cards).
_Avoid_: Transition, crossfade (as a noun for the transition region), fader (when meaning channel fader)

**PFL**:
Pre-fader listen — routes a deck to the headphone cue bus without affecting the main mix.
_Avoid_: Cue (acceptable in UI; PFL is the precise term in engine/docs)

**Hot cue**:
A stored jump point on a deck timeline.
_Avoid_: Cue point (UI shorthand), marker (timeline locators are separate)

## Display & analysis

**Wavecache**:
A precomputed `.odeon.wavecache` sidecar used for all waveform display — never live audio decode in the UI.
_Avoid_: Waveform file, peaks file

**Analysis route**:
A route whose role is to tap audio for offline AI analysis — not part of the audible mix path.
_Avoid_: Analysis track (prefer route)
