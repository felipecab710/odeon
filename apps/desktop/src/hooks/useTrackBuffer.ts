import { useEffect, useState } from "react";
import { webAudioEngine } from "../lib/webAudioEngine";

export function useTrackBuffer(trackId: string): AudioBuffer | null {
  const [buffer, setBuffer] = useState<AudioBuffer | null>(
    () => webAudioEngine.getBuffer(trackId),
  );

  useEffect(() => {
    setBuffer(webAudioEngine.getBuffer(trackId));
    return webAudioEngine.onBufferChange(() => {
      setBuffer(webAudioEngine.getBuffer(trackId));
    });
  }, [trackId]);

  return buffer;
}
