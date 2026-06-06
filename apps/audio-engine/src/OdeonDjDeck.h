#pragma once
/**
 * OdeonDjDeck — per-CDJ deck state (Mixxx EngineBuffer model).
 * Each deck owns one route (deck:N) with a single wave clip on the timeline.
 */

#include <tracktion_engine/tracktion_engine.h>
#include <array>
#include <string>

namespace odeon {

namespace te = tracktion::engine;

struct DeckHotcue {
    int    slot       = 0;
    double timeSeconds = 0.0;
};

struct DeckLoop {
    bool   active     = false;
    double inSeconds  = 0.0;
    double outSeconds = 0.0;
};

struct OdeonDjDeck {
    int         deckIndex     = -1;
    std::string trackId;          // "deck:0" … "deck:3"
    std::string filePath;
    std::string clipId;
    double      timelineStart = 0.0;
    double      duration      = 0.0;
    double      rate          = 1.0;
    double      bpm           = 128.0;
    bool        loaded        = false;
    bool        syncFollower  = false;

    std::array<DeckHotcue, 8> hotcues{};
    int      hotcueCount = 0;
    DeckLoop loop{};

    // Non-owning pointer into the Tracktion edit.
    te::WaveAudioClip* waveClip = nullptr;
};

} // namespace odeon
