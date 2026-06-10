# DJ mixer buses deferred to Tracktion send graph

Main, headphones (PFL), and booth outputs require aux/send routing in the Tracktion graph — not just extra `RouteRole::bus` tracks. Set-preview and Booth currently use per-route EQ, crossfader orientation, and Tracktion solo for interim PFL. Full Mixxx-style `EngineMixer` (separate `m_main`, `m_head`, `m_booth` buffers) is Phase 1C roadmap work.

**Status:** accepted (interim). Revisit when implementing `createBus` + send/return RPC.
