#include "OdeonSession.h"

#include <cmath>
#include <chrono>
#include <sstream>
#include <algorithm>

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
    syncBehaviourConfig();
    auto behaviour = std::make_unique<OdeonEngineBehaviour>(&behaviourConfig_);
    engine_ = std::make_unique<te::Engine>(juce::String("OdeonEngine"), nullptr, std::move(behaviour));

    // Boot Tracktion's DeviceManager (wires the engine's audio callback to the
    // default CoreAudio output). Render works without a device; playback needs it.
    engine_->getDeviceManager().initialise(0, 2);
    applyDiskCacheSize();

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
    djMode_ = false;
    numDjDecks_ = 0;
    for (auto& d : djDecks_)
        d = OdeonDjDeck{};
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

std::string OdeonSession::pause() {
    if (!transport_) return jsonErr("No active session.");
    // Preserve playhead position (Ableton-style pause: stop clock, keep cursor)
    transport_->stop(false, false);
    return jsonOk();
}

std::string OdeonSession::stop() {
    if (!transport_) return jsonErr("No active session.");
    transport_->stop(false, false);
    transport_->setPosition(tracktion::TimePosition::fromSeconds(0.0));
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

std::string OdeonSession::setMasterVolume(float volumeDb) {
    if (!edit_) return jsonErr("No active session.");
    if (auto vp = edit_->getMasterVolumePlugin())
        vp->setVolumeDb(volumeDb);
    return jsonOk("{\"masterVolumeDb\":" + std::to_string(volumeDb) + "}");
}

std::string OdeonSession::moveClip(const std::string& trackId, const std::string& clipId,
                                   double newStartTimeSeconds) {
    if (!edit_) return jsonErr("No active session.");

    OdeonRoute* route = nullptr;
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        route = findRoute(trackId);
    }
    if (!route || !route->track) return jsonErr("Track not found: " + trackId);

    // Find matching clip in stored metadata
    AudioClip* storedClip = nullptr;
    for (auto& ac : route->clips) {
        if (ac.clipId == clipId) { storedClip = &ac; break; }
    }
    if (!storedClip) return jsonErr("Clip not found: " + clipId);

    // Find the live Tracktion clip and reposition it
    for (auto* clip : route->track->getClips()) {
        if (auto* wac = dynamic_cast<te::WaveAudioClip*>(clip)) {
            // Match by start time proximity (clipId isn't stored in Tracktion clip)
            if (std::abs(wac->getPosition().getStart().inSeconds() - storedClip->startTime) < 0.001) {
                const double dur = wac->getPosition().getLength().inSeconds();
                te::ClipPosition pos;
                pos.time = tracktion::TimeRange(
                    tracktion::TimePosition::fromSeconds(newStartTimeSeconds),
                    tracktion::TimeDuration::fromSeconds(dur));
                wac->setPosition(pos);
                storedClip->startTime = newStartTimeSeconds;
                return jsonOk("{\"trackId\":" + jsonQuote(trackId) +
                              ",\"clipId\":" + jsonQuote(clipId) +
                              ",\"startTime\":" + std::to_string(newStartTimeSeconds) + "}");
            }
        }
    }
    return jsonErr("Clip " + clipId + " not found in Tracktion edit for track " + trackId);
}

// ─────────────────────────────────────────────────────────────────────────
//  DJ deck players
// ─────────────────────────────────────────────────────────────────────────

te::WaveAudioClip* OdeonSession::findDeckWaveClip(OdeonRoute* route) {
    if (!route || !route->track) return nullptr;
    for (auto* clip : route->track->getClips()) {
        if (auto* wac = dynamic_cast<te::WaveAudioClip*>(clip))
            return wac;
    }
    return nullptr;
}

void OdeonSession::clearDeckClips(OdeonDjDeck& deck) {
    OdeonRoute* route = nullptr;
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        route = findRoute(deck.trackId);
    }
    if (route && route->track) {
        const auto clips = route->track->getClips();
        for (int i = clips.size() - 1; i >= 0; --i)
            clips[(size_t) i]->removeFromParent();
        route->clips.clear();
    }
    deck.waveClip = nullptr;
    deck.loaded = false;
    deck.filePath.clear();
    deck.clipId.clear();
    deck.timelineStart = 0.0;
    deck.duration = 0.0;
    deck.rate = 1.0;
}

