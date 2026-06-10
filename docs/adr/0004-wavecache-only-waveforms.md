# Wavecache-only waveform display

All waveform rendering uses precomputed `.odeon.wavecache` binary sidecars. The UI never decodes live `AudioBuffer` or WAV data for display. Analysis builds the pyramid at import time; the desktop tile-caches and blits visible regions. This keeps scroll/zoom off the audio and UI threads.
