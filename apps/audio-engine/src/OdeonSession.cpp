#include "OdeonSession.h"

#include <cmath>
#include <chrono>
#include <sstream>

namespace odeon {

namespace {
    using namespace std::chrono_literals;
    constexpr int   kMeterIntervalMs = 50;
    constexpr float kRmsSmoothing    = 0.8f;   // exponential ballistics for the RMS-style bar
}

OdeonSession::OdeonSession(EventCallback onEvent)
    : onEvent_(std::move(onEvent)) {}

OdeonSession::~OdeonSession() {
    shutdown();
}

// ─────────────────────────────────────────────────────────────────────────
//  Lifecycle
// ─────────────────────────────────────────────────────────────────────────

void OdeonSession::initialise() {
    engine_ = std::make_unique<te::Engine>(juce::String("OdeonEngine"));

    // Boot Tracktion's DeviceManager (wires the engine's audio callback to the
    // default CoreAudio output). Render works without a device; playback needs it.
    engine_->getDeviceManager().initialise(0, 2);
    deviceReady_ = engine_->getDeviceManager().getNumWaveOutDevices() > 0;
    if (!deviceReady_)
        logEngineError("initialise", "No audio output device available.");

    onEvent_(R"({"event":"engineReady","version":"0.1.0"})");

    meterRunning_ = true;
    meterThread_  = std::thread(&OdeonSession::meterPollLoop, this);
}

void OdeonSession::shutdown() {
    meterRunning_ = false;
    if (meterThread_.joinable())
        meterThread_.join();

    disposeSession();
    engine_.reset();
}

// ─────────────────────────────────────────────────────────────────────────
//  Session
// ─────────────────────────────────────────────────────────────────────────

juce::File OdeonSession::projectFolder() const {
    return projectDir_;
}

void OdeonSession::ensureProjectFolders(const juce::File& root) {
    root.createDirectory();
    root.getChildFile("audio").getChildFile("imports").createDirectory();
    root.getChildFile("audio").getChildFile("stems").createDirectory();
    root.getChildFile("audio").getChildFile("renders").createDirectory();
    root.getChildFile("analysis").createDirectory();
    root.getChildFile("backups").createDirectory();
    root.getChildFile("logs").createDirectory();
}

std::string OdeonSession::createSession(const std::string& projectId,
                                        const std::string& projectDir) {
    disposeSession();
    currentProjectId_ = projectId;

    juce::File root = projectDir.empty()
        ? engine_->getTemporaryFileManager().getTempDirectory().getChildFile("OdeonProjects").getChildFile(projectId)
        : juce::File(projectDir);

    ensureProjectFolders(root);
    projectDir_ = root;

    auto editFile = root.getChildFile("session.tracktionedit");
    edit_ = te::createEmptyEdit(*engine_, editFile);
    if (!edit_) {
        logEngineError("createSession", "createEmptyEdit returned null");
        return jsonErr("Failed to create session edit.");
    }

    transport_ = &edit_->getTransport();
    transport_->ensureContextAllocated();

    return jsonOk("{\"projectId\":" + jsonQuote(projectId) +
                  ",\"projectDir\":" + jsonQuote(root.getFullPathName().toStdString()) + "}");
}

std::string OdeonSession::disposeSession() {
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        for (auto& [id, route] : routes_) {
            if (route->track && route->meterClientRegistered)
                if (auto* lm = route->track->getLevelMeterPlugin())
                    lm->measurer.removeClient(route->meterClient);
        }
        routes_.clear();
    }
    if (transport_) {
        transport_->stop(false, false);
        transport_ = nullptr;
    }
    edit_.reset();
    currentProjectId_.clear();
    projectDir_ = juce::File();
    return jsonOk();
}

// ─────────────────────────────────────────────────────────────────────────
//  Routes / tracks
// ─────────────────────────────────────────────────────────────────────────

OdeonRoute* OdeonSession::findRoute(const std::string& trackId) {
    auto it = routes_.find(trackId);
    return it == routes_.end() ? nullptr : it->second.get();
}

