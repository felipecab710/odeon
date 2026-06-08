#pragma once
/**
 * OdeonDjDeck — per-CDJ deck state (Mixxx EngineBuffer model).
 * Each deck owns one route (deck:N) with a single wave clip on the timeline.
 */

#include "OdeonDeckPlayer.h"

#include <tracktion_engine/tracktion_engine.h>
#include <array>
#include <string>
#include <vector>

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

/** Pre-loaded stem layer for instant SRC switching (Select preview). */
struct DeckStemLayer {
    std::string layerId;   // vocals | drums | bass | other
    std::string trackId;   // deck:0:stem:vocals
    std::string filePath;
    double      duration  = 0.0;
    bool        loaded    = false;
    te::WaveAudioClip* waveClip = nullptr;
};

struct OdeonDjDeck {
    int         deckIndex     = -1;
    std::string trackId;          // "deck:0" … "deck:3"
    std::string filePath;
    std::string clipId;
    double      timelineStart = 0.0;  // set-layout schedule hint (UI), not clip position
    double      duration      = 0.0;
    double      rate          = 1.0;
    OdeonDeckPlayer player;
    double      bpm           = 128.0;
    bool        loaded        = false;
    bool        syncFollower  = false;

    std::array<DeckHotcue, 8> hotcues{};
    int      hotcueCount = 0;
    DeckLoop loop{};

    // Non-owning pointer into the Tracktion edit.
    te::WaveAudioClip* waveClip = nullptr;

    // Full-mix anchor (deck:0) — restored when SRC = FULL.
    std::string        fullMixFilePath;
    te::WaveAudioClip* fullMixClip = nullptr;

    // Pre-loaded stem routes — switch via mute (no file reload).
    std::vector<DeckStemLayer> stemLayers;
    std::string activeStemLayer = "full";
    bool        stemLayersReady = false;
};

} // namespace odeon
