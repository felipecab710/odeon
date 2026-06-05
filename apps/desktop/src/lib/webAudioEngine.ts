import type { PlaybackEngineSettings } from "@odeon/shared";

/**
 * webAudioEngine — Ardour-architecture Web Audio signal engine.
 *
 * Signal chain per track (matches Ardour route.cc processor order):
 *
 *   BufferSource
 *     → FaderGainNode   (Ardour "Amp" — 8th-power fader law + 25 Hz declick LPF)
 *     → MuteGainNode    (Ardour "MuteMaster" — AFL solo gate, 5 ms declick)
 *     → OdeonMeterNode  (AudioWorkletNode pass-through — PeakMeter, ~10 ms posts)
 *     → StereoPannerNode (Ardour "Delivery" panner)
 *     → MasterGainNode  (Master Amp)
 *     ↓ also (post-mute send tap, Ardour InternalSend):
 *     → FX1SendGain → FxBus1.returnGain → MasterGainNode
 *     → FX2SendGain → FxBus2.returnGain → MasterGainNode
 *
 * Master bus:
 *   MasterGainNode → OdeonMeterNode(master) → AudioContext.destination
 *
 * Metering architecture (matches Ardour):
 *   - OdeonMeterProcessor (AudioWorklet) runs in the audio thread at block rate
 *   - Posts raw linear peak L/R every 4 blocks ≈ 10.7 ms at 48 kHz
 *   - Main thread receives posts and stores as instant peaks
 *   - RAF display loop applies Ardour ballistics (8 dB/s falloff, 1500 ms hold)
 *
 * Fader law: Ardour 8th-power taper (libs/pbd/pbd/control_math.h)
 * Gain declick: setTargetAtTime with τ = 1/(2π·25 Hz) ≈ 6.37 ms (Ardour amp.cc)
 * Solo: AFL — non-soloed tracks muted via MuteGain, faders preserved (route.cc)
 */

// ── Types ─────────────────────────────────────────────────────────────────────

type PositionCb    = (seconds: number) => void;
type ReadyChangeCb = (ready: boolean) => void;

export interface MeterData {
  leftDb:      number;
  rightDb:     number;
  peakLeftDb:  number;
  peakRightDb: number;
  clipping:    boolean;
}
type MeterCb = (meters: Record<string, MeterData>) => void;

interface TrackState {
  muted:     boolean;
  soloed:    boolean;
  volumeDb:  number;
  pan:       number;
  /** false = pre-fader meter (default), true = post-fader/post-mute */
  meterPost: boolean;
}

interface AuxBus {
  id:         string;
  name:       string;
  returnGain: GainNode;
}

interface TrackNodes {
  faderGain:     GainNode;
  muteGain:      GainNode;
  preMeterNode:  AudioWorkletNode | null;
  postMeterNode: AudioWorkletNode | null;
  panner:        StereoPannerNode;
  sendGains:     Map<string, GainNode>;
}

interface InstantPeak { L: number; R: number }

interface MeterBallistic {
  dispL: number; dispR: number;
  peakL: number; peakR: number;
  peakTimeL: number; peakTimeR: number;
  clipping: boolean;
}

// ── Math helpers ──────────────────────────────────────────────────────────────

export function dbToGain(db: number): number { return db <= -120 ? 0 : Math.pow(10, db / 20); }
export function gainToDb(g: number):   number { return g < 1e-7 ? -120 : 20 * Math.log10(g); }

/**
 * Ardour fader taper (control_math.h):
 *   gain = 2^( (198 · pos^(1/8) − 192) / 6 )   pos ∈ [0,1]
 * Unity (0 dB) at pos ≈ 0.785, ceiling +6 dB at pos = 1.
 */
function ardourPosToGain(pos: number): number {
  if (pos <= 0) return 0;
  if (pos >= 1) return 2;
  return Math.pow(2, (198 * Math.pow(pos, 1 / 8) - 192) / 6);
}
function ardourGainToPos(gain: number): number {
  if (gain <= 0) return 0;
  const inner = (6 * Math.log2(gain) + 192) / 198;
  return inner <= 0 ? 0 : Math.min(1, Math.pow(inner, 8));
}
export function ardourDbToPos(db: number): number { return ardourGainToPos(dbToGain(db)); }
export function ardourPosToDb(pos: number): number { return gainToDb(ardourPosToGain(pos)); }

