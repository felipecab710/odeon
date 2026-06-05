/** Coalesce high-frequency callbacks to one per animation frame. */
export function rafThrottle(fn: (e: MouseEvent) => void): (e: MouseEvent) => void {
  let rafId: number | null = null;
  let lastEvent: MouseEvent | null = null;

  const run = () => {
    rafId = null;
    if (lastEvent) fn(lastEvent);
    lastEvent = null;
  };

  return (e: MouseEvent) => {
    lastEvent = e;
    if (rafId === null) {
      rafId = requestAnimationFrame(run);
    }
  };
}
