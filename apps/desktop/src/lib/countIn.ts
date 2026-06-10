/**
 * Pre-roll count-in clicks before playback (1 bar by default).
 * Uses Web Audio beeps — independent of engine click track.
 */
export async function runCountIn(
  bpm: number,
  bars: number,
  beatsPerBar: number,
): Promise<void> {
  const safeBpm = Math.max(20, Math.min(300, bpm));
  const beatMs = (60 / safeBpm) * 1000;
  const totalBeats = Math.max(1, bars * beatsPerBar);

  let ctx: AudioContext | null = null;
  try {
    ctx = new AudioContext();
  } catch {
    await sleep(totalBeats * beatMs);
    return;
  }

  const start = ctx.currentTime + 0.05;
  for (let i = 0; i < totalBeats; i++) {
    const t = start + (i * beatMs) / 1000;
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.type = "sine";
    osc.frequency.value = i % beatsPerBar === 0 ? 1200 : 900;
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.06);
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.start(t);
    osc.stop(t + 0.07);
  }

  await sleep(totalBeats * beatMs + 80);
  await ctx.close().catch(() => undefined);
}

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}