// ── Constants ─────────────────────────────────────────────────────────────────

/** Ardour amp.cc declick: 1-pole LPF at 25 Hz, τ = 1/(2π·25) ≈ 6.37 ms */
const AMP_TC  = 1 / (2 * Math.PI * 25);
/** Fast gate declick: 5 ms (mute/solo, send enable) */
const GATE_TC = 0.005;

/** Ardour "fast" meter falloff: 8 dB/s → per-frame at 60 fps */
const FALLOFF_PER_FRAME = 8 / 60;
const PEAK_HOLD_MS = 1500;

/** Default aux bus IDs — always present */
const AUX_BUSES = [
  { id: "fx1", name: "FX 1" },
  { id: "fx2", name: "FX 2" },
] as const;

const DEFAULT_STATE: TrackState = { muted: false, soloed: false, volumeDb: 0, pan: 0, meterPost: false };
const EMPTY_BALLISTIC: MeterBallistic = { dispL: -90, dispR: -90, peakL: -90, peakR: -90, peakTimeL: 0, peakTimeR: 0, clipping: false };

// ── Engine ────────────────────────────────────────────────────────────────────

class WebAudioEngine {
  private ctx:               AudioContext | null = null;
  private workletLoaded      = false;

  private buffers            = new Map<string, AudioBuffer>();
  private trackNodes         = new Map<string, TrackNodes>();
  private trackStates        = new Map<string, TrackState>();
  private clipStarts         = new Map<string, number>();
  private auxBuses           = new Map<string, AuxBus>();

  /** Latest raw linear peak from the AudioWorklet, updated every ~10 ms */
  private instantPeaksPre    = new Map<string, InstantPeak>();
  private instantPeaksPost   = new Map<string, InstantPeak>();
  private masterInstantPeak: InstantPeak = { L: 0, R: 0 };

  /** Display ballistics (computed in RAF loop) */
  private meterBallistic     = new Map<string, MeterBallistic>();
  private masterBallistic: MeterBallistic = { ...EMPTY_BALLISTIC };

  private masterGain:         GainNode | null = null;
  private masterMeterNode:    AudioWorkletNode | null = null;

  private sources             = new Map<string, AudioBufferSourceNode>();
  private loadedTrackIds      = new Set<string>();
  private _isPlaying          = false;
  private startContextTime    = 0;
  private startOffset         = 0;

  private positionCb:  PositionCb    | null = null;
  private readyCb:     ReadyChangeCb | null = null;
  private bufferCbs:   Set<() => void>     = new Set();
  private meterCbs:    MeterCb[]           = [];
  private rafId:       number        | null = null;
  private meterRafId:  number        | null = null;
  private latencyHint: AudioContextLatencyCategory = "interactive";

  // ── AudioContext + Master Bus ───────────────────────────────────────────────

  /** Apply playback-engine buffer preference (Web Audio fallback path). */
  applyPlaybackSettings(settings: PlaybackEngineSettings) {
    const hint: AudioContextLatencyCategory =
      settings.bufferSizeSamples <= 128
        ? "interactive"
        : settings.bufferSizeSamples >= 512
          ? "playback"
          : "balanced";

    if (hint !== this.latencyHint) {
      this.latencyHint = hint;
      if (this.ctx) {
        if (this._isPlaying) this.stop();
        void this.ctx.close();
        this.ctx = null;
        this.masterGain = null;
        this.masterMeterNode = null;
        this.workletLoaded = false;
      }
    }
  }

  private getCtx(): AudioContext {
    if (!this.ctx) {
      this.ctx = new AudioContext({ latencyHint: this.latencyHint });
      void this._buildMasterBus(this.ctx);
    }
    return this.ctx;
  }

