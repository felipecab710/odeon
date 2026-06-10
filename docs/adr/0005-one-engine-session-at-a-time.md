# One engine session at a time

The desktop app runs a single active engine session. Studio (`useEngineSync`) and Research set preview (`useSetEngineSync`) / Booth (`useDjEngineSync`) each call `createSession`, which disposes the prior session. Never run two sync hooks simultaneously — switching views tears down the previous graph.

**Considered options:** Multiple concurrent sessions (rejected — sidecar is one process, one Edit); shared session with view-specific routing (deferred — complexity vs current product scope).