std::string OdeonSession::createTrack(const std::string& trackId, const std::string& name,
                                      const std::string& role, const std::string& stemType) {
    if (!edit_)
        return jsonErr("No active session. Call createSession first.");

    const int idx = te::getAudioTracks(*edit_).size();
    edit_->ensureNumberOfAudioTracks(idx + 1);

    auto audioTracks = te::getAudioTracks(*edit_);
    if (idx >= audioTracks.size())
        return jsonErr("Failed to create audio track.");

    auto* track = audioTracks[idx];
    track->setName(name);

    auto route        = std::make_unique<OdeonRoute>();
    route->id         = trackId;
    route->name       = name;
    route->role       = roleFromString(role);
    route->stemType   = stemFromString(stemType);
    route->track      = track;

    // Register a level-measurer client for lock-free metering (audio thread
    // fills it, poll thread reads it).
    if (auto* lm = track->getLevelMeterPlugin()) {
        lm->measurer.addClient(route->meterClient);
        route->meterClientRegistered = true;
    }

    // The analysis role is the native AI tap seam.
    route->analysisEnabled = (route->role == RouteRole::analysis);

    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        routes_[trackId] = std::move(route);
    }
    return jsonOk(jsonQuote(trackId));
}

std::string OdeonSession::removeTrack(const std::string& trackId) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route)
        return jsonErr("Track not found: " + trackId);

    if (route->track) {
        if (route->meterClientRegistered)
            if (auto* lm = route->track->getLevelMeterPlugin())
                lm->measurer.removeClient(route->meterClient);
        edit_->deleteTrack(route->track);
    }
    routes_.erase(trackId);
    return jsonOk();
}

std::string OdeonSession::addClip(const std::string& trackId, const std::string& clipId,
                                  const std::string& filePath, double startTimeSeconds) {
    if (!edit_)
        return jsonErr("No active session.");

    OdeonRoute* route = nullptr;
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        route = findRoute(trackId);
    }
    if (!route || !route->track)
        return jsonErr("Track not found: " + trackId);

    juce::File file(filePath);
    if (!file.existsAsFile())
        return jsonErr("File not found: " + filePath);   // handled gracefully

    te::AudioFile audioFile(*engine_, file);
    if (!audioFile.isValid())
        return jsonErr("Cannot read audio file: " + filePath);

    const double duration = audioFile.getLength();

    te::ClipPosition pos;
    pos.time = tracktion::TimeRange(tracktion::TimePosition::fromSeconds(startTimeSeconds),
                                    tracktion::TimeDuration::fromSeconds(duration));

    auto clip = route->track->insertWaveClip(file.getFileNameWithoutExtension(),
                                             file, pos, false);
    if (clip == nullptr)
        return jsonErr("Failed to insert wave clip for: " + filePath);

    AudioClip ac;
    ac.clipId       = clipId.empty() ? file.getFileNameWithoutExtension().toStdString() : clipId;
    ac.sourceId     = file.getFullPathName().hashCode64() != 0
                          ? std::to_string(file.getFullPathName().hashCode64()) : ac.clipId;
    ac.trackId      = trackId;
    ac.startTime    = startTimeSeconds;
    ac.sourceOffset = 0.0;
    ac.duration     = duration;
    route->clips.push_back(ac);

    return jsonOk("{\"trackId\":" + jsonQuote(trackId) +
                  ",\"clipId\":" + jsonQuote(ac.clipId) +
                  ",\"durationSeconds\":" + std::to_string(duration) + "}");
}

// ─────────────────────────────────────────────────────────────────────────
//  Transport
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::play() {
    if (!transport_) return jsonErr("No active session.");
    edit_->dispatchPendingUpdatesSynchronously();
    transport_->ensureContextAllocated();
    transport_->play(false);
    return jsonOk();
}

std::string OdeonSession::stop() {
    if (!transport_) return jsonErr("No active session.");
    transport_->stop(false, false);
    return jsonOk();
}

std::string OdeonSession::seek(double timeSeconds) {
    if (!transport_) return jsonErr("No active session.");
    transport_->setPosition(tracktion::TimePosition::fromSeconds(timeSeconds));
    return jsonOk();
}

std::string OdeonSession::setLoop(bool enabled, double startSeconds, double endSeconds) {
    if (!transport_) return jsonErr("No active session.");
    if (enabled && endSeconds > startSeconds)
        transport_->setLoopRange(tracktion::TimeRange(tracktion::TimePosition::fromSeconds(startSeconds),
                                                      tracktion::TimePosition::fromSeconds(endSeconds)));
    transport_->looping = enabled;
    return jsonOk();
}