  private async _buildMasterBus(ctx: AudioContext) {
    this.masterGain = ctx.createGain();
    this.masterGain.gain.value = 1.0;

    // Load AudioWorklet module (served from Vite public/)
    try {
      await ctx.audioWorklet.addModule("/odeon-meter-worklet.js");
      this.workletLoaded = true;
      console.info("[webAudio] AudioWorklet loaded ✓");
    } catch (e) {
      console.warn("[webAudio] AudioWorklet unavailable, falling back to AnalyserNode:", e);
    }

    // Create 2 FX aux buses (InternalSend buses in Ardour terminology)
    for (const { id, name } of AUX_BUSES) {
      const returnGain = ctx.createGain();
      returnGain.gain.value = 0.8; // -2 dB return level
      returnGain.connect(this.masterGain);
      this.auxBuses.set(id, { id, name, returnGain });
    }

    // Master meter node (pass-through + peak measurement)
    if (this.workletLoaded) {
      this.masterMeterNode = new AudioWorkletNode(ctx, "odeon-meter", {
        channelCount: 2,
        channelCountMode: "explicit",
        channelInterpretation: "speakers",
      });
      this.masterMeterNode.port.onmessage = (e) => {
        this.masterInstantPeak = { L: e.data.peakL, R: e.data.peakR };
      };
      this.masterGain.connect(this.masterMeterNode);
      this.masterMeterNode.connect(ctx.destination);
    } else {
      this.masterGain.connect(ctx.destination);
    }

    this._startMeterLoop();
  }

  // ── Per-track node factory ─────────────────────────────────────────────────

  private async _buildTrackNodes(trackId: string, channelCount: number): Promise<TrackNodes> {
    const ctx       = this.getCtx();
    const faderGain = ctx.createGain();
    const muteGain  = ctx.createGain();
    const panner    = ctx.createStereoPanner();

    faderGain.connect(muteGain);

    // Chain: source → preMeter → fader → mute → postMeter → panner
    const meterOpts = {
      channelCount: channelCount >= 2 ? 2 : 1,
      channelCountMode: "explicit" as const,
      channelInterpretation: "speakers" as const,
      outputChannelCount: [channelCount >= 2 ? 2 : 1],
    };
    let preMeterNode: AudioWorkletNode | null = null;
    let postMeterNode: AudioWorkletNode | null = null;
    if (this.workletLoaded) {
      preMeterNode = new AudioWorkletNode(ctx, "odeon-meter", meterOpts);
      preMeterNode.port.onmessage = (e: MessageEvent<{ peakL: number; peakR: number }>) => {
        this.instantPeaksPre.set(trackId, { L: e.data.peakL, R: e.data.peakR });
      };
      preMeterNode.connect(faderGain);

      postMeterNode = new AudioWorkletNode(ctx, "odeon-meter", meterOpts);
      postMeterNode.port.onmessage = (e: MessageEvent<{ peakL: number; peakR: number }>) => {
        this.instantPeaksPost.set(trackId, { L: e.data.peakL, R: e.data.peakR });
      };
      muteGain.connect(postMeterNode);
      postMeterNode.connect(panner);
    } else {
      muteGain.connect(panner);
    }

    panner.connect(this.masterGain!);

    // ── Aux sends (InternalSend — post-muteGain, pre-panner) ─────────────────
    const sendGains = new Map<string, GainNode>();
    for (const [busId, bus] of this.auxBuses.entries()) {
      const sendGain = ctx.createGain();
      sendGain.gain.value = 0; // sends off by default
      muteGain.connect(sendGain);
      sendGain.connect(bus.returnGain);
      sendGains.set(busId, sendGain);
    }

    this.instantPeaksPre.set(trackId, { L: 0, R: 0 });
    this.instantPeaksPost.set(trackId, { L: 0, R: 0 });
    this.meterBallistic.set(trackId, { ...EMPTY_BALLISTIC });

    const nodes: TrackNodes = { faderGain, muteGain, preMeterNode, postMeterNode, panner, sendGains };
    this.trackNodes.set(trackId, nodes);
    this._applyTrackGains(trackId);
    return nodes;
  }

