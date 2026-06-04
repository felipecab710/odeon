#include "EngineHost.h"

#include <cmath>
#include <chrono>
#include <sstream>

namespace odeon {

// ─────────────────────────────────────────────
//  Small JSON helpers (no external dep needed)
// ─────────────────────────────────────────────

static std::string jsonOk(const std::string& payload = "null") {
    return "{\"ok\":true,\"result\":" + payload + "}";
}

static std::string jsonErr(const std::string& msg) {
    return "{\"ok\":false,\"error\":\"" + msg + "\"}";
}

static std::string jsonQuote(const std::string& s) {
    std::string out;
    out.reserve(s.size() + 2);
    out += '"';
    for (char c : s) {
        if (c == '"')  out += "\\\"";
        else if (c == '\\') out += "\\\\";
        else if (c == '\n') out += "\\n";
        else if (c == '\r') out += "\\r";
        else                out += c;
    }
    out += '"';
    return out;
}

// ─────────────────────────────────────────────
//  Lifecycle
// ─────────────────────────────────────────────

EngineHost::EngineHost(EventCallback onEvent)
    : onEvent_(std::move(onEvent))
{}

EngineHost::~EngineHost() {
    shutdown();
}

void EngineHost::initialise() {
    tracktion::engine::Engine::InstanceStartupOptions opts;
    opts.engineName = "OdeonEngine";

    engine_ = std::make_unique<tracktion::engine::Engine>(opts);

    // Use the default audio device (CoreAudio on macOS)
    engine_->getDeviceManager().initialise(0, 2);

    // Notify frontend
    onEvent_(R"({"event":"engineReady","version":"0.1.0"})");

    // Start meter polling thread (50 ms interval)
    meterRunning_ = true;
    meterThread_ = std::thread(&EngineHost::meterPollLoop, this);
}

void EngineHost::shutdown() {
    meterRunning_ = false;
    if (meterThread_.joinable())
        meterThread_.join();

    disposeProject();
    engine_.reset();
}

// ─────────────────────────────────────────────
//  Project
// ─────────────────────────────────────────────

std::string EngineHost::createProject(const std::string& projectId) {
    disposeProject();
    currentProjectId_ = projectId;

    // Create an in-memory Edit (no file on disk for the engine's session)
    tracktion::engine::Edit::Options editOpts;
    editOpts.engine        = *engine_;
    editOpts.editState     = tracktion::engine::createEmptyEdit(*engine_);
    editOpts.numUndoLevels = 0;
    editOpts.editRole      = tracktion::engine::Edit::forEditing;

    edit_ = tracktion::engine::Edit::createSingleUndoEdit(editOpts);
    transport_ = &edit_->getTransport();

    return jsonOk(jsonQuote(projectId));
}

std::string EngineHost::loadProject(const std::string& projectId) {
    // For v1 we treat load the same as create (no persistent edit file yet)
    return createProject(projectId);
}

std::string EngineHost::disposeProject() {
    {
        std::lock_guard<std::mutex> lk(tracksMutex_);
        tracks_.clear();
    }
    if (transport_) {
        transport_->stop(false, false);
        transport_ = nullptr;
    }
    edit_.reset();
    currentProjectId_.clear();
    return jsonOk();
}

// ─────────────────────────────────────────────
//  Tracks
// ─────────────────────────────────────────────

std::string EngineHost::createTrack(const std::string& trackId,
                                    const std::string& name,
                                    const std::string& role,
                                    const std::string& stemType) {
    if (!edit_)
        return jsonErr("No active project. Call createProject first.");

    auto& list = edit_->getTrackList();
    auto* audioTrack = dynamic_cast<tracktion::engine::AudioTrack*>(
        list.insertNewTrack({}, tracktion::engine::TrackInsertPoint{nullptr, nullptr}));

    if (!audioTrack)
        return jsonErr("Failed to create audio track in Tracktion Edit.");

    audioTrack->setName(name);

    {
        std::lock_guard<std::mutex> lk(tracksMutex_);
        tracks_[trackId] = TrackRecord{trackId, name, role, stemType, audioTrack};
    }
    return jsonOk(jsonQuote(trackId));
}

std::string EngineHost::removeTrack(const std::string& trackId) {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    if (it->second.track && edit_)
        edit_->getTrackList().deleteTrack(it->second.track);

    tracks_.erase(it);
    return jsonOk();
}

std::string EngineHost::loadAudioFile(const std::string& trackId,
                                      const std::string& filePath) {
    // Convenience: same as addClip at t=0
    return addClip(trackId, filePath, 0.0);
}

std::string EngineHost::addClip(const std::string& trackId,
                                const std::string& filePath,
                                double startTimeSeconds) {
    if (!edit_)
        return jsonErr("No active project.");

    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    auto* audioTrack = it->second.track;
    if (!audioTrack)
        return jsonErr("Audio track pointer is null for: " + trackId);

    juce::File file(filePath);
    if (!file.existsAsFile())
        return jsonErr("File not found: " + filePath);

    // Get audio format reader to know the duration
    auto& formatManager = engine_->getAudioFileFormatManager().readFormatManager;
    std::unique_ptr<juce::AudioFormatReader> reader(
        formatManager.createReaderFor(file));

    if (!reader)
        return jsonErr("Cannot read audio file: " + filePath);

    double durationSeconds = reader->lengthInSamples / reader->sampleRate;
    reader.reset();

    auto clipRange = tracktion::engine::EditTimeRange(
        tracktion::engine::EditTime::fromSeconds(startTimeSeconds),
        tracktion::engine::EditTime::fromSeconds(startTimeSeconds + durationSeconds));

    auto* clip = dynamic_cast<tracktion::engine::WaveAudioClip*>(
        audioTrack->insertWaveClip(file.getFileNameWithoutExtension(),
                                   file,
                                   { clipRange, {} },
                                   false));

    if (!clip)
        return jsonErr("Failed to insert wave clip for: " + filePath);

    return jsonOk("{\"trackId\":" + jsonQuote(trackId) +
                  ",\"durationSeconds\":" + std::to_string(durationSeconds) + "}");
}

// ─────────────────────────────────────────────
//  Transport
// ─────────────────────────────────────────────

std::string EngineHost::play() {
    if (!transport_)
        return jsonErr("No active project.");
    transport_->play(false);
    return jsonOk();
}

std::string EngineHost::stop() {
    if (!transport_)
        return jsonErr("No active project.");
    transport_->stop(false, false);
    return jsonOk();
}

std::string EngineHost::seek(double timeSeconds) {
    if (!transport_)
        return jsonErr("No active project.");
    transport_->setCurrentPosition(timeSeconds);
    return jsonOk();
}

std::string EngineHost::getTransportState() {
    if (!transport_)
        return "{\"isPlaying\":false,\"positionSeconds\":0.0,\"bpm\":120.0}";

    bool playing = transport_->isPlaying();
    double pos   = transport_->getCurrentPosition();
    double bpm   = edit_->tempoSequence.getTempoAt(tracktion::engine::EditTime::fromSeconds(0))
                       .getBpm();

    std::ostringstream ss;
    ss << "{\"isPlaying\":" << (playing ? "true" : "false")
       << ",\"positionSeconds\":" << pos
       << ",\"bpm\":" << bpm
       << "}";
    return ss.str();
}

// ─────────────────────────────────────────────
//  Track parameters
// ─────────────────────────────────────────────

std::string EngineHost::setTrackVolume(const std::string& trackId, float volumeDb) {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    if (auto* vca = it->second.track->getVolumeAndPanPlugin()) {
        float linear = std::pow(10.f, volumeDb / 20.f);
        vca->setVolumeDb(volumeDb);
    }
    return jsonOk();
}

std::string EngineHost::setTrackPan(const std::string& trackId, float pan) {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    if (auto* vca = it->second.track->getVolumeAndPanPlugin())
        vca->setPan(pan);

    return jsonOk();
}

std::string EngineHost::muteTrack(const std::string& trackId, bool muted) {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    it->second.track->setMute(muted);
    return jsonOk();
}

std::string EngineHost::soloTrack(const std::string& trackId, bool soloed) {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    auto it = tracks_.find(trackId);
    if (it == tracks_.end())
        return jsonErr("Track not found: " + trackId);

    it->second.track->setSolo(soloed);
    return jsonOk();
}

// ─────────────────────────────────────────────
//  Meters
// ─────────────────────────────────────────────

std::string EngineHost::getTrackMeters() {
    std::lock_guard<std::mutex> lk(tracksMutex_);
    std::ostringstream ss;
    ss << "{";
    bool first = true;
    for (auto& [id, rec] : tracks_) {
        if (!first) ss << ",";
        first = false;

        float leftDb  = -120.f;
        float rightDb = -120.f;

        if (rec.track) {
            auto level = rec.track->getLevelMeterPlugin();
            if (level) {
                leftDb  = linearToDb(level->measurer.getAndClearAudioLevel(0).peak);
                rightDb = linearToDb(level->measurer.getAndClearAudioLevel(1).peak);
            }
        }

        ss << jsonQuote(id) << ":{\"leftDb\":" << leftDb << ",\"rightDb\":" << rightDb << "}";
    }
    ss << "}";
    return ss.str();
}

void EngineHost::meterPollLoop() {
    while (meterRunning_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(50));
        if (!edit_) continue;

        // Transport state event
        {
            std::string ts;
            if (transport_) {
                bool playing = transport_->isPlaying();
                double pos   = transport_->getCurrentPosition();
                double bpm   = edit_->tempoSequence.getTempoAt(
                    tracktion::engine::EditTime::fromSeconds(0)).getBpm();

                std::ostringstream ss;
                ss << "{\"event\":\"transportState\","
                   << "\"isPlaying\":" << (playing ? "true" : "false")
                   << ",\"positionSeconds\":" << pos
                   << ",\"bpm\":" << bpm
                   << "}";
                ts = ss.str();
            }
            if (!ts.empty())
                onEvent_(ts);
        }

        // Meters event
        {
            std::string meters = getTrackMeters();
            onEvent_("{\"event\":\"trackMeters\",\"meters\":" + meters + "}");
        }
    }
}

