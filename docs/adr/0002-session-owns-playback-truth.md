# Session owns playback truth

The native `OdeonSession` is the source of truth for transport, routes, clips, and mixer state. The desktop UI is a projection — it sends commands and reflects events, but does not own playhead position, levels, or graph topology. This mirrors Ardour's session model and prevents React timing from becoming the playback clock.