  // ── Track loading ──────────────────────────────────────────────────────────

  async loadTrack(trackId: string, filePath: string): Promise<void> {
    if (this.loadedTrackIds.has(trackId)) return;
    const ctx = this.getCtx();
    // Ensure worklet is loaded before we need nodes
    if (!this.workletLoaded) {
      // Wait up to 2 s for _buildMasterBus to finish
      await new Promise<void>((res) => setTimeout(res, 100));
    }
    try {
      const { readFile } = await import("@tauri-apps/plugin-fs");
      const bytes  = await readFile(filePath);
      const buffer = await ctx.decodeAudioData(bytes.buffer.slice(0));
      this.buffers.set(trackId, buffer);
      this.loadedTrackIds.add(trackId);
      await this._buildTrackNodes(trackId, buffer.numberOfChannels);
      this.readyCb?.(true);
      this._notifyBufferChange();
      console.info(`[webAudio] ✓ ${trackId}  ${buffer.numberOfChannels}ch  ${buffer.duration.toFixed(1)}s`);
    } catch (e) {
      console.error(`[webAudio] ✗ ${trackId}:`, e);
    }
  }

  removeTrack(trackId: string) {
    this._disconnectTrack(trackId);
    this.buffers.delete(trackId);
    this.loadedTrackIds.delete(trackId);
    this.trackNodes.delete(trackId);
    this.trackStates.delete(trackId);
    this.clipStarts.delete(trackId);
    this.instantPeaksPre.delete(trackId);
    this.instantPeaksPost.delete(trackId);
    this.meterBallistic.delete(trackId);
    this.readyCb?.(this.buffers.size > 0);
  }

  clearTracks() {
    if (this._isPlaying) this.stop();
    for (const id of this.trackNodes.keys()) this._disconnectTrack(id);
    this.buffers.clear();
    this.loadedTrackIds.clear();
    this.trackNodes.clear();
    this.trackStates.clear();
    this.clipStarts.clear();
    this.instantPeaksPre.clear();
    this.instantPeaksPost.clear();
    this.meterBallistic.clear();
    this.readyCb?.(false);
  }

  private _disconnectTrack(trackId: string) {
    const nodes = this.trackNodes.get(trackId);
    if (!nodes) return;
    for (const n of [nodes.faderGain, nodes.muteGain, nodes.preMeterNode, nodes.postMeterNode, nodes.panner] as (AudioNode | null)[]) {
      if (n) try { n.disconnect(); } catch { /**/ }
    }
    for (const sg of nodes.sendGains.values()) try { sg.disconnect(); } catch { /**/ }
    const src = this.sources.get(trackId);
    if (src) try { src.disconnect(); } catch { /**/ }
  }

  hasTrack(id: string) { return this.loadedTrackIds.has(id); }
  get trackCount()     { return this.buffers.size; }

  getBuffer(trackId: string): AudioBuffer | null {
    return this.buffers.get(trackId) ?? null;
  }

  onBufferChange(cb: () => void): () => void {
    this.bufferCbs.add(cb);
    return () => { this.bufferCbs.delete(cb); };
  }

  private _notifyBufferChange() {
    for (const cb of this.bufferCbs) cb();
  }

  // ── Aux bus controls ───────────────────────────────────────────────────────

  /** Aux bus list for the UI */
  getAuxBuses(): { id: string; name: string }[] {
    return [...this.auxBuses.values()].map(({ id, name }) => ({ id, name }));
  }

  /**
   * Set the send level from a track to an aux bus (post-fader/post-mute).
   * db = -Infinity → send off; db = 0 → unity; common range: -60..0.
   */
  setSend(trackId: string, busId: string, db: number) {
    const nodes = this.trackNodes.get(trackId);
    const ctx   = this.ctx;
    if (!nodes || !ctx) return;
    const sg     = nodes.sendGains.get(busId);
    if (!sg) return;
    const target = dbToGain(db);
    sg.gain.cancelScheduledValues(ctx.currentTime);
    sg.gain.setValueAtTime(sg.gain.value, ctx.currentTime);
    sg.gain.setTargetAtTime(target, ctx.currentTime, GATE_TC);
  }