float EngineHost::linearToDb(float linear) const noexcept {
    if (linear <= 0.f) return -120.f;
    return 20.f * std::log10(linear);
}

// ─────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────

std::string EngineHost::renderMix(const std::string& outputFilePath) {
    if (!edit_)
        return jsonErr("No active project.");

    // Stop transport before rendering
    if (transport_)
        transport_->stop(false, false);

    juce::File outFile(outputFilePath);
    outFile.getParentDirectory().createDirectory();

    // Find the total edit length
    double editEnd = 0.0;
    {
        std::lock_guard<std::mutex> lk(tracksMutex_);
        for (auto& [id, rec] : tracks_) {
            if (rec.track) {
                for (auto* clip : rec.track->getClips()) {
                    double end = clip->getPosition().getEnd().inSeconds();
                    editEnd = std::max(editEnd, end);
                }
            }
        }
    }

    if (editEnd <= 0.0)
        return jsonErr("Edit is empty; nothing to render.");

    tracktion::engine::Renderer::Parameters params(*edit_);
    params.destFile          = outFile;
    params.audioFormat       = engine_->getAudioFileFormatManager()
                                      .readFormatManager.findFormatForFileExtension("wav");
    params.sampleRateForAudio  = 44100;
    params.bitDepthForAudio    = 24;
    params.shouldNormalise     = false;
    params.trimSilenceAtEnds   = false;
    params.time                = { tracktion::engine::EditTime::fromSeconds(0.0),
                                   tracktion::engine::EditTime::fromSeconds(editEnd) };

    auto result = tracktion::engine::Renderer::renderToFile(params);

    if (!result.fileCreatedOk)
        return jsonErr("Render failed. Check output path: " + outputFilePath);

    return jsonOk("{\"outputFilePath\":" + jsonQuote(outputFilePath) +
                  ",\"durationSeconds\":" + std::to_string(editEnd) + "}");
}

} // namespace odeon
