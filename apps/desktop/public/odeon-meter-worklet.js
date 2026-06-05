/**
 * OdeonMeterProcessor — AudioWorklet peak meter (Ardour PeakMeter equivalent).
 *
 * Ardour's PeakMeter runs in the process() callback every audio buffer frame.
 * This worklet does the same: measures peak L/R every 128-sample block and
 * posts results to the main thread every 4 blocks (~10.7 ms at 48 kHz).
 *
 * The worklet is a PASS-THROUGH node — it copies input to output so the signal
 * chain is uninterrupted. All ballistics (falloff, peak hold) run in JS on the
 * main thread, matching Ardour's pattern where PeakMeter posts raw peaks and
 * the UI applies display-rate smoothing.
 */
class OdeonMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frame = 0;
  }

  /**
   * @param {Float32Array[][]} inputs  - inputs[0] = current node input channels
   * @param {Float32Array[][]} outputs - outputs[0] = current node output channels
   */
  process(inputs, outputs) {
    const input  = inputs[0];
    const output = outputs[0];

    // ── Pass-through: copy input → output (no DSP modification) ──────────────
    if (input && output) {
      const numCh = Math.min(input.length, output.length);
      for (let ch = 0; ch < numCh; ch++) {
        if (input[ch] && output[ch]) output[ch].set(input[ch]);
      }
    }

    // ── Peak detection ────────────────────────────────────────────────────────
    const L = input?.[0];
    const R = input?.[1] ?? input?.[0];   // mono → duplicate to R

    if (L && L.length > 0) {
      let peakL = 0, peakR = 0;
      for (let i = 0; i < L.length; i++) {
        const al = Math.abs(L[i]);
        const ar = R ? Math.abs(R[i]) : al;
        if (al > peakL) peakL = al;
        if (ar > peakR) peakR = ar;
      }

      // Post every 4 blocks ≈ 4×128/48000 = ~10.7 ms (much faster than AnalyserNode)
      if (++this._frame % 4 === 0) {
        this.port.postMessage({ peakL, peakR });
      }
    } else {
      // Silence block — still post so ballistics can decay
      if (++this._frame % 4 === 0) {
        this.port.postMessage({ peakL: 0, peakR: 0 });
      }
    }

    return true; // keep processor alive
  }
}

registerProcessor("odeon-meter", OdeonMeterProcessor);