  /** Set the master return level of an aux bus */
  setAuxReturn(busId: string, db: number) {
    const bus = this.auxBuses.get(busId);
    const ctx = this.ctx;
    if (!bus || !ctx) return;
    const target = dbToGain(db);
    bus.returnGain.gain.cancelScheduledValues(ctx.currentTime);
    bus.returnGain.gain.setValueAtTime(bus.returnGain.gain.value, ctx.currentTime);
    bus.returnGain.gain.setTargetAtTime(target, ctx.currentTime, AMP_TC);
  }

  // ── Mixer controls ─────────────────────────────────────────────────────────

  setClipStart(trackId: string, seconds: number) {
    this.clipStarts.set(trackId, Math.max(0, seconds));
  }

  setVolume(trackId: string, db: number) {
    const s = this._getState(trackId);
    this.trackStates.set(trackId, { ...s, volumeDb: db });
    this._applyTrackGains(trackId);
  }

  setMute(trackId: string, muted: boolean) {
    const s = this._getState(trackId);
    this.trackStates.set(trackId, { ...s, muted });
    this._applyTrackGains(trackId);
  }

  /**
   * AFL solo: when any track is soloed, all other tracks receive muteGain = 0.
   * On solo change also flush the master ballistic so meters sync immediately.
   */
  setSolo(trackId: string, soloed: boolean) {
    const s = this._getState(trackId);
    this.trackStates.set(trackId, { ...s, soloed });
    for (const id of this.trackNodes.keys()) this._applyTrackGains(id);
    // Reset master ballistic on solo change so it re-syncs to the new signal mix
    this.masterBallistic = { ...EMPTY_BALLISTIC };
  }

  setPan(trackId: string, pan: number) {
    const s = this._getState(trackId);
    this.trackStates.set(trackId, { ...s, pan });
    const nodes = this.trackNodes.get(trackId);
    if (nodes && this.ctx) {
      nodes.panner.pan.cancelScheduledValues(this.ctx.currentTime);
      nodes.panner.pan.setValueAtTime(nodes.panner.pan.value, this.ctx.currentTime);
      nodes.panner.pan.setTargetAtTime(pan, this.ctx.currentTime, GATE_TC);
    }
  }

  /** Toggle strip meter tap: false = pre-fader (default), true = post-fader/post-mute. */
  setMeterPost(trackId: string, post: boolean) {
    this.trackStates.set(trackId, { ...this._getState(trackId), meterPost: post });
  }

  setMasterVolume(db: number) {
    if (!this.masterGain || !this.ctx) return;
    this.masterGain.gain.cancelScheduledValues(this.ctx.currentTime);
    this.masterGain.gain.setValueAtTime(this.masterGain.gain.value, this.ctx.currentTime);
    this.masterGain.gain.setTargetAtTime(dbToGain(db), this.ctx.currentTime, AMP_TC);
  }

  resetClip(trackId: string) {
    if (trackId === "__master__") { this.masterBallistic = { ...this.masterBallistic, clipping: false }; return; }
    const b = this.meterBallistic.get(trackId);
    if (b) this.meterBallistic.set(trackId, { ...b, clipping: false });
  }

  // ── Gain application ───────────────────────────────────────────────────────

  private _applyTrackGains(trackId: string) {
    const ctx   = this.ctx;
    const nodes = this.trackNodes.get(trackId);
    if (!ctx || !nodes) return;
    const s         = this._getState(trackId);
    const anySoloed = [...this.trackStates.values()].some((ts) => ts.soloed);
    const audible   = !s.muted && (!anySoloed || s.soloed);

    // Fader: Ardour 8th-power taper
    const faderTarget = ardourPosToGain(ardourDbToPos(s.volumeDb));
    nodes.faderGain.gain.cancelScheduledValues(ctx.currentTime);
    nodes.faderGain.gain.setValueAtTime(nodes.faderGain.gain.value, ctx.currentTime);
    nodes.faderGain.gain.setTargetAtTime(faderTarget, ctx.currentTime, AMP_TC);

    // Mute/Solo gate (fast declick)
    const muteTarget = audible ? 1.0 : 0.0;
    nodes.muteGain.gain.cancelScheduledValues(ctx.currentTime);
    nodes.muteGain.gain.setValueAtTime(nodes.muteGain.gain.value, ctx.currentTime);
    nodes.muteGain.gain.setTargetAtTime(muteTarget, ctx.currentTime, GATE_TC);
  }

