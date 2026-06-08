import { useEffect } from "react";
import { useNavigationStore } from "../stores/navigationStore";
import { useTransportStore } from "../stores/transportStore";
import { toggleSelectPlayback } from "../lib/useSelectEngineSync";

function isTypingTarget(el: EventTarget | null): boolean {
  if (!(el instanceof HTMLElement)) return false;
  if (el.isContentEditable) return true;
  const tag = el.tagName;
  return tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT";
}

/** Global transport shortcuts — capture phase so scroll areas don't eat Space. */
export function useTransportShortcuts() {
  const togglePlayPause = useTransportStore((s) => s.togglePlayPause);

  useEffect(() => {
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.code !== "Space" && e.key !== " ") return;
      if (e.repeat) return;
      if (isTypingTarget(e.target)) return;
      e.preventDefault();
      e.stopPropagation();
      if (useNavigationStore.getState().view === "select") {
        void toggleSelectPlayback();
        return;
      }
      void togglePlayPause();
    };

    window.addEventListener("keydown", onKeyDown, true);
    return () => window.removeEventListener("keydown", onKeyDown, true);
  }, [togglePlayPause]);
}
