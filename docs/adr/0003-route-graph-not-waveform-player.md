# Route graph, not waveform player

Tracks in Odeon are routes through a mixer graph (Ardour-style), not simple file players. Each route has role, stem type, mix state, clips, metering, and optional analysis tap. We adopted Ardour's concepts on Tracktion Engine rather than forking Ardour or treating the engine as a multi-file previewer.
