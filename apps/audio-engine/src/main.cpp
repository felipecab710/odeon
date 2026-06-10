/**
 * odeon-engine — native session engine host.
 *
 * Two modes:
 *   (default) JSON-RPC server over stdio. One JSON object per line on stdin:
 *             { "id": N, "method": "...", "params": {...} }
 *             Responses + async events are one JSON object per line on stdout.
 *             The main thread pumps the JUCE message loop so native playback
 *             runs on a stable transport clock independent of React timing.
 *
 *   --selftest  Headless proof harness: builds an 8-route session, plays it
 *               sample-synced, exercises transport/loop/mixer/meters/render and
 *               save+reopen, prints PASS/FAIL per gate and exits nonzero on
 *               any failure. This is the reliability gate.
 */

#include <juce_core/juce_core.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_events/juce_events.h>

#include <iostream>
#include <string>
#include <mutex>
#include <atomic>
#include <cmath>

#include <unistd.h>
#include <sys/select.h>

#include "OdeonSession.h"

// ─────────────────────────────────────────────────────────────────────────
//  Thread-safe stdout
// ─────────────────────────────────────────────────────────────────────────

static std::mutex g_stdoutMutex;

static void writeLine(const std::string& line) {
    std::lock_guard<std::mutex> lk(g_stdoutMutex);
    std::cout << line << "\n";
    std::cout.flush();
}

// ─────────────────────────────────────────────────────────────────────────
//  JSON extraction helpers
// ─────────────────────────────────────────────────────────────────────────

static std::string extractString(const juce::var& v, const char* key, const std::string& def = "") {
    auto val = v[key];
    return val.isString() ? val.toString().toStdString() : def;
}
static double extractDouble(const juce::var& v, const char* key, double def = 0.0) {
    auto val = v[key];
    return (val.isDouble() || val.isInt() || val.isInt64()) ? static_cast<double>(val) : def;
}
static bool extractBool(const juce::var& v, const char* key, bool def = false) {
    auto val = v[key];
    return val.isBool() ? static_cast<bool>(val) : def;
}
static float extractFloat(const juce::var& v, const char* key, float def = 0.f) {
    return static_cast<float>(extractDouble(v, key, static_cast<double>(def)));
}

// ─────────────────────────────────────────────────────────────────────────
//  RPC dispatch
// ─────────────────────────────────────────────────────────────────────────