  private _getState(id: string): TrackState { return this.trackStates.get(id) ?? DEFAULT_STATE; }

  // ── Transport ──────────────────────────────────────────────────────────────

  play(offsetSeconds = 0) {
    if (this.buffers.size === 0) return;
    if (this._isPlaying) this._stopSources();
    const ctx = this.getCtx();
    if (ctx.state === "suspended") ctx.resume();
    // Tight 15 ms pre-roll (Ardour typically ~10 ms)
    const startAt = ctx.currentTime + 0.015;
    for (const [trackId, buffer] of this.buffers.entries()) {
      const nodes = this.trackNodes.get(trackId);
      if (!nodes) continue;
      const clipStart = this.clipStarts.get(trackId) ?? 0;
      const bufOff    = offsetSeconds - clipStart;
      if (bufOff < 0 || bufOff >= buffer.duration - 0.001) continue;
      const src     = ctx.createBufferSource();
      src.buffer    = buffer;
      src.connect(nodes.preMeterNode ?? nodes.faderGain);
      const clamped = Math.max(0, Math.min(bufOff, buffer.duration - 0.001));
      src.start(startAt, clamped);
      src.onended = () => {
        this.sources.delete(trackId);
        if (this.sources.size === 0) {
          if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
          // Only reset on natural end — not when pause/stop clears sources
          if (this._isPlaying) {
            this._isPlaying = false;
            this.startOffset = 0;
            this.positionCb?.(0);
          }
        }
      };
      this.sources.set(trackId, src);
    }
    this.startContextTime = startAt;
    this.startOffset      = offsetSeconds;
    this._isPlaying       = true;
    this._tick();
  }

  pause() {
    if (!this._isPlaying) return;
    this.startOffset = this.getPosition();
    this._isPlaying = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this._stopSources();
    this._silenceMeterPeaks();
    this.positionCb?.(this.startOffset);
  }

  stop() {
    this._stopSources();
    this._isPlaying = false;
    if (this.rafId !== null) { cancelAnimationFrame(this.rafId); this.rafId = null; }
    this.startOffset = 0;
    this._silenceMeterPeaks();
    this.positionCb?.(0);
  }

  seek(seconds: number) {
    if (this._isPlaying) this.play(seconds);
    else { this.startOffset = seconds; this.positionCb?.(seconds); }
  }

  getPosition(): number {
    if (!this._isPlaying || !this.ctx) return this.startOffset;
    return this.startOffset + (this.ctx.currentTime - this.startContextTime);
  }
  isPlaying() { return this._isPlaying; }

  private _stopSources() {
    for (const src of this.sources.values()) {
      src.onended = null;
      try { src.stop(0); }      catch { /**/ }
      try { src.disconnect(); } catch { /**/ }
    }
    this.sources.clear();
  }

  // ── Callbacks ──────────────────────────────────────────────────────────────

  onPositionUpdate(cb: PositionCb)  { this.positionCb = cb; }
  onReadyChange(cb: ReadyChangeCb)  { this.readyCb    = cb; }
  onMeterUpdate(cb: MeterCb)        { this.meterCbs.push(cb); }

  // ── Position tick ──────────────────────────────────────────────────────────

  private _tick = () => {
    if (!this._isPlaying) return;
    this.positionCb?.(this.getPosition());
    this.rafId = requestAnimationFrame(this._tick);
  };

  // ── Meter loop — display ballistics (Ardour UI timer equivalent) ───────────

