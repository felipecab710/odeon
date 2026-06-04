"""
Audio losses for differentiable mixing training — research placeholder.

Status: PLACEHOLDER — not wired into the Odeon MVP.
Wire in for Phase 4 (differentiable mixing experiments).

Planned losses (via auraloss):
  - Multi-resolution STFT (MR-STFT) — primary perceptual similarity loss
  - Spectral convergence
  - Log magnitude
  - Feature-based losses: RMS, crest factor, stereo width, pan

References:
  - auraloss: https://github.com/csteinmetz1/auraloss
  - Diff-MST: https://arxiv.org/abs/2309.08250
"""
from __future__ import annotations

# Future import: import torch
# Future import: import torch.nn as nn
# Future import: import auraloss.freq as afl
# Future import: import auraloss.time as atl


class AudioProductionStyleLoss:
    """
    Composite loss for training a differentiable mixing system.

    Combines:
      1. Multi-resolution STFT loss   (spectral similarity)
      2. RMS loss                      (loudness matching)
      3. Crest factor loss             (dynamics matching)
      4. Stereo imbalance loss         (L/R balance)
      5. Side-to-mid ratio loss        (width matching)

    All components are differentiable w.r.t. the mix parameters.

    NOT IMPLEMENTED — placeholder with documented interface.
    """

    def __init__(self, sample_rate: int = 44100):
        self.sample_rate = sample_rate
        # Future:
        # self.mrstft = afl.MultiResolutionSTFTLoss(
        #     fft_sizes=[512, 1024, 2048, 4096],
        #     hop_sizes=[128, 256, 512, 1024],
        #     win_lengths=[512, 1024, 2048, 4096],
        # )

    def forward(self, predicted_mix, reference_mix):
        """
        Compute composite loss between predicted_mix and reference_mix.

        Args:
            predicted_mix: torch.Tensor (2, N) — output of DMC
            reference_mix: torch.Tensor (2, N) — reference song

        Returns:
            torch.Tensor scalar — total loss

        NOT IMPLEMENTED.
        """
        raise NotImplementedError("AudioProductionStyleLoss is a research placeholder.")


def rms_loss(predicted, reference):
    """RMS energy matching loss (placeholder)."""
    raise NotImplementedError


def crest_factor_loss(predicted, reference):
    """Crest factor (dynamics) matching loss (placeholder)."""
    raise NotImplementedError


def stereo_width_loss(predicted, reference):
    """Side-to-mid ratio matching loss (placeholder)."""
    raise NotImplementedError


def spectral_band_loss(predicted, reference, sr: int = 44100):
    """
    Per-frequency-band energy matching loss.
    Matches the 7-band profile from Odeon's FrequencyProfile.
    Placeholder.
    """
    raise NotImplementedError
