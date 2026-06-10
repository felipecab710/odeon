# Three-process architecture (UI, native engine, Python analysis)

Odeon splits into three processes with no shared memory: React desktop (UI + Tauri bridge), C++ audio engine (real-time playback), and FastAPI (offline analysis only). Playback and sample-accurate transport live exclusively in the engine; Python never drives audio output; React never decodes audio for playback or waveforms.