std::string OdeonSession::getTransportState() {
    if (!transport_)
        return "{\"isPlaying\":false,\"positionSeconds\":0.0,\"bpm\":120.0,\"looping\":false}";

    std::ostringstream ss;
    ss << "{\"isPlaying\":" << (transport_->isPlaying() ? "true" : "false")
       << ",\"positionSeconds\":" << positionSeconds()
       << ",\"bpm\":120.0"
       << ",\"looping\":" << (transport_->looping ? "true" : "false")
       << "}";
    return ss.str();
}

// ─────────────────────────────────────────────────────────────────────────
//  Mixer
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::setTrackVolume(const std::string& trackId, float volumeDb) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route) return jsonErr("Track not found: " + trackId);
    if (auto* vp = route->track->getVolumePlugin())
        vp->setVolumeDb(volumeDb);
    route->mix.volumeDb = volumeDb;
    return jsonOk();
}

std::string OdeonSession::setTrackPan(const std::string& trackId, float pan) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route) return jsonErr("Track not found: " + trackId);
    if (auto* vp = route->track->getVolumePlugin())
        vp->setPan(pan);
    route->mix.pan = pan;
    return jsonOk();
}

std::string OdeonSession::muteTrack(const std::string& trackId, bool muted) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route) return jsonErr("Track not found: " + trackId);
    route->track->setMute(muted);
    route->mix.muted = muted;
    return jsonOk();
}

std::string OdeonSession::soloTrack(const std::string& trackId, bool soloed) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route) return jsonErr("Track not found: " + trackId);
    route->track->setSolo(soloed);
    route->mix.soloed = soloed;
    return jsonOk();
}

std::string OdeonSession::getTrackMeters() {
    std::lock_guard<std::mutex> lk(routesMutex_);
    std::ostringstream ss;
    ss << "{";
    bool first = true;
    for (auto& [id, route] : routes_) {
        if (!first) ss << ",";
        first = false;

        float peakL = -120.f, peakR = -120.f;
        if (route->meterClientRegistered) {
            peakL = route->meterClient.getAndClearAudioLevel(0).dB;
            peakR = route->meterClient.getAndClearAudioLevel(1).dB;
        }

        // RMS-style smoothed ballistics in linear domain.
        const float linL = dbToLinear(peakL);
        const float linR = dbToLinear(peakR);
        route->rmsLinL = route->rmsLinL * kRmsSmoothing + linL * (1.f - kRmsSmoothing);
        route->rmsLinR = route->rmsLinR * kRmsSmoothing + linR * (1.f - kRmsSmoothing);

        ss << jsonQuote(id) << ":{"
           << "\"leftDb\":"   << peakL << ",\"rightDb\":"   << peakR << ","
           << "\"peakLeftDb\":" << peakL << ",\"peakRightDb\":" << peakR << ","
           << "\"rmsLeftDb\":"  << linearToDb(route->rmsLinL)
           << ",\"rmsRightDb\":" << linearToDb(route->rmsLinR)
           << "}";
    }
    ss << "}";
    return ss.str();
}

// ─────────────────────────────────────────────────────────────────────────
//  Render
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::renderMix(const std::string& outputFilePath) {
    if (!edit_) return jsonErr("No active session.");

    if (transport_)
        transport_->stop(false, false);

    juce::File outFile;
    if (outputFilePath.empty()) {
        outFile = projectFolder().getChildFile("audio").getChildFile("renders")
                                  .getChildFile(currentProjectId_ + "_mix.wav");
    } else {
        outFile = juce::File::isAbsolutePath(juce::String(outputFilePath))
                    ? juce::File(outputFilePath)
                    : projectFolder().getChildFile("audio").getChildFile("renders").getChildFile(outputFilePath);
    }
    outFile.getParentDirectory().createDirectory();

    const bool ok = te::Renderer::renderToFile(*edit_, outFile, false /*useThread*/);
    if (!ok || !outFile.existsAsFile())
        return jsonErr("Render failed for: " + outFile.getFullPathName().toStdString());

    return jsonOk("{\"outputFilePath\":" + jsonQuote(outFile.getFullPathName().toStdString()) + "}");
}