  /**
   * Runs at ~60 fps. Reads instant peaks posted by AudioWorklet and applies:
   *   - 8 dB/s Ardour "fast" falloff
   *   - 1500 ms peak hold then falloff
   *   - Clip latch (arms when peak ≥ 0 dBFS)
   *
   * Because AudioWorklet posts every ~10 ms and RAF runs every ~16 ms, display
   * latency is max(10, 16) ≈ 16 ms — far tighter than AnalyserNode (~38 ms).
   */
  /** Clear peak buffers when transport stops — meters show silence, not stale/hover data. */
  private _silenceMeterPeaks() {
    for (const id of this.trackNodes.keys()) {
      this.instantPeaksPre.set(id, { L: 0, R: 0 });
      this.instantPeaksPost.set(id, { L: 0, R: 0 });
      this.meterBallistic.set(id, { ...EMPTY_BALLISTIC });
    }
    this.masterInstantPeak = { L: 0, R: 0 };
    this.masterBallistic = { ...EMPTY_BALLISTIC };
    if (this.meterCbs.length > 0) {
      const silent: Record<string, MeterData> = {};
      for (const id of this.trackNodes.keys()) {
        silent[id] = { leftDb: -90, rightDb: -90, peakLeftDb: -90, peakRightDb: -90, clipping: false };
      }
      silent["__master__"] = { leftDb: -90, rightDb: -90, peakLeftDb: -90, peakRightDb: -90, clipping: false };
      for (const cb of this.meterCbs) cb(silent);
    }
  }

  private _startMeterLoop() {
    const tick = () => {
      const ctx = this.ctx;
      if (this._isPlaying && this.meterCbs.length > 0 && ctx && ctx.state !== "closed") {
        const now    = performance.now();
        const meters: Record<string, MeterData> = {};

        for (const [id] of this.trackNodes.entries()) {
          const s    = this._getState(id);
          const inst = s.meterPost
            ? (this.instantPeaksPost.get(id) ?? { L: 0, R: 0 })
            : (this.instantPeaksPre.get(id) ?? { L: 0, R: 0 });
          const b    = this.meterBallistic.get(id) ?? { ...EMPTY_BALLISTIC };
          const m    = this._applyBallistics(inst, b, now);
          this.meterBallistic.set(id, m.next);
          meters[id] = m.out;
        }

        // Master
        {
          const m = this._applyBallistics(this.masterInstantPeak, this.masterBallistic, now);
          this.masterBallistic = m.next;
          meters["__master__"] = m.out;
        }

        for (const cb of this.meterCbs) cb(meters);
      }
      this.meterRafId = requestAnimationFrame(tick);
    };
    this.meterRafId = requestAnimationFrame(tick);
  }

  private _applyBallistics(
    inst: InstantPeak,
    b: MeterBallistic,
    now: number,
  ): { next: MeterBallistic; out: MeterData } {
    const instL = gainToDb(inst.L);
    const instR = gainToDb(inst.R);

    // Fast attack (instantaneous), Ardour-speed falloff
    const dispL = Math.max(instL, b.dispL - FALLOFF_PER_FRAME);
    const dispR = Math.max(instR, b.dispR - FALLOFF_PER_FRAME);

    // Peak hold
    let { peakL, peakR, peakTimeL, peakTimeR } = b;
    if (instL >= peakL) { peakL = instL; peakTimeL = now; }
    else if (now - peakTimeL > PEAK_HOLD_MS) peakL = Math.max(instL, peakL - FALLOFF_PER_FRAME);
    if (instR >= peakR) { peakR = instR; peakTimeR = now; }
    else if (now - peakTimeR > PEAK_HOLD_MS) peakR = Math.max(instR, peakR - FALLOFF_PER_FRAME);

    // Clip latch
    const clipping = b.clipping || inst.L >= 1.0 || inst.R >= 1.0;

    return {
      next: { dispL, dispR, peakL, peakR, peakTimeL, peakTimeR, clipping },
      out:  { leftDb: dispL, rightDb: dispR, peakLeftDb: peakL, peakRightDb: peakR, clipping },
    };
  }
}

export const webAudioEngine = new WebAudioEngine();
