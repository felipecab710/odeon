#pragma once

#include <tracktion_engine/tracktion_engine.h>

namespace odeon {

/** Runtime playback-engine tuning exposed to the UI. */
struct PlaybackEngineConfig {
    bool dynamicPluginProcessing = true;
    bool optimizeLowBuffer       = false;
    int  maxRealtimeThreads      = 0;   // 0 = auto
};

/**
 * Custom EngineBehaviour — wires Pro Tools-style playback settings into
 * Tracktion's graph scheduling and CPU limits.
 */
class OdeonEngineBehaviour : public tracktion::engine::EngineBehaviour {
public:
    explicit OdeonEngineBehaviour(PlaybackEngineConfig* config) : config_(config) {}

    bool shouldProcessMutedTracks() override {
        return config_ != nullptr && !config_->dynamicPluginProcessing;
    }

    bool enableReadAheadForTimeStretchNodes() override {
        return config_ != nullptr && config_->optimizeLowBuffer;
    }

    int getNumberOfCPUsToUseForAudio() override {
        if (config_ == nullptr || config_->maxRealtimeThreads <= 0)
            return tracktion::engine::EngineBehaviour::getNumberOfCPUsToUseForAudio();
        return juce::jlimit(1, juce::SystemStats::getNumCpus(), config_->maxRealtimeThreads);
    }

private:
    PlaybackEngineConfig* config_;
};

} // namespace odeon