// ─────────────────────────────────────────────────────────────────────────
//  AI native seam
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::analyze(const std::string& trackId) {
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findRoute(trackId);
    if (!route) return jsonErr("Track not found: " + trackId);

    route->analysisEnabled = true;

    // The engine owns the seam: it flags the route and emits an async request.
    // Heavy ML (Demucs / librosa / Diff-MST) runs in the Python service, never
    // on the audio thread. v2 lights up the lock-free copy-out to that service.
    std::string srcPath = route->clips.empty() ? "" : route->clips.front().sourceId;
    onEvent_("{\"event\":\"analysisRequested\",\"trackId\":" + jsonQuote(trackId) +
             ",\"role\":" + jsonQuote(toString(route->role)) + "}");

    return jsonOk("{\"trackId\":" + jsonQuote(trackId) + ",\"queued\":true}");
}

// ─────────────────────────────────────────────────────────────────────────
//  Persistence — full Odeon Project folder, atomic write (Ardour pattern)
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::serializeProjectJson() const {
    std::ostringstream ss;
    ss << "{\"schemaVersion\":" << kSchemaVersion
       << ",\"projectId\":" << jsonQuote(currentProjectId_)
       << ",\"sampleRate\":44100"
       << ",\"routes\":[";

    bool firstRoute = true;
    for (auto& [id, route] : routes_) {
        if (!firstRoute) ss << ",";
        firstRoute = false;
        ss << "{\"id\":" << jsonQuote(route->id)
           << ",\"name\":" << jsonQuote(route->name)
           << ",\"role\":" << jsonQuote(toString(route->role))
           << ",\"stemType\":" << jsonQuote(toString(route->stemType))
           << ",\"volumeDb\":" << route->mix.volumeDb
           << ",\"pan\":" << route->mix.pan
           << ",\"muted\":" << (route->mix.muted ? "true" : "false")
           << ",\"soloed\":" << (route->mix.soloed ? "true" : "false")
           << ",\"clips\":[";
        bool firstClip = true;
        for (auto& c : route->clips) {
            if (!firstClip) ss << ",";
            firstClip = false;
            // Resolve the clip's source file path from the live Tracktion clip.
            std::string filePath;
            if (route->track) {
                for (auto* clip : route->track->getClips()) {
                    if (auto* wac = dynamic_cast<te::WaveAudioClip*>(clip)) {
                        filePath = wac->getOriginalFile().getFullPathName().toStdString();
                        break;
                    }
                }
            }
            ss << "{\"clipId\":" << jsonQuote(c.clipId)
               << ",\"sourceId\":" << jsonQuote(c.sourceId)
               << ",\"filePath\":" << jsonQuote(filePath)
               << ",\"startTime\":" << c.startTime
               << ",\"sourceOffset\":" << c.sourceOffset
               << ",\"duration\":" << c.duration
               << ",\"gainDb\":" << c.gainDb
               << "}";
        }
        ss << "]}";
    }
    ss << "]}";
    return ss.str();
}

bool OdeonSession::writeAtomic(const juce::File& dest, const juce::String& contents, juce::String& error) {
    // Back up the existing file first (Ardour create_backup_file pattern).
    if (dest.existsAsFile()) {
        auto backup = projectFolder().getChildFile("backups")
                          .getChildFile(dest.getFileNameWithoutExtension()
                                        + "_" + juce::String(juce::Time::getCurrentTime().toMilliseconds())
                                        + ".bak");
        dest.copyFileTo(backup);
    }

    // Write to a temp file, then atomically replace the target (temp-write +
    // rename, mirroring Ardour session_state.cc:879-905).
    juce::TemporaryFile temp(dest);
    if (!temp.getFile().replaceWithText(contents)) {
        error = "Could not write temp file for " + dest.getFullPathName();
        return false;
    }
    if (!temp.overwriteTargetFileWithTemporary()) {
        error = "Could not atomically replace " + dest.getFullPathName();
        return false;
    }
    return true;
}

std::string OdeonSession::saveSession() {
    if (!edit_) return jsonErr("No active session.");

    ensureProjectFolders(projectDir_);
    auto dest = projectDir_.getChildFile("project.odeon");

    juce::String error;
    std::string json;
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        json = serializeProjectJson();
    }

    if (!writeAtomic(dest, juce::String(json), error)) {
        logEngineError("saveSession", error.toStdString());
        return jsonErr(error.toStdString());
    }

    return jsonOk("{\"path\":" + jsonQuote(dest.getFullPathName().toStdString()) + "}");
}