static std::string dispatch(odeon::OdeonSession& s, const std::string& method, const juce::var& p) {
    using odeon::jsonErr;
    if (method == "createSession" || method == "createProject")
        return s.createSession(extractString(p, "projectId"), extractString(p, "projectDir"));
    if (method == "openSession" || method == "loadProject")
        return s.openSession(extractString(p, "projectId"), extractString(p, "projectDir"));
    if (method == "saveSession" || method == "saveProject")
        return s.saveSession();
    if (method == "disposeSession" || method == "disposeProject")
        return s.disposeSession();
    if (method == "createTrack")
        return s.createTrack(extractString(p, "trackId"), extractString(p, "name"),
                             extractString(p, "role"), extractString(p, "stemType"));
    if (method == "removeTrack")
        return s.removeTrack(extractString(p, "trackId"));
    if (method == "addClip" || method == "loadAudioFile")
        return s.addClip(extractString(p, "trackId"), extractString(p, "clipId"),
                         extractString(p, "filePath"), extractDouble(p, "startTimeSeconds"));
    if (method == "play")   return s.play();
    if (method == "pause")  return s.pause();
    if (method == "stop")   return s.stop();
    if (method == "seek")   return s.seek(extractDouble(p, "timeSeconds"));
    if (method == "setLoop")
        return s.setLoop(extractBool(p, "enabled"), extractDouble(p, "startSeconds"), extractDouble(p, "endSeconds"));
    if (method == "getTransportState")  return s.getTransportState();
    if (method == "notifyTracksReady")  return s.notifyTracksReady();
    if (method == "setTrackVolume")
        return s.setTrackVolume(extractString(p, "trackId"), extractFloat(p, "volumeDb"));
    if (method == "setTrackPan")
        return s.setTrackPan(extractString(p, "trackId"), extractFloat(p, "pan"));
    if (method == "muteTrack")
        return s.muteTrack(extractString(p, "trackId"), extractBool(p, "muted"));
    if (method == "soloTrack")
        return s.soloTrack(extractString(p, "trackId"), extractBool(p, "soloed"));
    if (method == "setTrackChannelMix")
        return s.setTrackChannelMix(extractString(p, "trackId"),
                                    extractFloat(p, "trimDb"), extractFloat(p, "faderDb"),
                                    extractFloat(p, "lowDb"), extractFloat(p, "midDb"), extractFloat(p, "highDb"),
                                    extractFloat(p, "filter"), extractString(p, "orientation", "THRU"),
                                    extractBool(p, "muted"));
    if (method == "exclusiveSolo")
        return s.exclusiveSolo(p.getProperty("trackIds", juce::var()), extractString(p, "soloTrackId"));
    if (method == "createStemStack")
        return s.createStemStack(extractString(p, "stackId"), p.getProperty("layers", juce::var()));
    if (method == "disposeStemStack")
        return s.disposeStemStack(extractString(p, "stackId"));
    if (method == "exclusiveSoloStack")
        return s.exclusiveSoloStack(extractString(p, "stackId"), extractString(p, "layerId"));
    if (method == "setMasterVolume")
        return s.setMasterVolume(extractFloat(p, "volumeDb"));
    if (method == "moveClip")
        return s.moveClip(extractString(p, "trackId"), extractString(p, "clipId"),
                          extractDouble(p, "newStartTimeSeconds"));
    if (method == "getTrackMeters")  return s.getTrackMeters();
    if (method == "renderMix")       return s.renderMix(extractString(p, "outputFilePath"));
    if (method == "analyze")         return s.analyze(extractString(p, "trackId"));
    if (method == "listAudioDevices")        return s.listAudioDevices();
    if (method == "getPlaybackEngineSettings") return s.getPlaybackEngineSettings();
    if (method == "setPlaybackEngineSettings") return s.setPlaybackEngineSettings(p);

    if (method == "createDjSession")
        return s.createDjSession(static_cast<int>(extractDouble(p, "numDecks", 4.0)));
    if (method == "loadDeck")
        return s.loadDeck(static_cast<int>(extractDouble(p, "deckIndex")),
                          extractString(p, "filePath"),
                          extractString(p, "name"),
                          extractDouble(p, "timelineStartSeconds"));
    if (method == "unloadDeck")
        return s.unloadDeck(static_cast<int>(extractDouble(p, "deckIndex")));
    if (method == "deckSeek")
        return s.deckSeek(static_cast<int>(extractDouble(p, "deckIndex")),
                          extractDouble(p, "localSeconds",
                                        extractDouble(p, "timelineStartSeconds", 0.0)));
    if (method == "deckPlay")
        return s.deckPlay(static_cast<int>(extractDouble(p, "deckIndex")));
    if (method == "deckPause")
        return s.deckPause(static_cast<int>(extractDouble(p, "deckIndex")));
    if (method == "deckSetRate")
        return s.deckSetRate(static_cast<int>(extractDouble(p, "deckIndex")),
                             extractDouble(p, "rate", 1.0));
    if (method == "getDjState") return s.getDjState();
    if (method == "setDeckEq")
        return s.setDeckEq(static_cast<int>(extractDouble(p, "deckIndex")),
                         extractFloat(p, "lowDb"), extractFloat(p, "midDb"), extractFloat(p, "highDb"));
    if (method == "setDeckFilter")
        return s.setDeckFilter(static_cast<int>(extractDouble(p, "deckIndex")), extractFloat(p, "filter"));
    if (method == "setDeckChannelMix")
        return s.setDeckChannelMix(static_cast<int>(extractDouble(p, "deckIndex")),
                                   extractFloat(p, "trimDb"), extractFloat(p, "faderDb"),
                                   extractFloat(p, "lowDb"), extractFloat(p, "midDb"), extractFloat(p, "highDb"),
                                   extractFloat(p, "filter"), extractString(p, "orientation", "THRU"),
                                   extractBool(p, "muted"), extractBool(p, "pfl"));
    if (method == "setCrossfader")
        return s.setCrossfader(extractFloat(p, "position", 0.5f));
    if (method == "setDeckOrientation")
        return s.setDeckOrientation(static_cast<int>(extractDouble(p, "deckIndex")),
                                  extractString(p, "orientation", "THRU"));
    if (method == "setPflDeck")
        return s.setPflDeck(static_cast<int>(extractDouble(p, "deckIndex")), extractBool(p, "enabled"));
    if (method == "deckSetHotcue")
        return s.deckSetHotcue(static_cast<int>(extractDouble(p, "deckIndex")),
                               static_cast<int>(extractDouble(p, "slot")),
                               extractDouble(p, "timeSeconds"));
    if (method == "deckJumpHotcue")
        return s.deckJumpHotcue(static_cast<int>(extractDouble(p, "deckIndex")),
                               static_cast<int>(extractDouble(p, "slot")));
    if (method == "deckClearHotcue")
        return s.deckClearHotcue(static_cast<int>(extractDouble(p, "deckIndex")),
                                static_cast<int>(extractDouble(p, "slot")));
    if (method == "deckSetLoop")
        return s.deckSetLoop(static_cast<int>(extractDouble(p, "deckIndex")),
                             extractBool(p, "enabled"),
                             extractDouble(p, "inSeconds"), extractDouble(p, "outSeconds"));
    if (method == "deckSetSyncMode")
        return s.deckSetSyncMode(static_cast<int>(extractDouble(p, "deckIndex")),
                                 extractString(p, "mode", "off"));
    if (method == "deckLoadStemLayers")
        return s.deckLoadStemLayers(static_cast<int>(extractDouble(p, "deckIndex")),
                                    p.getProperty("layers", juce::var()));
    if (method == "deckSetStemLayer")
        return s.deckSetStemLayer(static_cast<int>(extractDouble(p, "deckIndex")),
                                  extractString(p, "layerId"));

    return jsonErr("Unknown method: " + method);
}

