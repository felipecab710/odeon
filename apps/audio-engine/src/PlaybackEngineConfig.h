#pragma once

#include <string>

namespace odeon {

enum class ErrorRecoveryPolicy {
    stop,
    continue_,
    silence,
    repeat_last
};

enum class DiskCacheSize {
    small,
    normal,
    large
};

/** Full playback-engine settings mirrored from @odeon/shared. */
struct PlaybackEngineSettings {
    std::string outputDeviceName;
    int         bufferSizeSamples  = 512;
    double      sampleRate         = 48000.0;

    ErrorRecoveryPolicy cpuOverload      = ErrorRecoveryPolicy::continue_;
    ErrorRecoveryPolicy diskUnderrun     = ErrorRecoveryPolicy::silence;
    ErrorRecoveryPolicy deviceDisconnect = ErrorRecoveryPolicy::stop;

    bool dynamicPluginProcessing = true;
    bool optimizeLowBuffer       = false;
    int  maxRealtimeThreads      = 0;

    bool ignoreErrorsMainPlayback = false;
    bool ignoreErrorsAuxIo        = true;

    DiskCacheSize diskCacheSize = DiskCacheSize::normal;
};

inline ErrorRecoveryPolicy errorPolicyFromString(const std::string& s) {
    if (s == "stop")        return ErrorRecoveryPolicy::stop;
    if (s == "silence")     return ErrorRecoveryPolicy::silence;
    if (s == "repeat_last") return ErrorRecoveryPolicy::repeat_last;
    return ErrorRecoveryPolicy::continue_;
}

inline std::string errorPolicyToString(ErrorRecoveryPolicy p) {
    switch (p) {
        case ErrorRecoveryPolicy::stop:        return "stop";
        case ErrorRecoveryPolicy::silence:     return "silence";
        case ErrorRecoveryPolicy::repeat_last: return "repeat_last";
        default:                             return "continue";
    }
}

inline DiskCacheSize diskCacheFromString(const std::string& s) {
    if (s == "small") return DiskCacheSize::small;
    if (s == "large") return DiskCacheSize::large;
    return DiskCacheSize::normal;
}

inline std::string diskCacheToString(DiskCacheSize s) {
    switch (s) {
        case DiskCacheSize::small:  return "small";
        case DiskCacheSize::large:  return "large";
        default:                    return "normal";
    }
}

inline int64_t diskCacheSamples(DiskCacheSize s) {
    switch (s) {
        case DiskCacheSize::small:  return 220500;
        case DiskCacheSize::large:  return 882000;
        default:                    return 441000;
    }
}

} // namespace odeon
