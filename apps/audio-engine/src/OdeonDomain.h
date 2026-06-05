#pragma once
/**
 * OdeonDomain — pure data model for the Odeon session engine.
 *
 * Mirrors the route-graph model borrowed conceptually from Ardour
 * (Session -> Route -> Playlist -> Region(Clip) <- Source) and the
 * shared TypeScript types in @odeon/shared. These structs carry no
 * Tracktion types so they can be serialized to/from project.odeon JSON.
 */

#include <string>
#include <vector>
#include <map>

namespace odeon {

// ── Route role / stem type (mirror packages/shared/src/types.ts) ──────────

enum class RouteRole {
    reference,   // a reference track (the target sound)
    user,        // the user's own stem/track
    analysis,    // native AI analysis tap route (no audible output by default)
    bus,         // a group/aux bus (v2+)
    master       // the master output
};

enum class StemType {
    full_mix,
    drums,
    bass,
    vocals,
    music,
    other,
    fx
};

inline std::string toString(RouteRole r) {
    switch (r) {
        case RouteRole::reference: return "reference";
        case RouteRole::user:      return "user";
        case RouteRole::analysis:  return "analysis";
        case RouteRole::bus:       return "bus";
        case RouteRole::master:    return "master";
    }
    return "user";
}

inline RouteRole roleFromString(const std::string& s) {
    if (s == "reference") return RouteRole::reference;
    if (s == "analysis")  return RouteRole::analysis;
    if (s == "bus")       return RouteRole::bus;
    if (s == "master")    return RouteRole::master;
    return RouteRole::user;
}

inline std::string toString(StemType s) {
    switch (s) {
        case StemType::full_mix: return "full_mix";
        case StemType::drums:    return "drums";
        case StemType::bass:     return "bass";
        case StemType::vocals:   return "vocals";
        case StemType::music:    return "music";
        case StemType::other:    return "other";
        case StemType::fx:       return "fx";
    }
    return "other";
}

inline StemType stemFromString(const std::string& s) {
    if (s == "full_mix") return StemType::full_mix;
    if (s == "drums")    return StemType::drums;
    if (s == "bass")     return StemType::bass;
    if (s == "vocals")   return StemType::vocals;
    if (s == "music")    return StemType::music;
    if (s == "fx")       return StemType::fx;
    return StemType::other;
}

// ── Source / Clip / Playlist (non-destructive, Ardour-style) ──────────────
// One AudioSource (a real file) can back many AudioClips. A clip is a slice
// placed on the timeline: POSITION (startTime), START-within-source
// (sourceOffset) and LENGTH (duration) — see Ardour region.h:138-147.

struct AudioSource {
    std::string sourceId;
    std::string filePath;      // absolute path to the imported file
    double      sampleRate = 0.0;
    int         channels   = 0;
    double      duration   = 0.0;  // seconds
    std::string hash;              // optional content hash (reserved)
    bool        missing    = false;
};

struct AudioClip {
    std::string clipId;
    std::string sourceId;
    std::string trackId;
    double      startTime    = 0.0;  // POSITION on the timeline (seconds)
    double      sourceOffset = 0.0;  // START within the source (seconds)
    double      duration     = 0.0;  // LENGTH (seconds)
    double      gainDb       = 0.0;
};

// Mix parameters that persist per route.
struct RouteMixState {
    float volumeDb = 0.0f;
    float pan      = 0.0f;   // -1..1
    bool  muted    = false;
    bool  soloed   = false;
};

// Live meter snapshot (peak + smoothed/RMS), per channel.
struct MeterData {
    float peakLeftDb  = -120.f;
    float peakRightDb = -120.f;
    float rmsLeftDb   = -120.f;
    float rmsRightDb  = -120.f;
};

// ── Small JSON serialization helpers (no external dependency) ─────────────

inline std::string jsonQuote(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 2);
    out += '"';
    for (char c : s) {
        if      (c == '"')  out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else if (c == '\t') out += "\\t";
        else                out += c;
    }
    out += '"';
    return out;
}

inline std::string jsonOk(const std::string& payload = "null") {
    return "{\"ok\":true,\"result\":" + payload + "}";
}

inline std::string jsonErr(const std::string& msg) {
    return "{\"ok\":false,\"error\":" + jsonQuote(msg) + "}";
}

} // namespace odeon
