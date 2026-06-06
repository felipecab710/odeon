import { useEffect } from "react";
import { useUndoStore } from "../stores/undoStore";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Global undo/redo — ⌘Z / ⌘⇧Z (Ctrl on Windows/Linux). */
export function useUndoShortcuts() {
  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      const mod = e.metaKey || e.ctrlKey;
      if (!mod || e.altKey) return;
      if (isTypingTarget(e.target)) return;

      const key = e.key.toLowerCase();
      if (key !== "z") return;

      e.preventDefault();
      e.stopPropagation();

      if (e.shiftKey) {
        useUndoStore.getState().redo();
      } else {
        useUndoStore.getState().undo();
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, []);
}
