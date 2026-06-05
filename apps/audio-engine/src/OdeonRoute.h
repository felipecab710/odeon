#pragma once
/**
 * OdeonRoute — Odeon's equivalent of an Ardour Route (graph.h / route.cc):
 * a track is not just visual, it is a route through the mixer. This wraps a
 * Tracktion AudioTrack and adds Odeon semantics (role, stemType), the mix
 * state, a level-measurer Client for metering, and the native AI analysis
 * tap seam.
 *
 * Owned by OdeonSession. Pointers into Tracktion are non-owning (the Edit
 * owns the AudioTrack).
 */

#include <tracktion_engine/tracktion_engine.h>
#include "OdeonDomain.h"

namespace odeon {

namespace te = tracktion::engine;

struct OdeonRoute {
    std::string id;
    std::string name;
    RouteRole   role     = RouteRole::user;
    StemType    stemType = StemType::other;

    RouteMixState mix;

    // Non-owning pointer to the Tracktion track (the Edit owns it).
    te::AudioTrack* track = nullptr;

    // Clips placed on this route's playlist.
    std::vector<AudioClip> clips;

    // ── Metering ──────────────────────────────────────────────────────────
    // A registered client on the track's LevelMeterPlugin measurer. Reading
    // levels is lock-free from the poll thread; the audio thread fills it.
    te::LevelMeasurer::Client meterClient;
    bool meterClientRegistered = false;

    // Smoothed (RMS-style ballistics) level state in linear domain.
    float rmsLinL = 0.f;
    float rmsLinR = 0.f;

    // ── AI analysis seam ────────────────────────────────────────────────────
    // When role == analysis (or analysis is requested), this route's audio can
    // be copied out to the async AI service. v1 ships the seam; heavy ML stays
    // in the Python service and never runs on the audio thread.
    bool analysisEnabled = false;
};

} // namespace odeon