std::string OdeonSession::createDjSession(int numDecks) {
    const int n = std::clamp(numDecks, 1, 4);

    const std::string sessionResult = createSession("odeon-dj-booth", "");
    if (sessionResult.find("\"ok\":false") != std::string::npos)
        return sessionResult;

    djMode_ = true;
    numDjDecks_ = n;
    for (auto& d : djDecks_)
        d = OdeonDjDeck{};

    for (int i = 0; i < n; ++i) {
        const std::string trackId = "deck:" + std::to_string(i);
        const std::string name    = "Deck " + std::to_string(i + 1);
        const std::string created = createTrack(trackId, name, "deck", "full_mix");
        if (created.find("\"ok\":false") != std::string::npos)
            return created;

        djDecks_[(size_t) i].deckIndex = i;
        djDecks_[(size_t) i].trackId   = trackId;
    }

    return jsonOk("{\"numDecks\":" + std::to_string(n) + "}");
}

std::string OdeonSession::loadDeck(int deckIndex, const std::string& filePath,
                                   const std::string& name, double timelineStartSeconds) {
    if (!djMode_)
        return jsonErr("Not in DJ session mode. Call createDjSession first.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_)
        return jsonErr("Invalid deck index: " + std::to_string(deckIndex));

    auto& deck = djDecks_[(size_t) deckIndex];
    clearDeckClips(deck);

    OdeonRoute* route = nullptr;
    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        route = findRoute(deck.trackId);
    }
    if (!route || !route->track)
        return jsonErr("Deck route not found: " + deck.trackId);

    if (!name.empty())
        route->track->setName(name);

    const std::string added = addClip(deck.trackId, "", filePath, timelineStartSeconds);
    if (added.find("\"ok\":false") != std::string::npos)
        return added;

    deck.filePath      = filePath;
    deck.timelineStart = timelineStartSeconds;
    deck.clipId        = juce::File(filePath).getFileNameWithoutExtension().toStdString();
    deck.rate          = 1.0;
    deck.loaded        = true;
    deck.waveClip      = findDeckWaveClip(route);
    if (deck.waveClip)
        deck.duration = deck.waveClip->getPosition().getLength().inSeconds();

    return jsonOk("{\"deckIndex\":" + std::to_string(deckIndex) +
                  ",\"trackId\":" + jsonQuote(deck.trackId) +
                  ",\"durationSeconds\":" + std::to_string(deck.duration) + "}");
}

std::string OdeonSession::unloadDeck(int deckIndex) {
    if (!djMode_)
        return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_)
        return jsonErr("Invalid deck index.");

    clearDeckClips(djDecks_[(size_t) deckIndex]);
    return jsonOk();
}

std::string OdeonSession::deckSeek(int deckIndex, double timelineStartSeconds) {
    if (!djMode_)
        return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_)
        return jsonErr("Invalid deck index.");

    auto& deck = djDecks_[(size_t) deckIndex];
    if (!deck.loaded || !deck.waveClip)
        return jsonErr("Deck not loaded.");

    const double dur = deck.waveClip->getPosition().getLength().inSeconds();
    te::ClipPosition pos;
    pos.time = tracktion::TimeRange(
        tracktion::TimePosition::fromSeconds(timelineStartSeconds),
        tracktion::TimeDuration::fromSeconds(dur));
    deck.waveClip->setPosition(pos);
    deck.timelineStart = timelineStartSeconds;

    {
        std::lock_guard<std::mutex> lk(routesMutex_);
        if (auto* route = findRoute(deck.trackId)) {
            for (auto& ac : route->clips) {
                if (ac.clipId == deck.clipId) {
                    ac.startTime = timelineStartSeconds;
                    break;
                }
            }
        }
    }

    return jsonOk("{\"deckIndex\":" + std::to_string(deckIndex) +
                  ",\"timelineStart\":" + std::to_string(timelineStartSeconds) + "}");
}

