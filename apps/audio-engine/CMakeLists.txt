cmake_minimum_required(VERSION 3.22)
project(odeon_engine VERSION 0.1.0 LANGUAGES C CXX)

set(CMAKE_CXX_STANDARD 20)
set(CMAKE_CXX_STANDARD_REQUIRED ON)

# ──────────────────────────────────────────────
#  Tracktion Engine (vendors JUCE as submodule)
# ──────────────────────────────────────────────
# Clone with: git submodule add https://github.com/Tracktion/tracktion_engine.git vendor/tracktion_engine
# Then:       git submodule update --init --recursive

set(TE_ADD_EXAMPLES OFF CACHE BOOL "" FORCE)
add_subdirectory(vendor/tracktion_engine)

# ──────────────────────────────────────────────
#  odeon-engine target
# ──────────────────────────────────────────────
juce_add_console_app(odeon_engine
    PRODUCT_NAME "OdeonEngine"
    VERSION      "0.1.0"
)

target_compile_features(odeon_engine PRIVATE cxx_std_20)

target_sources(odeon_engine
    PRIVATE
        src/main.cpp
        src/OdeonSession.cpp
)

target_compile_definitions(odeon_engine
    PRIVATE
        JUCE_WEB_BROWSER=0
        JUCE_USE_CURL=0
        JUCE_MODAL_LOOPS_PERMITTED=1
)

target_link_libraries(odeon_engine
    PRIVATE
        tracktion::tracktion_engine
        juce::juce_audio_basics
        juce::juce_audio_devices
        juce::juce_audio_formats
        juce::juce_audio_processors
        juce::juce_audio_utils
        juce::juce_core
        juce::juce_dsp
        juce::juce_events
)
