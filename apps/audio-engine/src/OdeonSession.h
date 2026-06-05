#pragma once
/**
 * OdeonSession — the center of the engine. In Ardour terms this is the
 * Session: it owns sample rate, transport, the route graph, the clips/sources,
 * the mixer state and rendering. The UI only reflects this; the session is the
 * single source of truth.
 *
 * Wraps Tracktion Engine: OdeonSession owns the te::Engine + te::Edit and a map
 * of OdeonRoute (which wrap te::AudioTrack). Persistence is a custom
 * project.odeon JSON written atomically into a full "Odeon Project/" folder.
 *
 * Threading: all public methods are intended to be called from the message
 * thread (main thread). The meter poll happens on a dedicated thread that only
 * reads lock-free level data. No ML / disk / UI work happens on the audio thread.
 */

#include <tracktion_engine/tracktion_engine.h>
#include <functional>
#include <map>
#include <memory>
#include <mutex>
#include <atomic>
#include <thread>
#include <string>

#include "OdeonDomain.h"
#include "OdeonRoute.h"

namespace odeon {

namespace te = tracktion::engine;

using EventCallback = std::function<void(const std::string& jsonLine)>;

class OdeonSession {
public:
    explicit OdeonSession(EventCallback onEvent);
    ~OdeonSession();

    void initialise();   // boot Tracktion engine + audio device + meter thread
    void shutdown();

    // ── Session lifecycle ───────────────────────────────────────────────────
    std::string createSession(const std::string& projectId, const std::string& projectDir);
    std::string openSession(const std::string& projectId, const std::string& projectDir);
    std::string saveSession();
    std::string disposeSession();

    // ── Routes / tracks ──────────────────────────────────────────────────────
    std::string createTrack(const std::string& trackId, const std::string& name,
                            const std::string& role, const std::string& stemType);
    std::string removeTrack(const std::string& trackId);
    std::string addClip(const std::string& trackId, const std::string& clipId,
                        const std::string& filePath, double startTimeSeconds);

    // ── Transport ─────────────────────────────────────────────────────────────
    std::string play();
    std::string stop();
    std::string seek(double timeSeconds);
    std::string setLoop(bool enabled, double startSeconds, double endSeconds);
    std::string getTransportState();

    // ── Mixer ──────────────────────────────────────────────────────────────────
    std::string setTrackVolume(const std::string& trackId, float volumeDb);
    std::string setTrackPan(const std::string& trackId, float pan);
    std::string muteTrack(const std::string& trackId, bool muted);
    std::string soloTrack(const std::string& trackId, bool soloed);
    std::string getTrackMeters();

    // ── Render ──────────────────────────────────────────────────────────────────
    std::string renderMix(const std::string& outputFilePath);

    // ── AI native seam ────────────────────────────────────────────────────────
    std::string analyze(const std::string& trackId);

    // Pump-friendly: lets the host run the message loop between calls.
    bool hasActiveSession() const { return edit_ != nullptr; }
    bool isDeviceReady() const {
        return engine_ && engine_->getDeviceManager().getNumWaveOutDevices() > 0;
    }
    double positionSeconds() const {
        if (!transport_) return 0.0;
        if (auto* ctx = transport_->getCurrentPlaybackContext())
            return ctx->getPosition().inSeconds();   // live playhead during playback
        return transport_->getPosition().inSeconds();
    }

private:
    OdeonRoute* findRoute(const std::string& trackId);
    void        ensureProjectFolders(const juce::File& root);
    juce::File  projectFolder() const;
    std::string serializeProjectJson() const;
    bool        writeAtomic(const juce::File& dest, const juce::String& contents, juce::String& error);
    void        logEngineError(const std::string& where, const std::string& message);

    void  meterPollLoop();
    float linearToDb(float linear) const noexcept;
    float dbToLinear(float db) const noexcept;

    EventCallback onEvent_;

    std::unique_ptr<te::Engine> engine_;
    std::unique_ptr<te::Edit>   edit_;
    te::TransportControl*       transport_ = nullptr;

    std::map<std::string, std::unique_ptr<OdeonRoute>> routes_;
    std::mutex routesMutex_;

    std::string currentProjectId_;
    juce::File  projectDir_;

    std::thread       meterThread_;
    std::atomic<bool> meterRunning_{false};
    bool              deviceReady_ = false;

    static constexpr int kSchemaVersion = 1;
};

} // namespace odeon