std::string OdeonSession::deckSetRate(int deckIndex, double rate) {
    if (!djMode_)
        return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_)
        return jsonErr("Invalid deck index.");

    auto& deck = djDecks_[(size_t) deckIndex];
    if (!deck.loaded || !deck.waveClip)
        return jsonErr("Deck not loaded.");

    const double clamped = std::clamp(rate, 0.5, 2.0);
    deck.waveClip->setSpeedRatio(clamped);
    deck.rate = clamped;

    return jsonOk("{\"deckIndex\":" + std::to_string(deckIndex) +
                  ",\"rate\":" + std::to_string(clamped) + "}");
}

std::string OdeonSession::getDjState() {
    std::ostringstream ss;
    ss << "{\"numDecks\":" << numDjDecks_ << ",\"decks\":[";
    for (int i = 0; i < numDjDecks_; ++i) {
        if (i > 0) ss << ",";
        const auto& d = djDecks_[(size_t) i];
        double localPos = 0.0;
        if (d.loaded && transport_) {
            localPos = std::max(0.0, positionSeconds() - d.timelineStart);
            if (localPos > d.duration) localPos = d.duration;
        }
        ss << "{"
           << "\"deckIndex\":" << i
           << ",\"trackId\":" << jsonQuote(d.trackId)
           << ",\"loaded\":" << (d.loaded ? "true" : "false")
           << ",\"filePath\":" << jsonQuote(d.filePath)
           << ",\"timelineStart\":" << d.timelineStart
           << ",\"durationSeconds\":" << d.duration
           << ",\"localPositionSeconds\":" << localPos
           << ",\"rate\":" << d.rate
           << ",\"bpm\":" << d.bpm
           << ",\"syncFollower\":" << (d.syncFollower ? "true" : "false")
           << ",\"loopActive\":" << (d.loop.active ? "true" : "false")
           << ",\"loopIn\":" << d.loop.inSeconds
           << ",\"loopOut\":" << d.loop.outSeconds
           << ",\"hotcues\":[";
        for (int h = 0; h < d.hotcueCount; ++h) {
            if (h > 0) ss << ",";
            ss << "{\"slot\":" << d.hotcues[(size_t) h].slot
               << ",\"timeSeconds\":" << d.hotcues[(size_t) h].timeSeconds << "}";
        }
        ss << "]}";
    }
    ss << "]}";
    return ss.str();
}

// ─────────────────────────────────────────────────────────────────────────
//  DJ mixer DSP (Phase C)
// ─────────────────────────────────────────────────────────────────────────

OdeonRoute* OdeonSession::findDeckRoute(int deckIndex) {
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return nullptr;
    return findRoute(djDecks_[(size_t) deckIndex].trackId);
}

void OdeonSession::ensureDeckEqualiser(OdeonRoute& route) {
    if (!route.track || !edit_) return;
    if (route.track->getEqualiserPlugin()) return;

    if (auto plugin = edit_->getPluginCache().createNewPlugin(
            te::EqualiserPlugin::xmlTypeName, {})) {
        route.track->pluginList.insertPlugin(plugin, 0, nullptr);
    }
}

float OdeonSession::crossfaderWeightDb(CfOrientation orient) const {
    const float t = std::clamp(crossfaderPos_, 0.f, 1.f);
    float weight = 1.f;
    switch (orient) {
        case CfOrientation::A:
            weight = std::cos(t * static_cast<float>(juce::MathConstants<double>::halfPi));
            break;
        case CfOrientation::B:
            weight = std::sin(t * static_cast<float>(juce::MathConstants<double>::halfPi));
            break;
        case CfOrientation::THRU:
        default:
            weight = 1.f;
            break;
    }
    if (weight <= 0.00001f) return -120.f;
    return 20.f * std::log10(weight);
}