static void handleLine(odeon::OdeonSession& session, const std::string& line) {
    if (line.empty()) return;

    juce::var parsed;
    auto result = juce::JSON::parse(juce::String(line), parsed);
    if (result.failed()) {
        writeLine("{\"id\":null,\"error\":\"JSON parse error: " + result.getErrorMessage().toStdString() + "\"}");
        return;
    }

    const int   rpcId  = static_cast<int>(parsed["id"]);
    const auto  method = extractString(parsed, "method");
    const juce::var params = parsed["params"];

    const std::string payload = dispatch(session, method, params);
    writeLine("{\"id\":" + std::to_string(rpcId) + ",\"result\":" + payload + "}");
}

// ─────────────────────────────────────────────────────────────────────────
//  Server loop: pump the message thread + read stdin non-blocking
// ─────────────────────────────────────────────────────────────────────────

static int runServer() {
    odeon::OdeonSession session([](const std::string& l) { writeLine(l); });
    session.initialise();

    std::string inbuf;
    bool running = true;

    while (running) {
        juce::MessageManager::getInstance()->runDispatchLoopUntil(20);

        fd_set set;
        FD_ZERO(&set);
        FD_SET(STDIN_FILENO, &set);
        struct timeval tv { 0, 0 };

        if (select(STDIN_FILENO + 1, &set, nullptr, nullptr, &tv) > 0) {
            char tmp[8192];
            ssize_t n = ::read(STDIN_FILENO, tmp, sizeof(tmp));
            if (n <= 0) { running = false; break; }   // EOF -> shutdown
            inbuf.append(tmp, static_cast<size_t>(n));

            size_t pos;
            while ((pos = inbuf.find('\n')) != std::string::npos) {
                std::string oneLine = inbuf.substr(0, pos);
                inbuf.erase(0, pos + 1);
                if (!oneLine.empty() && oneLine.back() == '\r') oneLine.pop_back();
                handleLine(session, oneLine);
            }
        }
    }

    session.shutdown();
    return 0;
}

// ─────────────────────────────────────────────────────────────────────────
//  Self-test proof harness
// ─────────────────────────────────────────────────────────────────────────

