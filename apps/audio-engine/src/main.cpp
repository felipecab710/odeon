/**
 * odeon-engine: JSON-RPC stdio loop for the Odeon audio engine.
 *
 * Protocol:
 *   stdin  -> one JSON object per line: { "id": N, "method": "...", "params": {...} }
 *   stdout -> one JSON object per line: response { "id": N, "result": ... } or event { "event": ... }
 *
 * The Tauri sidecar reads stdout and dispatches responses/events.
 */

#include <juce_core/juce_core.h>
#include <iostream>
#include <string>
#include <mutex>

#include "EngineHost.h"

// stdout must be thread-safe (meter thread + main thread both write)
static std::mutex g_stdoutMutex;

static void writeLine(const std::string& line) {
    std::lock_guard<std::mutex> lk(g_stdoutMutex);
    std::cout << line << "\n";
    std::cout.flush();
}

// ─────────────────────────────────────────────
//  JSON parsing helpers (minimal, no external lib)
// ─────────────────────────────────────────────

static std::string extractString(const juce::var& v, const char* key,
                                 const std::string& def = "") {
    auto val = v[key];
    if (val.isString()) return val.toString().toStdString();
    return def;
}

static double extractDouble(const juce::var& v, const char* key, double def = 0.0) {
    auto val = v[key];
    if (val.isDouble() || val.isInt() || val.isInt64())
        return static_cast<double>(val);
    return def;
}

static bool extractBool(const juce::var& v, const char* key, bool def = false) {
    auto val = v[key];
    if (val.isBool()) return static_cast<bool>(val);
    return def;
}

static float extractFloat(const juce::var& v, const char* key, float def = 0.f) {
    return static_cast<float>(extractDouble(v, key, static_cast<double>(def)));
}

// ─────────────────────────────────────────────
//  RPC dispatcher
// ─────────────────────────────────────────────

static std::string dispatch(odeon::EngineHost& host,
                            const std::string& method,
                            const juce::var& params) {
    if (method == "createProject")
        return host.createProject(extractString(params, "projectId"));
    if (method == "loadProject")
        return host.loadProject(extractString(params, "projectId"));
    if (method == "createTrack")
        return host.createTrack(
            extractString(params, "trackId"),
            extractString(params, "name"),
            extractString(params, "role"),
            extractString(params, "stemType"));
    if (method == "loadAudioFile")
        return host.loadAudioFile(
            extractString(params, "trackId"),
            extractString(params, "filePath"));
    if (method == "addClip")
        return host.addClip(
            extractString(params, "trackId"),
            extractString(params, "filePath"),
            extractDouble(params, "startTimeSeconds"));
    if (method == "removeTrack")
        return host.removeTrack(extractString(params, "trackId"));
    if (method == "play")
        return host.play();
    if (method == "stop")
        return host.stop();
    if (method == "seek")
        return host.seek(extractDouble(params, "timeSeconds"));
    if (method == "getTransportState")
        return host.getTransportState();
    if (method == "setTrackVolume")
        return host.setTrackVolume(
            extractString(params, "trackId"),
            extractFloat(params, "volumeDb"));
    if (method == "setTrackPan")
        return host.setTrackPan(
            extractString(params, "trackId"),
            extractFloat(params, "pan"));
    if (method == "muteTrack")
        return host.muteTrack(
            extractString(params, "trackId"),
            extractBool(params, "muted"));
    if (method == "soloTrack")
        return host.soloTrack(
            extractString(params, "trackId"),
            extractBool(params, "soloed"));
    if (method == "getTrackMeters")
        return host.getTrackMeters();
    if (method == "renderMix")
        return host.renderMix(extractString(params, "outputFilePath"));
    if (method == "disposeProject")
        return host.disposeProject();

    return "{\"ok\":false,\"error\":\"Unknown method: " + method + "\"}";
}

// ─────────────────────────────────────────────
//  Main
// ─────────────────────────────────────────────

int main() {
    // Disable JUCE's signal handler to keep stderr clean
    juce::ignoreUnused(juce::JUCEApplicationBase::createInstance);

    odeon::EngineHost host([](const std::string& line) {
        writeLine(line);
    });

    host.initialise();

    std::string line;
    while (std::getline(std::cin, line)) {
        if (line.empty()) continue;

        juce::var parsed;
        auto parseResult = juce::JSON::parse(juce::String(line), parsed);

        if (parseResult.failed()) {
            writeLine("{\"id\":null,\"error\":\"JSON parse error: " +
                      parseResult.getErrorMessage().toStdString() + "\"}");
            continue;
        }

        int    rpcId  = static_cast<int>(parsed["id"]);
        std::string method = extractString(parsed, "method");
        juce::var   params = parsed["params"];

        std::string resultPayload = dispatch(host, method, params);

        // Wrap in RPC envelope
        std::string response =
            "{\"id\":" + std::to_string(rpcId) +
            ",\"result\":" + resultPayload + "}";

        writeLine(response);
    }

    host.shutdown();
    return 0;
}