void OdeonSession::applyDjRouteMix(OdeonRoute& route) {
    if (!route.track) return;

    ensureDeckEqualiser(route);

    const auto& m = route.mix;
    const float cfDb   = crossfaderWeightDb(m.cfOrient);
    const float volDb  = std::clamp(m.trimDb + m.faderDb + cfDb, -120.f, 12.f);

    if (auto* vp = route.track->getVolumePlugin())
        vp->setVolumeDb(volDb);
    route.mix.volumeDb = volDb;

    route.track->setMute(m.muted);
    route.track->setSolo(m.pfl || m.soloed);

    if (auto* eq = route.track->getEqualiserPlugin()) {
        float lowG  = m.lowDb;
        float midG  = m.midDb;
        float highG = m.highDb;

        if (m.filter > 0.f) {
            lowG  = std::min(lowG, -m.filter);
            highG = std::max(highG, -m.filter * 0.25f);
        } else if (m.filter < 0.f) {
            highG = std::min(highG, m.filter);
            lowG  = std::max(lowG, m.filter * 0.25f);
        }

        eq->setLowGain(lowG);
        eq->setMidGain1(midG);
        eq->setMidGain2(0.f);
        eq->setHighGain(highG);
    }
}

std::string OdeonSession::setDeckEq(int deckIndex, float lowDb, float midDb, float highDb) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findDeckRoute(deckIndex);
    if (!route) return jsonErr("Deck route not found.");

    route->mix.lowDb  = std::clamp(lowDb, -20.f, 20.f);
    route->mix.midDb  = std::clamp(midDb, -20.f, 20.f);
    route->mix.highDb = std::clamp(highDb, -20.f, 20.f);
    applyDjRouteMix(*route);
    return jsonOk();
}

std::string OdeonSession::setDeckFilter(int deckIndex, float filter) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findDeckRoute(deckIndex);
    if (!route) return jsonErr("Deck route not found.");

    route->mix.filter = std::clamp(filter, -12.f, 12.f);
    applyDjRouteMix(*route);
    return jsonOk();
}

std::string OdeonSession::setDeckChannelMix(int deckIndex, float trimDb, float faderDb,
                                            float lowDb, float midDb, float highDb, float filter,
                                            const std::string& orientation, bool muted, bool pfl) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findDeckRoute(deckIndex);
    if (!route) return jsonErr("Deck route not found.");

    route->mix.trimDb   = std::clamp(trimDb, -12.f, 12.f);
    route->mix.faderDb  = std::clamp(faderDb, -60.f, 12.f);
    route->mix.lowDb    = std::clamp(lowDb, -20.f, 20.f);
    route->mix.midDb    = std::clamp(midDb, -20.f, 20.f);
    route->mix.highDb   = std::clamp(highDb, -20.f, 20.f);
    route->mix.filter   = std::clamp(filter, -12.f, 12.f);
    route->mix.cfOrient = cfFromString(orientation);
    route->mix.muted    = muted;
    route->mix.pfl      = pfl;
    route->mix.soloed   = pfl;
    applyDjRouteMix(*route);
    return jsonOk();
}

std::string OdeonSession::setCrossfader(float position) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    crossfaderPos_ = std::clamp(position, 0.f, 1.f);

    std::lock_guard<std::mutex> lk(routesMutex_);
    for (int i = 0; i < numDjDecks_; ++i) {
        if (auto* route = findDeckRoute(i))
            applyDjRouteMix(*route);
    }
    return jsonOk("{\"crossfader\":" + std::to_string(crossfaderPos_) + "}");
}

std::string OdeonSession::setDeckOrientation(int deckIndex, const std::string& orientation) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findDeckRoute(deckIndex);
    if (!route) return jsonErr("Deck route not found.");

    route->mix.cfOrient = cfFromString(orientation);
    applyDjRouteMix(*route);
    return jsonOk();
}

std::string OdeonSession::setPflDeck(int deckIndex, bool enabled) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    std::lock_guard<std::mutex> lk(routesMutex_);
    auto* route = findDeckRoute(deckIndex);
    if (!route) return jsonErr("Deck route not found.");

    route->mix.pfl = enabled;
    route->mix.soloed = enabled;
    applyDjRouteMix(*route);
    return jsonOk();
}

// ─────────────────────────────────────────────────────────────────────────
//  DJ deck controls (Phase B)
// ─────────────────────────────────────────────────────────────────────────

