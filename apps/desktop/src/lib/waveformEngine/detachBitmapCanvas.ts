/** Detach an offscreen bitmap canvas without tripping React / DOM races. */
export function detachBitmapCanvas(canvas: HTMLCanvasElement | null | undefined): void {
  if (!canvas?.isConnected) return;
  canvas.remove();
}