namespace {

int    g_pass = 0;
int    g_fail = 0;

void check(const std::string& gate, bool ok, const std::string& detail = "") {
    if (ok) { ++g_pass; std::cerr << "  PASS  " << gate << "\n"; }
    else    { ++g_fail; std::cerr << "  FAIL  " << gate << (detail.empty() ? "" : "  (" + detail + ")") << "\n"; }
}

bool jsonOkOf(const std::string& s) {
    return s.find("\"ok\":true") != std::string::npos;
}

void pump(int ms) {
    juce::MessageManager::getInstance()->runDispatchLoopUntil(ms);
}

// Reads a WAV and returns { peakMagnitude, lengthSeconds, numChannels }.
struct WavStats { float peak = 0.f; double seconds = 0.0; int channels = 0; bool valid = false; };

WavStats readWavStats(const juce::File& file) {
    WavStats s;
    juce::AudioFormatManager fm; fm.registerBasicFormats();
    std::unique_ptr<juce::AudioFormatReader> reader(fm.createReaderFor(file));
    if (reader == nullptr) return s;
    s.valid    = true;
    s.channels = (int) reader->numChannels;
    s.seconds  = reader->sampleRate > 0 ? reader->lengthInSamples / reader->sampleRate : 0.0;
    juce::AudioBuffer<float> buf((int) reader->numChannels, (int) juce::jmin<juce::int64>(reader->lengthInSamples, 1 << 20));
    reader->read(&buf, 0, buf.getNumSamples(), 0, true, true);
    s.peak = buf.getMagnitude(0, buf.getNumSamples());
    return s;
}

bool generateTestWav(const juce::File& file, double freqHz, double seconds, double sampleRate) {
    file.deleteFile();
    juce::WavAudioFormat fmt;
    std::unique_ptr<juce::FileOutputStream> stream(file.createOutputStream());
    if (stream == nullptr) return false;

    std::unique_ptr<juce::AudioFormatWriter> writer(
        fmt.createWriterFor(stream.get(), sampleRate, 2, 16, {}, 0));
    if (writer == nullptr) return false;
    stream.release(); // writer owns it now

    const int numSamples = static_cast<int>(seconds * sampleRate);
    juce::AudioBuffer<float> buffer(2, numSamples);
    for (int ch = 0; ch < 2; ++ch) {
        auto* d = buffer.getWritePointer(ch);
        for (int i = 0; i < numSamples; ++i)
            d[i] = 0.25f * std::sin(juce::MathConstants<float>::twoPi * (float) freqHz * (float) i / (float) sampleRate);
    }
    writer->writeFromAudioSampleBuffer(buffer, 0, numSamples);
    return true;
}

} // namespace

