/**
 * OdeonMeterProcessor — AudioWorklet peak meter (Ardour PeakMeter equivalent).
 *
 * Measures peak L/R every audio block and posts the max of every 4 blocks
 * (~10.7 ms at 48 kHz) so inter-block peaks are not missed.
 */
class OdeonMeterProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this._frame = 0;
    this._accL = 0;
    this._accR = 0;
  }

  process(inputs, outputs) {
    const input  = inputs[0];
    const output = outputs[0];

    if (input && output) {
      const numCh = Math.min(input.length, output.length);
      for (let ch = 0; ch < numCh; ch++) {
        if (input[ch] && output[ch]) output[ch].set(input[ch]);
      }
    }

    const L = input?.[0];
    const R = input?.[1] ?? input?.[0];

    if (L && L.length > 0) {
      let blockL = 0;
      let blockR = 0;
      for (let i = 0; i < L.length; i++) {
        const al = Math.abs(L[i]);
        const ar = R ? Math.abs(R[i]) : al;
        if (al > blockL) blockL = al;
        if (ar > blockR) blockR = ar;
      }
      if (blockL > this._accL) this._accL = blockL;
      if (blockR > this._accR) this._accR = blockR;
    }

    if (++this._frame % 4 === 0) {
      this.port.postMessage({ peakL: this._accL, peakR: this._accR });
      this._accL = 0;
      this._accR = 0;
    }

    return true;
  }
}

registerProcessor("odeon-meter", OdeonMeterProcessor);