std::string OdeonSession::openSession(const std::string& projectId, const std::string& projectDir) {
    juce::File root = projectDir.empty()
        ? engine_->getTemporaryFileManager().getTempDirectory().getChildFile("OdeonProjects").getChildFile(projectId)
        : juce::File(projectDir);

    auto projFile = root.getChildFile("project.odeon");
    if (!projFile.existsAsFile())
        return jsonErr("No project.odeon at: " + root.getFullPathName().toStdString());

    auto parsed = juce::JSON::parse(projFile.loadFileAsString());
    if (!parsed.isObject())
        return jsonErr("Corrupt project.odeon (not a JSON object).");

    // Start a fresh session in the same folder, then rebuild from JSON.
    createSession(projectId, root.getFullPathName().toStdString());

    auto routesVar = parsed.getProperty("routes", juce::var());
    int missingSources = 0;
    if (auto* arr = routesVar.getArray()) {
        for (auto& rv : *arr) {
            const std::string id   = rv.getProperty("id", "").toString().toStdString();
            const std::string name = rv.getProperty("name", "").toString().toStdString();
            const std::string role = rv.getProperty("role", "user").toString().toStdString();
            const std::string stem = rv.getProperty("stemType", "other").toString().toStdString();
            createTrack(id, name, role, stem);

            auto clipsVar = rv.getProperty("clips", juce::var());
            if (auto* clips = clipsVar.getArray()) {
                for (auto& cv : *clips) {
                    std::string filePath = cv.getProperty("filePath", "").toString().toStdString();
                    std::string clipId   = cv.getProperty("clipId", "").toString().toStdString();
                    double start         = (double) cv.getProperty("startTime", 0.0);

                    // Missing-source relink: try the path, then audio/imports.
                    juce::File f(filePath);
                    if (!f.existsAsFile()) {
                        auto alt = root.getChildFile("audio").getChildFile("imports")
                                       .getChildFile(juce::File(filePath).getFileName());
                        if (alt.existsAsFile()) f = alt;
                    }
                    if (f.existsAsFile())
                        addClip(id, clipId, f.getFullPathName().toStdString(), start);
                    else
                        ++missingSources;
                }
            }

            // Reapply mix state.
            setTrackVolume(id, (float) (double) rv.getProperty("volumeDb", 0.0));
            setTrackPan(id, (float) (double) rv.getProperty("pan", 0.0));
            muteTrack(id, (bool) rv.getProperty("muted", false));
            soloTrack(id, (bool) rv.getProperty("soloed", false));
        }
    }

    std::ostringstream ss;
    ss << "{\"projectId\":" << jsonQuote(projectId)
       << ",\"routeCount\":" << routes_.size()
       << ",\"missingSources\":" << missingSources << "}";
    return jsonOk(ss.str());
}

// ─────────────────────────────────────────────────────────────────────────
//  Meters poll thread + helpers
// ─────────────────────────────────────────────────────────────────────────

void OdeonSession::meterPollLoop() {
    while (meterRunning_) {
        std::this_thread::sleep_for(std::chrono::milliseconds(kMeterIntervalMs));
        if (!edit_ || !transport_) continue;

        {
            std::ostringstream ss;
            ss << "{\"event\":\"transportState\",\"isPlaying\":"
               << (transport_->isPlaying() ? "true" : "false")
               << ",\"positionSeconds\":" << positionSeconds()
               << ",\"bpm\":120.0,\"looping\":" << (transport_->looping ? "true" : "false")
               << "}";
            onEvent_(ss.str());
        }

        onEvent_("{\"event\":\"trackMeters\",\"meters\":" + getTrackMeters() + "}");
    }
}

void OdeonSession::logEngineError(const std::string& where, const std::string& message) {
    onEvent_("{\"event\":\"engineError\",\"where\":" + jsonQuote(where) +
             ",\"message\":" + jsonQuote(message) + "}");
    if (projectDir_ != juce::File()) {
        auto log = projectDir_.getChildFile("logs").getChildFile("engine.log");
        log.appendText(juce::Time::getCurrentTime().toString(true, true) +
                       "  [" + where + "] " + message + "\n");
    }
}

float OdeonSession::linearToDb(float linear) const noexcept {
    if (linear <= 0.00000095f) return -120.f;     // ~ -120 dB floor
    return 20.f * std::log10(linear);
}

float OdeonSession::dbToLinear(float db) const noexcept {
    if (db <= -120.f) return 0.f;
    return std::pow(10.f, db / 20.f);
}

} // namespace odeon
