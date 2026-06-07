#pragma once
/**
 * OdeonDeckPlayer — Mixxx EngineBuffer playback state for one CDJ deck.
 * Owns local position and play state; independent of shared edit transport.
 */

#include <algorithm>
#include <cmath>

namespace odeon {

struct OdeonDeckPlayer {
    double localPositionSeconds = 0.0;
    double durationSeconds      = 0.0;
    double rate                 = 1.0;
    bool   isPlaying            = false;
    bool   keylock              = false;

    void seek(double localSeconds, double durationLimit) {
        const double maxSec = durationLimit > 0.0 ? durationLimit : localSeconds;
        localPositionSeconds = std::clamp(localSeconds, 0.0, maxSec);
    }

    void advance(double deltaSeconds) {
        if (!isPlaying || deltaSeconds <= 0.0) return;
        localPositionSeconds += deltaSeconds * rate;
        if (durationSeconds > 0.0)
            localPositionSeconds = std::min(localPositionSeconds, durationSeconds);
    }

    void applyLoop(double inSec, double outSec) {
        if (outSec <= inSec + 0.05) return;
        if (localPositionSeconds >= outSec - 0.002)
            localPositionSeconds = inSec;
    }
};

} // namespace odeon
