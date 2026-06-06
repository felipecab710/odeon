/**
 * Imperative resize — mutates DOM during drag, commits once on mouseup.
 * Avoids React re-renders on every mousemove for buttery resize.
 */

function lockDrag(cursor: string) {
  document.body.style.cursor = cursor;
  document.body.style.userSelect = "none";
}

function unlockDrag() {
  document.body.style.cursor = "";
  document.body.style.userSelect = "";
}

export function beginHorizontalResize(opts: {
  startX: number;
  startSize: number;
  min: number;
  max: number;
  el: HTMLElement;
  onCommit: (size: number) => void;
}): void {
  const { startX, startSize, min, max, el, onCommit } = opts;
  lockDrag("ew-resize");

  const apply = (clientX: number) => {
    const next = Math.max(min, Math.min(max, startSize + (startX - clientX)));
    el.style.width = `${next}px`;
    return next;
  };

  const onMove = (ev: MouseEvent) => {
    apply(ev.clientX);
  };

  const onUp = (ev: MouseEvent) => {
    const final = apply(ev.clientX);
    unlockDrag();
    onCommit(final);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

export function beginVerticalResize(opts: {
  startY: number;
  startSize: number;
  min: number;
  max: number;
  el: HTMLElement;
  onCommit: (size: number) => void;
}): void {
  const { startY, startSize, min, max, el, onCommit } = opts;
  lockDrag("ns-resize");

  const apply = (clientY: number) => {
    const next = Math.max(min, Math.min(max, startSize + (startY - clientY)));
    el.style.height = `${next}px`;
    return next;
  };

  const onMove = (ev: MouseEvent) => {
    apply(ev.clientY);
  };

  const onUp = (ev: MouseEvent) => {
    const final = apply(ev.clientY);
    unlockDrag();
    onCommit(final);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}

/** Resize by dragging a bottom edge — moving mouse down increases height. */
export function beginVerticalResizeDown(opts: {
  startY: number;
  startSize: number;
  min: number;
  max: number;
  onPreview: (size: number) => void;
  onCommit: (size: number) => void;
}): void {
  const { startY, startSize, min, max, onPreview, onCommit } = opts;
  lockDrag("ns-resize");

  const apply = (clientY: number) => {
    const next = Math.max(min, Math.min(max, startSize + (clientY - startY)));
    onPreview(next);
    return next;
  };

  const onMove = (ev: MouseEvent) => {
    apply(ev.clientY);
  };

  const onUp = (ev: MouseEvent) => {
    const final = apply(ev.clientY);
    unlockDrag();
    onCommit(final);
    window.removeEventListener("mousemove", onMove);
    window.removeEventListener("mouseup", onUp);
  };

  window.addEventListener("mousemove", onMove);
  window.addEventListener("mouseup", onUp);
}
