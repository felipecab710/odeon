# Diff-MST Implementation Notes

Research notes for implementing Diff-MST-inspired reference matching in Odeon.

Source paper: "Diff-MST: Differentiable Mixing Style Transfer" (ICASSP 2024)
https://arxiv.org/abs/2309.08250

---

## Core Architecture

```
reference_song ──► ReferenceEncoder ──► style_embedding (512-d)
                                              │
tracks[] ──► TrackEncoder[] ──► track_embeddings[]
                                              │
                         [style_embedding + track_embeddings]
                                              │
                                   TransformerController
                                              │
                                    predicted_parameters
                                    (one dict per track)
                                              │
                             DifferentiableMixingConsole (DMC)
                                              │
                                         predicted_mix
                                              │
                              AudioProductionStyleLoss
                                (vs reference_song)
```

---

## Reference Encoder

- Input: reference song (stereo, variable length)
- Architecture: CNN-based spectrogram encoder (mel-spectrogram → feature map)
- Output: fixed-length embedding capturing production style

Key idea: the reference encoder must learn "what kind of mix is this?"
not "what is the content?" — style must be content-agnostic.

Training strategy (from FxNorm-Automix): use wet/out-of-domain multitrack data.
Randomly assign stems to reference mixes. The model must learn the style, not the song.

---

## Track Encoder

- Input: individual stem (mono or stereo)
- Architecture: similar CNN structure to reference encoder
- Output: track embedding capturing spectral/dynamic character

One encoder shared across all tracks (track type identified by stem_type label or learned).

---

## Transformer Controller

- Input: style_embedding + N track_embeddings (concatenated as sequence)
- Architecture: standard Transformer (small, 4–6 layers)
- Output: parameter sequence — one parameter dict per input track

Parameters per track (from DMC schema):
  - gain_db, pan
  - eq: low_shelf, low_mid, mid, high_mid, high_shelf
  - comp: threshold, ratio, attack, release, makeup
  - stereo_width

The Transformer handles arbitrary numbers of tracks (no fixed N).
Positional encoding can encode stem_type (drums=0, bass=1, …) or be learned.

---

## Differentiable Mixing Console (DMC)

See dmc_console.py.

dasp-pytorch provides differentiable implementations of:
  - Gain
  - Parametric EQ (bell, shelves)
  - Compressor (with differentiable soft knee)
  - Pan (constant-power)
  - Stereo width (mid-side)
  - Reverb (placeholder: convolution reverb not yet in dasp-pytorch)

All operations are torch.autograd-compatible → loss can be backpropagated
all the way through the audio processing chain.

---

## Audio Production Style Loss

See losses.py.

Primary: Multi-Resolution STFT (MR-STFT) loss from auraloss.
  - Captures spectral similarity at multiple time scales.
  - Robust to pitch/content differences.

Auxiliary (feature-based):
  - RMS matching (loudness)
  - Crest factor matching (dynamics / compression level)
  - Stereo width matching (side-to-mid ratio)
  - Pan matching (L/R balance)
  - Per-band energy matching (7 Odeon bands)

---

## Training Data

Suitable datasets (check licenses before commercial use):
  - MUSDB18-HQ — stems + mixdown, licensed for research
  - MoisesDB — stems + mixdown, check commercial terms
  - Cambridge MT / Mixing Secrets — manually cleaned multitracks
  - Slakh2100 — synthesized but large-scale, good for pretraining

FxNorm-Automix strategy: use wet mixes as pseudo-training targets.
Mix N randomly-selected stems from different songs → random "style reference".
Train the model to match that combined-stems-as-reference style.

---

## Odeon Integration Plan (Phase 4)

1. Train or fine-tune a DMC controller on available multitrack data.
2. At inference: pass reference full mix + user stems through pipeline.
3. Controller outputs parameter predictions.
4. Show parameter predictions in Odeon UI alongside rule-based MixMoves.
5. User can accept/edit predicted parameters and apply them in their DAW.

Phase 4 does NOT need real-time DSP processing — offline inference is fine.
The DMC output is a parameter JSON, not a rendered audio file.
Rendering a "matched preview" is Phase 3 (using only gain/pan/EQ approximation).

---

## Important Product Note

Odeon does NOT claim to:
  - Recover the exact original engineer's plugin chain
  - Know which plugins were used
  - Reproduce the original mix perfectly

Odeon estimates plausible mix characteristics and produces human-editable
DAW-ready guidance that moves the user's song closer to the reference.
