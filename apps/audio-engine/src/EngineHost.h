#pragma once
/**
 * EngineHost — implements the AudioEngineBridge using Tracktion Engine.
 *
 * Called by main.cpp's JSON-RPC dispatcher.
 * All public methods are synchronous and may be called from the main thread.
 * The meter-poll thread is started in initialise() and stopped in shutdown().
 */

#include <tracktion_engine/tracktion_engine.h>
#include <functional>
#include <map>
#include <memory>
#include <string>
#include <thread>
#include <atomic>
#include <mutex>

namespace odeon {

// Opaque track record
struct TrackRecord {
    std::string trackId;
    std::string name;
    std::string role;
    std::string stemType;
    tracktion::engine::AudioTrack* track = nullptr;
};

// Meter data polled per track
struct MeterData {
    float leftDb  = -120.f;
    float rightDb = -120.f;
};

/**
 * JSON event callback: engine pushes transport / meter events
 * as JSON strings to be written to stdout by main.cpp.
 */
using EventCallback = std::function<void(const std::string& jsonLine)>;

class EngineHost {
public:
    explicit EngineHost(EventCallback onEvent);
    ~EngineHost();

    // Lifecycle
    void initialise();
    void shutdown();

    // ── AudioEngineBridge methods ──────────────────────────────────────────

    std::string createProject(const std::string& projectId);
    std::string loadProject(const std::string& projectId);

    std::string createTrack(const std::string& trackId,
                            const std::string& name,
                            const std::string& role,
                            const std::string& stemType);

    std::string loadAudioFile(const std::string& trackId,
                              const std::string& filePath);

    std::string addClip(const std::string& trackId,
                        const std::string& filePath,
                        double startTimeSeconds);

    std::string removeTrack(const std::string& trackId);

    std::string play();
    std::string stop();
    std::string seek(double timeSeconds);
    std::string getTransportState();

    std::string setTrackVolume(const std::string& trackId, float volumeDb);
    std::string setTrackPan(const std::string& trackId, float pan);
    std::string muteTrack(const std::string& trackId, bool muted);
    std::string soloTrack(const std::string& trackId, bool soloed);
    std::string getTrackMeters();

    std::string renderMix(const std::string& outputFilePath);
    std::string disposeProject();

private:
    void meterPollLoop();
    float linearToDb(float linear) const noexcept;

    EventCallback             onEvent_;
    std::unique_ptr<tracktion::engine::Engine> engine_;
    std::unique_ptr<tracktion::engine::Edit>   edit_;
    tracktion::engine::TransportControl*       transport_ = nullptr;

    std::map<std::string, TrackRecord> tracks_;   // trackId -> record
    std::mutex                         tracksMutex_;

    std::thread                        meterThread_;
    std::atomic<bool>                  meterRunning_{false};

    std::string currentProjectId_;
};

} // namespace odeon
