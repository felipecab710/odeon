/**
 * Native shell chrome — Pro Tools / Ableton-style resize:
 * - Dark grey title bar (not system white)
 * - CSS flex layout tracks the window frame every frame
 * - Only expensive canvas work (waveforms) defers until resize settles
 */

/** Title bar + resize bleed — studio-surface grey, not pure black or white. */
export const SHELL_CHROME_BG = "#1A1A1A";
/** Main edit/mixer background. */
export const STUDIO_BG = "#0F0F0F";

let resizeEndTimer: ReturnType<typeof setTimeout> | null = null;

export function isWindowResizing(): boolean {
  return document.documentElement.dataset.resizing === "true";
}

/** Paint underlay colours only — never set pixel dimensions (that fights CSS and causes lag). */
export function paintShellUnderlay() {
  document.documentElement.style.backgroundColor = SHELL_CHROME_BG;
  document.body.style.backgroundColor = STUDIO_BG;

  const bleed = document.getElementById("window-bleed");
  if (bleed) bleed.style.backgroundColor = SHELL_CHROME_BG;

  const root = document.getElementById("root");
  if (root) root.style.backgroundColor = STUDIO_BG;
}

async function configureNativeChrome() {
  try {
    const { getCurrentWebviewWindow } = await import("@tauri-apps/api/webviewWindow");
    const win = getCurrentWebviewWindow();
    await win.setTheme("dark");
    await win.setBackgroundColor(SHELL_CHROME_BG);
  } catch { /* browser dev */ }
}

/** Call once at startup (before React paint). */
export function initNativeWindowShell() {
  paintShellUnderlay();
  void configureNativeChrome();

  window.addEventListener(
    "resize",
    () => {
      paintShellUnderlay();
      document.documentElement.dataset.resizing = "true";
      if (resizeEndTimer) clearTimeout(resizeEndTimer);
      resizeEndTimer = setTimeout(() => {
        delete document.documentElement.dataset.resizing;
        window.dispatchEvent(new CustomEvent("odeon:resize-end"));
      }, 80);
    },
    { passive: true },
  );
}

/**
 * ResizeObserver → immediate layout measure (Ableton/Pro Tools keep panels
 * glued to the frame). Do not defer flex layout during a native resize drag.
 */
export function onLayoutResize(
  el: Element,
  measure: () => void,
): () => void {
  const ro = new ResizeObserver(() => measure());
  ro.observe(el);
  measure();
  return () => ro.disconnect();
}