std::string OdeonSession::deckSetHotcue(int deckIndex, int slot, double timeSeconds) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return jsonErr("Invalid deck index.");
    if (slot < 0 || slot >= 8) return jsonErr("Hotcue slot must be 0-7.");

    auto& deck = djDecks_[(size_t) deckIndex];
    if (!deck.loaded) return jsonErr("Deck not loaded.");

    const double t = std::clamp(timeSeconds, 0.0, deck.duration);
    bool found = false;
    for (int i = 0; i < deck.hotcueCount; ++i) {
        if (deck.hotcues[(size_t) i].slot == slot) {
            deck.hotcues[(size_t) i].timeSeconds = t;
            found = true;
            break;
        }
    }
    if (!found) {
        if (deck.hotcueCount >= 8) return jsonErr("Hotcue slots full.");
        deck.hotcues[(size_t) deck.hotcueCount++] = { slot, t };
    }
    return jsonOk("{\"slot\":" + std::to_string(slot) + ",\"timeSeconds\":" + std::to_string(t) + "}");
}

std::string OdeonSession::deckJumpHotcue(int deckIndex, int slot) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return jsonErr("Invalid deck index.");

    const auto& deck = djDecks_[(size_t) deckIndex];
    for (int i = 0; i < deck.hotcueCount; ++i) {
        if (deck.hotcues[(size_t) i].slot == slot) {
            return deckSeek(deckIndex, deck.timelineStart + deck.hotcues[(size_t) i].timeSeconds);
        }
    }
    return jsonErr("Hotcue not set.");
}

std::string OdeonSession::deckClearHotcue(int deckIndex, int slot) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return jsonErr("Invalid deck index.");

    auto& deck = djDecks_[(size_t) deckIndex];
    for (int i = 0; i < deck.hotcueCount; ++i) {
        if (deck.hotcues[(size_t) i].slot == slot) {
            for (int j = i + 1; j < deck.hotcueCount; ++j)
                deck.hotcues[(size_t) j - 1] = deck.hotcues[(size_t) j];
            --deck.hotcueCount;
            return jsonOk();
        }
    }
    return jsonErr("Hotcue not set.");
}

std::string OdeonSession::deckSetLoop(int deckIndex, bool enabled, double inSeconds, double outSeconds) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return jsonErr("Invalid deck index.");

    auto& deck = djDecks_[(size_t) deckIndex];
    if (!deck.loaded) return jsonErr("Deck not loaded.");

    deck.loop.active = enabled;
    deck.loop.inSeconds  = std::max(0.0, inSeconds);
    deck.loop.outSeconds = std::clamp(outSeconds, deck.loop.inSeconds + 0.1, deck.duration);
    return jsonOk();
}

std::string OdeonSession::deckSetSyncMode(int deckIndex, const std::string& mode) {
    if (!djMode_) return jsonErr("Not in DJ session mode.");
    if (deckIndex < 0 || deckIndex >= numDjDecks_) return jsonErr("Invalid deck index.");

    auto& deck = djDecks_[(size_t) deckIndex];
    if (mode == "leader") {
        syncLeaderDeck_ = deckIndex;
        for (int i = 0; i < numDjDecks_; ++i)
            djDecks_[(size_t) i].syncFollower = (i != deckIndex);
    } else if (mode == "follower") {
        deck.syncFollower = true;
    } else {
        deck.syncFollower = false;
    }
    return jsonOk();
}

