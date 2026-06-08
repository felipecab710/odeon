/**
 * Locator keyboard shortcuts — Delete, Cmd+R rename, K key-map mode, bound keys.
 */
import { useEffect } from "react";
import { useSetLocatorStore } from "../stores/setLocatorStore";

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  const tag = node.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT" || node.isContentEditable;
}

interface Options {
  enabled?: boolean;
  onJumpToLocator: (timeSec: number) => void;
}

export function useSetLocatorShortcuts({ enabled = true, onJumpToLocator }: Options) {
  useEffect(() => {
    if (!enabled) return;

    const onKeyDown = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;

      const store = useSetLocatorStore.getState();

      if ((e.key === "k" || e.key === "K") && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        store.setKeyMapMode(!store.keyMapMode);
        return;
      }

      if (store.pendingKeyMapLocatorId && e.key.length === 1 && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        store.assignKeyBinding(store.pendingKeyMapLocatorId, e.key);
        return;
      }

      if (e.key === "Delete" || e.key === "Backspace") {
        if (!store.selectedId) return;
        e.preventDefault();
        store.removeLocator(store.selectedId);
        return;
      }

      if ((e.metaKey || e.ctrlKey) && (e.key === "r" || e.key === "R")) {
        if (!store.selectedId) return;
        e.preventDefault();
        store.setRenamingId(store.selectedId);
        return;
      }

      if (e.key === "[" || e.key === "]") {
        const dir = e.key === "]" ? 1 : -1;
        const next = store.adjacentLocator(store.selectedId, dir);
        if (!next) return;
        e.preventDefault();
        store.selectLocator(next.id);
        onJumpToLocator(next.timeSec);
        return;
      }

      const bound = store.locatorForKey(e.key);
      if (bound && !e.metaKey && !e.ctrlKey && !e.altKey) {
        e.preventDefault();
        store.selectLocator(bound.id);
        onJumpToLocator(bound.timeSec);
      }
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [enabled, onJumpToLocator]);
}
