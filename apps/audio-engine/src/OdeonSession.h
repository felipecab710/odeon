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
#include "OdeonDjDeck.h"
#include "OdeonEngineBehaviour.h"
#include "PlaybackEngineConfig.h"

#include <array>

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
    std::string pause();   // stop clock, preserve playhead
    std::string stop();    // stop clock, seek to 0
    std::string seek(double timeSeconds);
    std::string setLoop(bool enabled, double startSeconds, double endSeconds);
    std::string getTransportState();

    // ── Mixer ──────────────────────────────────────────────────────────────────
    std::string setTrackVolume(const std::string& trackId, float volumeDb);
    std::string setTrackPan(const std::string& trackId, float pan);
    std::string muteTrack(const std::string& trackId, bool muted);
    std::string soloTrack(const std::string& trackId, bool soloed);
    /** Full DJM channel strip on any route (set lanes, studio tracks, decks). */
    std::string setTrackChannelMix(const std::string& trackId, float trimDb, float faderDb,
                                   float lowDb, float midDb, float highDb, float filter,
                                   const std::string& orientation, bool muted);
    /** Pro Tools / Ableton-style exclusive solo within a route group (one RPC, no graph rebuild). */
    std::string exclusiveSolo(const juce::var& trackIds, const std::string& soloTrackId);
    /** DAW stem stack: parallel routes at t=0, registered for exclusive solo. */
    std::string createStemStack(const std::string& stackId, const juce::var& layers);
    std::string disposeStemStack(const std::string& stackId);
    std::string exclusiveSoloStack(const std::string& stackId, const std::string& layerId);
    std::string setMasterVolume(float volumeDb);
    std::string getTrackMeters();

    // ── Clip positioning ─────────────────────────────────────────────────────
    std::string moveClip(const std::string& trackId, const std::string& clipId,
                         double newStartTimeSeconds);

    // ── Session readiness ────────────────────────────────────────────────────
    std::string notifyTracksReady();

    // ── DJ deck players (Mixxx EngineBuffer model) ───────────────────────────
    std::string createDjSession(int numDecks);
    std::string loadDeck(int deckIndex, const std::string& filePath,
                         const std::string& name, double timelineStartSeconds);
    std::string unloadDeck(int deckIndex);
    std::string deckSeek(int deckIndex, double localSeconds);
    std::string deckPlay(int deckIndex);
    std::string deckPause(int deckIndex);
    std::string deckSetRate(int deckIndex, double rate);
    std::string getDjState();

    // ── DJ mixer DSP (Phase C) ───────────────────────────────────────────────
    std::string setDeckEq(int deckIndex, float lowDb, float midDb, float highDb);
    std::string setDeckFilter(int deckIndex, float filter);
    std::string setDeckChannelMix(int deckIndex, float trimDb, float faderDb,
                                  float lowDb, float midDb, float highDb, float filter,
                                  const std::string& orientation, bool muted, bool pfl);
    std::string setCrossfader(float position);
    std::string setDeckOrientation(int deckIndex, const std::string& orientation);
    std::string setPflDeck(int deckIndex, bool enabled);

    // ── DJ deck controls (Phase B) ─────────────────────────────────────────
    std::string deckSetHotcue(int deckIndex, int slot, double timeSeconds);
    std::string deckJumpHotcue(int deckIndex, int slot);
    std::string deckClearHotcue(int deckIndex, int slot);
    std::string deckSetLoop(int deckIndex, bool enabled, double inSeconds, double outSeconds);
    std::string deckSetSyncMode(int deckIndex, const std::string& mode);
    /** Pre-load stem WAVs on parallel routes for instant layer switching. */
    std::string deckLoadStemLayers(int deckIndex, const juce::var& layers);
    /** Instant layer switch — mute/unmute only (Mixxx/Pioneer stem parity). */
    std::string deckSetStemLayer(int deckIndex, const std::string& layerId);

    // ── Render ──────────────────────────────────────────────────────────────────
    std::string renderMix(const std::string& outputFilePath);

    // ── AI native seam ────────────────────────────────────────────────────────
    std::string analyze(const std::string& trackId);

    // ── Playback engine ─────────────────────────────────────────────────────
    std::string listAudioDevices();
    std::string getPlaybackEngineSettings();
    std::string setPlaybackEngineSettings(const juce::var& params);

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
    OdeonRoute* findDeckRoute(int deckIndex);
    void        ensureDeckEqualiser(OdeonRoute& route);
    float       crossfaderWeightDb(CfOrientation orient) const;
    void        applyDjRouteMix(OdeonRoute& route);
    void        clearDeckClips(OdeonDjDeck& deck);
    void        clearDeckStemLayers(OdeonDjDeck& deck);
    void        enableStemLayerParallelPlayback(OdeonDjDeck& deck, bool dispatchGraph);
    /** Stem stack: all clips play in parallel; route solo selects the audible layer. */
    std::string applyDeckStemSoloState(OdeonDjDeck& deck);
    std::string stackRouteId(const std::string& stackId, const std::string& layerId) const;
    void        registerSoloGroup(const std::string& groupId, const std::vector<std::string>& trackIds);
    void        unregisterSoloGroup(const std::string& groupId);
    te::WaveAudioClip* findDeckWaveClip(OdeonRoute* route, const juce::File& expectedFile);
    void        syncDeckClipToPlayer(OdeonDjDeck& deck);
    void        advanceDeckPlayers(double deltaSeconds);
    void        updateDjTransport();
    bool        anyDeckPlaying() const;
    /** Select / 1-deck preview: clip at t=0, shared transport is the playhead (DAW path). */
    bool        usesDirectTransportDeckMode() const;
    void        ensureProjectFolders(const juce::File& root);
    juce::File  projectFolder() const;
    std::string serializeProjectJson() const;
    bool        writeAtomic(const juce::File& dest, const juce::String& contents, juce::String& error);
    void        logEngineError(const std::string& where, const std::string& message);

    void  meterPollLoop();
    void  enforceDeckLoops();
    float linearToDb(float linear) const noexcept;
    float dbToLinear(float db) const noexcept;

    void syncBehaviourConfig();
    void applyDiskCacheSize();
    std::string serializePlaybackSettings() const;
    std::string serializeDeviceList() const;

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

    PlaybackEngineSettings playbackSettings_;
    PlaybackEngineConfig   behaviourConfig_;

    bool djMode_ = false;
    int  numDjDecks_ = 0;
    std::array<OdeonDjDeck, 4> djDecks_{};
    float crossfaderPos_ = 0.5f;
    int   syncLeaderDeck_ = 0;
    std::map<std::string, std::vector<std::string>> soloGroups_;

    static constexpr int kSchemaVersion = 1;
};

} // namespace odeon
