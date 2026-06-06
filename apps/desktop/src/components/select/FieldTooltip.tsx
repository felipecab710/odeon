import { useState, useRef } from "react";
import { createPortal } from "react-dom";

export const FIELD_TOOLTIPS: Record<string, string> = {
  File:
    "The audio file name. Keeping files named clearly (artist – title – version) makes your library easier to navigate under pressure at a gig.",

  Status:
    "Shows where this track is in the analysis pipeline. Pending = not yet processed. Analyzing = running now. Ready = all data available. Error = something went wrong with the file (usually a corrupt or unsupported format).",

  Format:
    "Audio file container/codec (WAV, FLAC, MP3, etc.). Lossless formats (WAV, FLAC, AIFF) preserve full quality; compressed formats (MP3, M4A) trade file size for some fidelity.",

  Duration:
    "Total track length (minutes:seconds). Knowing this helps you plan mixes — a 6-minute track gives you more time to blend out of a previous track than a 3-minute edit.",

  BPM:
    "Beats per minute — the speed of the track. DJs use BPM to beatmatch: two tracks at the same BPM can be synced so their beats land together. Mixing tracks within ±4 BPM of each other usually sounds natural. Big jumps (e.g. 128 → 140) will feel jarring unless you do a full stop or transition.",

  Key:
    "The musical key tells you which notes and chords the track is built around (e.g. A minor, F# major). Mixing two tracks in the same key or a compatible key (like A min → C maj, which are relative) keeps the harmony smooth and avoids clashing notes. Mixing in incompatible keys can sound dissonant and off.",

  LUFS:
    "Integrated loudness — how loud the track actually sounds to a human ear, measured over the whole track. Streaming platforms (Spotify, Apple Music) normalize everything to around −14 LUFS, so overly loud masters get turned down. For club play, masters are typically −6 to −9 LUFS — louder feels more powerful on a system. If two tracks in your set have very different LUFS values, one will sound much quieter than the other when you mix them.",

  "Peak dB":
    "The single loudest sample in the file. 0 dB is the digital ceiling — anything at or above 0 dB is clipping (distorted). A true peak of −1 dBTP is the streaming standard. If this reads 0.0 or above, the file is likely clipping and will sound harsh on loud systems.",

  "RMS dB":
    "The average loudness of the track over time, without the psychoacoustic weighting of LUFS. A track at −8 RMS is louder and more compressed than one at −18 RMS. Very high RMS (close to 0) means the track has been heavily limited — less dynamic range, which can sound fatiguing over a long set.",

  Channels:
    "1 = mono (single channel, same signal in both speakers). 2 = stereo (separate left and right channels). Stereo tracks have width and space. Some older or DJ-edit tracks are mono — they'll sound narrower but can actually cut through a system more cleanly.",

  Rate:
    "Sample rate in Hz — how many audio samples are captured per second. 44,100 Hz (44.1 kHz) is CD quality and the most common for music. 48,000 Hz is standard for video and broadcast. Higher is not always better for DJ use — 44.1 kHz is perfectly sufficient and mismatched rates can cause subtle pitch artifacts if your audio interface doesn't handle conversion well.",
};

const TOOLTIP_WIDTH = 280;

export function FieldTooltip({ text, above = false }: { text: string; above?: boolean }) {
  const [coords, setCoords] = useState<{ x: number; y: number } | null>(null);
  const ref = useRef<HTMLSpanElement>(null);

  function handleMouseEnter() {
    if (!ref.current) return;
    const r = ref.current.getBoundingClientRect();
    const x = Math.min(r.left + r.width / 2 - TOOLTIP_WIDTH / 2, window.innerWidth - TOOLTIP_WIDTH - 8);
    const y = above ? r.top - 8 : r.bottom + 8;
    setCoords({ x: Math.max(8, x), y });
  }

  return (
    <span
      ref={ref}
      style={{ display: "inline-flex", alignItems: "center", marginLeft: 5, cursor: "default", flexShrink: 0 }}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={() => setCoords(null)}
    >
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          width: 13,
          height: 13,
          borderRadius: "50%",
          border: "1px solid #555",
          color: "#666",
          fontSize: 8,
          fontWeight: 700,
          lineHeight: 1,
          userSelect: "none",
          letterSpacing: 0,
          fontStyle: "normal",
        }}
      >
        i
      </span>
      {coords && createPortal(
        <span
          style={{
            position: "fixed",
            left: coords.x,
            ...(above
              ? { bottom: window.innerHeight - coords.y, top: "auto" }
              : { top: coords.y }),
            background: "#2c2c2c",
            border: "1px solid #3a3a3a",
            borderRadius: 5,
            color: "#bbb",
            fontSize: 11,
            lineHeight: 1.5,
            padding: "6px 10px",
            width: TOOLTIP_WIDTH,
            zIndex: 9999,
            pointerEvents: "none",
            whiteSpace: "normal",
            boxShadow: "0 4px 16px rgba(0,0,0,0.5)",
          }}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}
