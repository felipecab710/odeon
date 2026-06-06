import { PlaybackEngineDialog } from "../components/settings/PlaybackEngineDialog";
import { usePlaybackEngineStore } from "../stores/playbackEngineStore";
import { useEffect } from "react";

export function SettingsView() {
  const open = usePlaybackEngineStore((s) => s.open);

  // Auto-open the playback engine dialog when Settings view is navigated to
  useEffect(() => { open(); }, [open]);

  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 text-studio-text-faint">
      <span className="text-2xl opacity-30">⚙</span>
      <p className="text-sm">Settings</p>
      <PlaybackEngineDialog />
    </div>
  );
}