std::string OdeonSession::notifyTracksReady() {
    onEvent_(R"({"event":"tracksReady"})");
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
//  Playback engine
// ─────────────────────────────────────────────────────────────────────────

void OdeonSession::syncBehaviourConfig() {
    behaviourConfig_.dynamicPluginProcessing = playbackSettings_.dynamicPluginProcessing;
    behaviourConfig_.optimizeLowBuffer       = playbackSettings_.optimizeLowBuffer;
    behaviourConfig_.maxRealtimeThreads      = playbackSettings_.maxRealtimeThreads;
}

void OdeonSession::applyDiskCacheSize() {
    if (!engine_) return;
    engine_->getAudioFileManager().cache.setCacheSizeSamples(diskCacheSamples(playbackSettings_.diskCacheSize));
}

std::string OdeonSession::serializePlaybackSettings() const {
    std::ostringstream ss;
    ss << "{"
       << "\"outputDeviceName\":" << jsonQuote(playbackSettings_.outputDeviceName)
       << ",\"bufferSizeSamples\":" << playbackSettings_.bufferSizeSamples
       << ",\"sampleRate\":" << static_cast<int>(playbackSettings_.sampleRate)
       << ",\"errorRecovery\":{"
       << "\"cpuOverload\":" << jsonQuote(errorPolicyToString(playbackSettings_.cpuOverload))
       << ",\"diskUnderrun\":" << jsonQuote(errorPolicyToString(playbackSettings_.diskUnderrun))
       << ",\"deviceDisconnect\":" << jsonQuote(errorPolicyToString(playbackSettings_.deviceDisconnect))
       << "}"
       << ",\"dynamicPluginProcessing\":" << (playbackSettings_.dynamicPluginProcessing ? "true" : "false")
       << ",\"optimizeLowBuffer\":" << (playbackSettings_.optimizeLowBuffer ? "true" : "false")
       << ",\"maxRealtimeThreads\":" << playbackSettings_.maxRealtimeThreads
       << ",\"ignoreErrorsMainPlayback\":" << (playbackSettings_.ignoreErrorsMainPlayback ? "true" : "false")
       << ",\"ignoreErrorsAuxIo\":" << (playbackSettings_.ignoreErrorsAuxIo ? "true" : "false")
       << ",\"diskCacheSize\":" << jsonQuote(diskCacheToString(playbackSettings_.diskCacheSize))
       << "}";
    return ss.str();
}

std::string OdeonSession::serializeDeviceList() const {
    if (!engine_) return "{\"outputDevices\":[],\"availableBufferSizes\":[],\"availableSampleRates\":[]}";

    auto& dm = engine_->getDeviceManager();
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    dm.deviceManager.getAudioDeviceSetup(setup);

    std::ostringstream ss;
    ss << "{"
       << "\"deviceType\":" << jsonQuote(dm.deviceManager.getCurrentAudioDeviceType().toStdString())
       << ",\"currentOutputDevice\":" << jsonQuote(setup.outputDeviceName.toStdString())
       << ",\"outputDevices\":[";

    if (auto* type = dm.deviceManager.getCurrentDeviceTypeObject()) {
        auto names = type->getDeviceNames(false);
        for (int i = 0; i < names.size(); ++i) {
            if (i > 0) ss << ",";
            ss << "{\"name\":" << jsonQuote(names[i].toStdString())
               << ",\"isCurrent\":" << (names[i] == setup.outputDeviceName ? "true" : "false")
               << "}";
        }
    }
    ss << "],\"availableBufferSizes\":[";

    if (auto* device = dm.deviceManager.getCurrentAudioDevice()) {
        auto sizes = device->getAvailableBufferSizes();
        for (int i = 0; i < sizes.size(); ++i) {
            if (i > 0) ss << ",";
            ss << sizes[i];
        }
    } else {
        ss << "64,128,256,512,1024";
    }

    ss << "],\"availableSampleRates\":[";
    if (auto* device = dm.deviceManager.getCurrentAudioDevice()) {
        auto rates = device->getAvailableSampleRates();
        for (int i = 0; i < rates.size(); ++i) {
            if (i > 0) ss << ",";
            ss << static_cast<int>(rates[i]);
        }
    } else {
        ss << "44100,48000,96000";
    }
    ss << "]}";
    return ss.str();
}

std::string OdeonSession::listAudioDevices() {
    if (!engine_) return jsonErr("Engine not initialised.");
    return jsonOk(serializeDeviceList());
}

std::string OdeonSession::getPlaybackEngineSettings() {
    if (!engine_) return jsonErr("Engine not initialised.");

    auto& dm = engine_->getDeviceManager();
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    dm.deviceManager.getAudioDeviceSetup(setup);

    if (playbackSettings_.outputDeviceName.empty())
        playbackSettings_.outputDeviceName = setup.outputDeviceName.toStdString();

    playbackSettings_.bufferSizeSamples = dm.getBlockSize();
    playbackSettings_.sampleRate        = dm.getSampleRate();

    const auto devices = serializeDeviceList();
    std::ostringstream ss;
    ss << devices.substr(0, devices.size() - 1) // trim trailing }
       << ",\"settings\":" << serializePlaybackSettings()
       << ",\"bufferSizeMs\":" << dm.getBlockSizeMs()
       << ",\"sampleRate\":" << static_cast<int>(dm.getSampleRate())
       << ",\"cpuUsage\":" << dm.getCpuUsage()
       << ",\"diskCacheBytes\":" << engine_->getAudioFileManager().cache.getBytesInUse()
       << ",\"engineAvailable\":" << (deviceReady_ ? "true" : "false")
       << "}";
    return jsonOk(ss.str());
}

std::string OdeonSession::setPlaybackEngineSettings(const juce::var& p) {
    if (!engine_) return jsonErr("Engine not initialised.");

    auto& dm = engine_->getDeviceManager();

    const auto outDev = extractString(p, "outputDeviceName");
    if (!outDev.empty())
        playbackSettings_.outputDeviceName = outDev;

    const int bufSize = static_cast<int>(extractDouble(p, "bufferSizeSamples", playbackSettings_.bufferSizeSamples));
    if (bufSize > 0)
        playbackSettings_.bufferSizeSamples = bufSize;

    const double rate = extractDouble(p, "sampleRate", playbackSettings_.sampleRate);
    if (rate > 0.0)
        playbackSettings_.sampleRate = rate;

    if (auto er = p["errorRecovery"]; er.isObject()) {
        playbackSettings_.cpuOverload      = errorPolicyFromString(extractString(er, "cpuOverload"));
        playbackSettings_.diskUnderrun     = errorPolicyFromString(extractString(er, "diskUnderrun"));
        playbackSettings_.deviceDisconnect = errorPolicyFromString(extractString(er, "deviceDisconnect"));
    }

    playbackSettings_.dynamicPluginProcessing = extractBool(p, "dynamicPluginProcessing", playbackSettings_.dynamicPluginProcessing);
    playbackSettings_.optimizeLowBuffer       = extractBool(p, "optimizeLowBuffer", playbackSettings_.optimizeLowBuffer);
    playbackSettings_.maxRealtimeThreads      = static_cast<int>(extractDouble(p, "maxRealtimeThreads", playbackSettings_.maxRealtimeThreads));
    playbackSettings_.ignoreErrorsMainPlayback = extractBool(p, "ignoreErrorsMainPlayback", playbackSettings_.ignoreErrorsMainPlayback);
    playbackSettings_.ignoreErrorsAuxIo        = extractBool(p, "ignoreErrorsAuxIo", playbackSettings_.ignoreErrorsAuxIo);

    const auto cacheStr = extractString(p, "diskCacheSize");
    if (!cacheStr.empty())
        playbackSettings_.diskCacheSize = diskCacheFromString(cacheStr);

    syncBehaviourConfig();
    applyDiskCacheSize();

    // CPU overload policy → Tracktion mute threshold
    if (playbackSettings_.cpuOverload == ErrorRecoveryPolicy::stop)
        dm.setCpuLimitBeforeMuting(0.85);
    else if (playbackSettings_.cpuOverload == ErrorRecoveryPolicy::silence)
        dm.setCpuLimitBeforeMuting(0.95);
    else
        dm.setCpuLimitBeforeMuting(0.98);

    dm.updateNumCPUs();

    // Apply hardware device + buffer size
    juce::AudioDeviceManager::AudioDeviceSetup setup;
    dm.deviceManager.getAudioDeviceSetup(setup);

    if (!playbackSettings_.outputDeviceName.empty())
        setup.outputDeviceName = playbackSettings_.outputDeviceName;

    setup.bufferSize = playbackSettings_.bufferSizeSamples;
    setup.sampleRate = playbackSettings_.sampleRate;

    const auto err = dm.deviceManager.setAudioDeviceSetup(setup, true);
    if (err.isNotEmpty()) {
        logEngineError("setPlaybackEngineSettings", err.toStdString());
        return jsonErr("Device setup failed: " + err.toStdString());
    }

    dm.rescanWaveDeviceList();
    dm.checkDefaultDevicesAreValid();
    dm.saveSettings();

    return getPlaybackEngineSettings();
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
