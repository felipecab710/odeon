# Aux bus names on every session

Every `createSession` registers Tracktion aux bus names `Headphones` (bus 0) and `Booth` (bus 1). `createBus` RPC creates `RouteRole::bus` routes for future send/return wiring. Full PFL/main/booth summing still requires aux send/return plugins and multi-out mapping (Phase 1C).
