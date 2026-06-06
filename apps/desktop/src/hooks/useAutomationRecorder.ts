/**
 * Record mode — writes mix knob/fader moves as automation keyframes while playing.
 */
import { useEffect } from "react";
import { useTransportStore } from "../stores/transportStore";
import { useStudioDeckStore } from "../stores/studioDeckStore";
import { useStudioAutomationStore } from "../stores/studioAutomationStore";
import { getMixParamValue, mixValueToNorm } from "../lib/automationMath";

const RECORD_INTERVAL_MS = 60;

function sampleArmedTracks() {
  const { isPlaying, positionSeconds } = useTransportStore.getState();
  const { isRecording, editMode, tracks } = useStudioAutomationStore.getState();
  if (!isPlaying || !isRecording || editMode !== "record") return;

  const mixes = useStudioDeckStore.getState().mixes;
  const upsert = useStudioAutomationStore.getState().upsertKeyframe;

  for (const [idxStr, track] of Object.entries(tracks)) {
    if (!track.armed) continue;
    const laneIndex = Number(idxStr);
    const mix = mixes[laneIndex];
    if (!mix) continue;

    for (const param of track.lanes) {
      const value = getMixParamValue(mix, param);
      const norm = mixValueToNorm(param, value);
      upsert(laneIndex, param, positionSeconds, norm);
    }
  }
}

export function useAutomationRecorder(enabled: boolean) {
  useEffect(() => {
    if (!enabled) return;

    const id = setInterval(sampleArmedTracks, RECORD_INTERVAL_MS);
    const unsubMix = useStudioDeckStore.subscribe(sampleArmedTracks);
    return () => {
      clearInterval(id);
      unsubMix();
    };
  }, [enabled]);
}
