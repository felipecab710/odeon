# Research References

Core research stack for Odeon's AI mixing workbench.

---

## 1. Diff-MST

**"Diff-MST: Differentiable Mixing Style Transfer"**
Kosta et al., ICASSP 2024. https://arxiv.org/abs/2309.08250

**Role in Odeon**: Conceptual blueprint for the differentiable mixing pipeline.

Key ideas:
- Reference song encoder → style embedding
- Per-track encoder → track embeddings
- Transformer controller → mix parameter predictions (one dict per track)
- Differentiable mixing console (DMC) → predicted mix audio
- Audio production style loss (MRSTFT + feature losses)
- Editable, interpretable parameter output (not black-box audio)

The crucial insight: the system outputs a parameter dict per track, not a black-box audio rendering. Users can inspect and edit the predicted parameters before applying them in a DAW.

---

## 2. Diff-MSTC

**"Diff-MSTC: Differentiable Mixing Style Transfer with DAW Integration"**

**Role in Odeon**: Product precedent for DAW integration.

Study this as the direction for user-editable mix parameters inside a real DAW workflow (Cubase integration). Demonstrates that predicted parameters can be exported as DAW-readable automation/preset data.

---

## 3. Automatic Multitrack Mixing With a Differentiable Mixing Console

Steinmetz et al., ISMIR 2021. https://arxiv.org/abs/2010.10291

**Role in Odeon**: Foundation for parameter-estimation automatic mixing.

Introduces the differentiable mixing console concept. The DMC applies gain, pan, EQ, compression as differentiable operations. Loss is backpropagated through the audio processing chain.

This is the direct source of the DMC architecture used in Diff-MST.

---

## 4. Reverse Engineering of a Recording Mix with Differentiable DSP

Steinmetz et al., ICASSP 2023.

**Role in Odeon**: Direct inverse-mixing reference.

Estimates hidden gain, pan, EQ, delay, and reverb-style parameters from a set of stems and their mixdown using differentiable DSP. Directly relevant to Odeon's MixMove estimation problem.

---

## 5. dasp-pytorch

https://github.com/csteinmetz1/dasp-pytorch

**Role in Odeon**: Differentiable DSP building blocks.

Provides torch.autograd-compatible implementations of:
- Gain
- Parametric EQ (bell, shelves)
- Dynamic range compressor (soft knee)
- Pan (constant-power)
- Stereo width (mid-side)
- Reverb (convolution)
- Distortion

All operations are differentiable → gradients flow through the audio processing chain.

Use in Phase 4 for the DMC implementation.

---

## 6. auraloss

https://github.com/csteinmetz1/auraloss

**Role in Odeon**: Audio losses for training and evaluation.

Provides:
- Multi-resolution STFT (MR-STFT) loss — primary perceptual similarity loss
- Spectral convergence loss
- Log magnitude loss
- STFT loss with various windowing options
- Mel-spectrogram loss (perceptual frequency weighting)

Use in Phase 4 alongside the AudioProductionStyleLoss feature-based losses.

---

## 7. Demucs

**"Hybrid Demucs: Music Source Separation"**
Défossez et al. https://github.com/facebookresearch/demucs

**Role in Odeon**: First practical stem separation implementation.

Demucs (especially htdemucs, the hybrid model) separates a stereo mix into drums, bass, vocals, and other with state-of-the-art quality.

Phase 1: abstraction layer (NoOpStemSeparator falls back gracefully).
Phase 2: DemucsStemSeparator active on reference upload.

---

## 8. BS-RoFormer / Mel-Band RoFormer

**"Music Source Separation with Band-Split RoFormer"**
https://arxiv.org/abs/2309.02612

**Role in Odeon**: Modern source separation model direction.

BS-RoFormer achieves top separation quality by splitting audio into frequency bands and processing each with a Roformer (rotary-position attention Transformer). Mel-Band variant uses mel-scale band splits.

Use in Phase 2/3 as an optional higher-quality separator.

---

## 9. Music-Source-Separation-Training

https://github.com/ZFTurbo/Music-Source-Separation-Training

**Role in Odeon**: Modern source separation training and evaluation repo.

Includes MDX-style, BS-RoFormer, and Mel-Band RoFormer models. Good for custom training or fine-tuning a separator on domain-specific data.

---

## 10. automix-toolkit

https://github.com/csteinmetz1/automix-toolkit

**Role in Odeon**: Automatic mixing research baseline.

Provides training recipes, evaluation metrics, and pre-trained models for automatic mixing. Use as a baseline for comparing Odeon's parameter estimation quality.

---

## 11. FxNorm-Automix

**"Automatic Music Mixing with Deep Learning and Out-of-Domain Data"**
De Man et al. https://arxiv.org/abs/2208.11428

**Role in Odeon**: Training strategy for sparse paired data.

Key insight: clean dry/wet paired multitrack data is scarce. FxNorm trains with "wet" out-of-domain data by treating random combinations of wet stems as pseudo-references.

Apply this strategy in Phase 4 to train the Odeon DMC controller without requiring a large curated dataset.

---

## 12. Music Mixing Style Transfer with Contrastive Learning

**"Contrastive Learning for Audio Production Style Representations"**

**Role in Odeon**: Alternative style embedding approach.

Uses contrastive learning to build content-agnostic style embeddings from reference songs. Alternative to the supervised encoder approach in Diff-MST.

Study for Phase 4 as a potential improvement to the reference encoder.

---

## 13. WildFX

**Role in Odeon**: Future direction for real-world plugin modeling.

Models real DAW plugin chains (VST/AU) including non-linear effects like distortion, saturation, and complex reverbs that simple differentiable DSP cannot capture.

Use in Phase 5 when moving beyond parametric EQ/compression into real plugin chain estimation.

---

## 14. MixAssist

**Role in Odeon**: Future audio-language explanation layer.

Converts measurements and MixMoves into natural-language producer-facing coaching copy. The goal: turn "delta_db: 3.2 in low_mid_160_500" into "Your bass sounds muddy in the 200–400 Hz range. Try a bell cut."

Use in Phase 5 to upgrade the Odeon AI panel from data display to genuine coaching.

---

## 15. Tracktion Engine

https://github.com/Tracktion/tracktion_engine

**Role in Odeon**: Professional DAW-style playback and rendering engine.

Provides Edit/Track/Clip/Transport/Render architecture used in production DAWs. Enables sample-accurate synchronization, stable audio clocking, and high-quality offline rendering. Used as the core of `apps/audio-engine`.

License: GPLv3 or commercial. See [docs/AUDIO_ENGINE.md](AUDIO_ENGINE.md).

---

## 16. JUCE

https://juce.com

**Role in Odeon**: Professional audio application and plugin framework.

Provides platform-abstracted audio I/O (CoreAudio, WASAPI, ALSA), format handling (WAV/FLAC/AIFF/MP3 reading), and plugin infrastructure (VST3/AU). Required by Tracktion Engine.

Used directly for audio device management, file reading/writing, and the headless engine executable structure.

---

## Datasets (license check required before commercial use)

| Dataset | Content | License Note |
|---------|---------|--------------|
| MUSDB18-HQ | 150 songs with stems + mix | Research/non-commercial |
| MoisesDB | 240 songs with stems + mix | Check commercial terms |
| Cambridge MT / Mixing Secrets | Pro multitrack sessions | Educational, attribution required |
| MedleyDB / MedleyDB 2.0 | Multitrack recordings | Creative Commons variants |
| MTG-Jamendo | Large music collection | Various CC licenses |
| Slakh2100 | Synthesized multitracks | Creative Commons |

**Always verify license terms before using any dataset for commercial model training.**
