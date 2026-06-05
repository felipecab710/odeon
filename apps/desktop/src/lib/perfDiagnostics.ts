/**
 * Dev-only interaction / frame diagnostics.
 * Enable: localStorage.setItem("odeon:perf", "1") then reload.
 */
const IS_DEV = typeof import.meta !== "undefined"
  && !!(import.meta as { env?: { DEV?: boolean } }).env?.DEV;

const ENABLED =
  IS_DEV &&
  typeof localStorage !== "undefined" &&
  localStorage.getItem("odeon:perf") === "1";

type Sample = { label: string; ms: number; at: number };

const samples: Sample[] = [];
const MAX_SAMPLES = 200;

export function perfEnabled() {
  return ENABLED;
}

/** Mark pointer-down; call markEnd on next frame to measure visual latency. */
export function markInteraction(label: string) {
  if (!ENABLED) return;
  const t0 = performance.now();
  requestAnimationFrame(() => {
    const ms = performance.now() - t0;
    pushSample(label, ms);
    if (ms > 16) console.warn(`[odeon:perf] ${label}: ${ms.toFixed(2)}ms (>16ms frame)`);
  });
}

export function measureSync<T>(label: string, fn: () => T): T {
  if (!ENABLED) return fn();
  const t0 = performance.now();
  const out = fn();
  pushSample(label, performance.now() - t0);
  return out;
}

function pushSample(label: string, ms: number) {
  samples.push({ label, ms, at: performance.now() });
  if (samples.length > MAX_SAMPLES) samples.shift();
}

/** Frame budget monitor — call once at app startup in dev. */
export function startFrameMonitor() {
  if (!ENABLED) return () => {};
  let last = performance.now();
  let raf = 0;
  const tick = (now: number) => {
    const dt = now - last;
    last = now;
    if (dt > 20) pushSample("frame", dt);
    raf = requestAnimationFrame(tick);
  };
  raf = requestAnimationFrame(tick);
  return () => cancelAnimationFrame(raf);
}

export function getPerfSamples() {
  return [...samples];
}