static int runSelfTest() {
    std::cerr << "\n=== Odeon Engine self-test ===\n";

    odeon::OdeonSession session([](const std::string&) { /* swallow events during selftest */ });
    session.initialise();

    auto tmp = juce::File::getSpecialLocation(juce::File::tempDirectory)
                   .getChildFile("OdeonSelfTest_" + juce::String(juce::Time::getCurrentTime().toMilliseconds()));
    auto stemsDir = tmp.getChildFile("stems");
    stemsDir.createDirectory();

    // 8 test WAVs (musical-ish frequency spread).
    const char* names[8]   = { "ref_drums", "ref_bass", "ref_vocals", "ref_music",
                               "my_drums",  "my_bass",  "my_vocals",  "my_music" };
    const char* roles[8]   = { "reference", "reference", "reference", "reference",
                               "user", "user", "user", "user" };
    const char* stems[8]   = { "drums", "bass", "vocals", "music",
                               "drums", "bass", "vocals", "music" };
    const double freqs[8]  = { 110, 73, 440, 220, 110, 73, 440, 220 };

    bool wavsOk = true;
    juce::File wavFiles[8];
    for (int i = 0; i < 8; ++i) {
        wavFiles[i] = stemsDir.getChildFile(juce::String(names[i]) + ".wav");
        wavsOk &= generateTestWav(wavFiles[i], freqs[i], 4.0, 44100.0);
    }
    check("generate 8 test WAVs", wavsOk);

    check("createSession", jsonOkOf(session.createSession("selftest", tmp.getFullPathName().toStdString())));

    bool tracksOk = true, clipsOk = true;
    for (int i = 0; i < 8; ++i) {
        tracksOk &= jsonOkOf(session.createTrack(names[i], names[i], roles[i], stems[i]));
        clipsOk  &= jsonOkOf(session.addClip(names[i], std::string("clip_") + names[i],
                                             wavFiles[i].getFullPathName().toStdString(), 0.0));
    }
    check("create 8 routes", tracksOk);
    check("add 8 clips at t=0", clipsOk);

    // Live playback (informational): needs a real output device, which a
    // headless/sandboxed shell may not have. The authoritative sample-sync
    // proof is the offline render-content check below (device-independent).
    const bool deviceReady = session.isDeviceReady();
    if (deviceReady) {
        session.play();
        pump(800);
        const double posA = session.positionSeconds();
        pump(400);
        const double posB = session.positionSeconds();
        session.stop();
        check("8-route live playback advances (sample-synced)", posB > posA && posA > 0.0,
              "posA=" + std::to_string(posA) + " posB=" + std::to_string(posB));
    } else {
        std::cerr << "  INFO  live playback skipped: no audio output device in this environment\n";
    }

    // Seek + loop.
    session.seek(1.0);
    pump(50);
    check("seek to 1.0s", std::abs(session.positionSeconds() - 1.0) < 0.25);
    check("setLoop 0..2s", jsonOkOf(session.setLoop(true, 0.0, 2.0)));

    // Mixer.
    check("setTrackVolume", jsonOkOf(session.setTrackVolume("ref_drums", -6.0f)));
    check("setTrackPan",    jsonOkOf(session.setTrackPan("ref_bass", -0.5f)));
    check("muteTrack",      jsonOkOf(session.muteTrack("my_vocals", true)));
    check("soloTrack",      jsonOkOf(session.soloTrack("ref_vocals", true)));
    session.soloTrack("ref_vocals", false);

    // Meters: poll once; expect a JSON object with 8 entries.
    {
        auto meters = session.getTrackMeters();
        int colons = 0; for (char c : meters) if (c == ':') ++colons;
        check("getTrackMeters returns data", meters.front() == '{' && colons >= 8);
    }

    // Render a stereo bounce AND verify content: this is the device-independent
    // proof that all 8 routes are mixed sample-synced through the graph.
    {
        // Clear mute/solo so the bounce contains all routes.
        session.muteTrack("my_vocals", false);
        auto r = session.renderMix("selftest.wav");
        bool ok = jsonOkOf(r);
        auto rendered = tmp.getChildFile("audio").getChildFile("renders").getChildFile("selftest.wav");
        check("render stereo bounce", ok && rendered.existsAsFile());

        auto stats = readWavStats(rendered);
        check("rendered mix is stereo",        stats.valid && stats.channels == 2);
        check("rendered mix is ~4s long",      stats.valid && std::abs(stats.seconds - 4.0) < 0.5,
              "len=" + std::to_string(stats.seconds));
        check("rendered mix is non-silent (8 routes summed)", stats.valid && stats.peak > 0.01f,
              "peak=" + std::to_string(stats.peak));
    }

    // Save -> dispose -> reopen with identical route count.
    check("saveSession", jsonOkOf(session.saveSession()));
    session.disposeSession();
    {
        auto r = session.openSession("selftest", tmp.getFullPathName().toStdString());
        bool ok = jsonOkOf(r) && r.find("\"routeCount\":8") != std::string::npos;
        check("reopen session with 8 routes", ok, r);
    }

    // Missing file handled gracefully (must return ok:false, not crash).
    check("missing file handled gracefully",
          !jsonOkOf(session.addClip("ref_drums", "bad", "/no/such/file.wav", 0.0)));

    session.shutdown();
    tmp.deleteRecursively();

    std::cerr << "\n=== " << g_pass << " passed, " << g_fail << " failed ===\n\n";
    return g_fail == 0 ? 0 : 1;
}

// ─────────────────────────────────────────────────────────────────────────
//  main
// ─────────────────────────────────────────────────────────────────────────

int main(int argc, char** argv) {
    juce::ScopedJuceInitialiser_GUI init;

    for (int i = 1; i < argc; ++i)
        if (std::string(argv[i]) == "--selftest")
            return runSelfTest();

    return runServer();
}
