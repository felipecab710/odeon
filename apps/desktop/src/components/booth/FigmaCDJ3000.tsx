/**
 * CDJ-3000X — pixel-perfect implementation from Figma node 392:2090.
 * Coordinates match Figma metadata exactly; screen region hosts live waveform overlay.
 */
import { useEffect, useMemo, useState } from "react";
import type { CatalogEntry } from "@odeon/shared";
import type { CDJDeckState } from "../../stores/boothStore";
import { apiClient } from "../../lib/apiClient";
import { loadWaveformCache } from "../../lib/waveformEngine/cacheLoader";
import type { WaveformCache } from "../../lib/waveformEngine/types";
import { CDJWaveformScreen } from "./CDJWaveformScreen";
import { FIGMA_CDJ, FIGMA_CDJ_SIZE } from "./figmaCdjAssets";

const HOT_CUE_LABELS = ["A", "B", "C", "D", "E", "F", "G", "H"] as const;

/** Figma pad face gradient — node 392:2351 */
const HOT_CUE_PAD_BG = `url("data:image/svg+xml;utf8,<svg viewBox='0 0 30 17' xmlns='http://www.w3.org/2000/svg' preserveAspectRatio='none'><g transform='matrix(1.25 1.2 -2.1176 2.2059 15.5 2)' opacity='1'><rect height='64.905' width='185.59' fill='url(%23grad)' id='quad' shape-rendering='crispEdges'/><use href='%23quad' transform='scale(1 -1)'/><use href='%23quad' transform='scale(-1 1)'/><use href='%23quad' transform='scale(-1 -1)'/></g><defs><linearGradient id='grad' gradientUnits='userSpaceOnUse' x2='5' y2='5'><stop stop-color='rgba(49,49,49,1)' offset='0.40632'/><stop stop-color='rgba(42,42,42,1)' offset='1'/></linearGradient></defs></svg>")`;

interface Props {
  deck: CDJDeckState;
  entry: CatalogEntry | null;
  interactive?: boolean;
  onCue?: () => void;
  onHotcue?: (slot: number, shift: boolean) => void;
}

function HotCuePad({
  label, active, interactive, onClick,
}: {
  label: string;
  active: boolean;
  interactive?: boolean;
  onClick?: (shift: boolean) => void;
}) {
  const ledOpacity = active ? 1 : 0.35;

  return (
    <button
      type="button"
      data-name="Cue"
      disabled={!interactive || !onClick}
      onClick={onClick ? (e) => onClick(e.shiftKey) : undefined}
      style={{
        background: "#121212", border: "none", borderRadius: 2,
        width: 32, height: 19, padding: 1, flexShrink: 0,
        cursor: interactive && onClick ? "pointer" : "default",
        display: "flex", flexDirection: "column", alignItems: "stretch",
      }}
    >
      <div style={{
        flex: 1, display: "flex", alignItems: "flex-end", justifyContent: "center",
        overflow: "hidden", borderRadius: 0.5, padding: "2px 0",
        backgroundImage: HOT_CUE_PAD_BG,
        backgroundSize: "100% 100%",
      }}>
        <div style={{
          display: "flex", flexDirection: "column", gap: 1,
          alignItems: "flex-start", justifyContent: "flex-end", height: "100%",
        }}>
          <div style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center" }}>
            <span style={{
              fontSize: 4, fontWeight: 800, color: "#24daf5",
              lineHeight: 1, opacity: active ? 1 : 0.6,
            }}>
              {label}
            </span>
          </div>
          <div style={{
            width: 23, height: 1, background: "#00c8ea",
            opacity: ledOpacity,
            boxShadow: active ? "0 0 4px #00c8ea" : undefined,
          }} />
        </div>
      </div>
    </button>
  );
}

function FigmaHotCueRow({
  slots, interactive, onHotcue,
}: {
  slots: boolean[];
  interactive?: boolean;
  onHotcue?: (slot: number, shift: boolean) => void;
}) {
  return (
    <div
      data-node-id="392:2344"
      style={{
        position: "absolute", left: 87, top: 179,
        width: 323.2, height: 57,
        display: "flex", flexDirection: "column", gap: 1, alignItems: "center",
      }}
    >
      {/* Frame 43 — HOT CUE label + dividers */}
      <div
        data-node-id="392:2345"
        style={{
          display: "flex", alignItems: "center", width: "100%", height: 6,
        }}
      >
        <div style={{ flex: 1, height: 1, background: "#d8d7da", minWidth: 1 }} />
        <span style={{
          fontSize: 5, fontWeight: 700, color: "#d4d4d4",
          textAlign: "center", width: 29, flexShrink: 0,
        }}>
          HOT CUE
        </span>
        <div style={{ flex: 1, height: 1, background: "#d8d7da", minWidth: 1 }} />
      </div>

      {/* Frame 42 — A–H pads */}
      <div
        data-node-id="392:2349"
        style={{ display: "flex", gap: 9.6, alignItems: "center", height: 19 }}
      >
        {HOT_CUE_LABELS.map((label, i) => (
          <HotCuePad
            key={label}
            label={label}
            active={slots[i] ?? false}
            interactive={interactive}
            onClick={onHotcue ? (shift) => onHotcue(i, shift) : undefined}
          />
        ))}
      </div>
    </div>
  );
}

/** Metallic search pill — << when rewind, >> when forward (Figma 392:2104 / 392:2111) */
function SearchPill({ rewind }: { rewind?: boolean }) {
  const a1 = rewind ? 10.14 : 6.52;
  const a2 = rewind ? 6.52 : 10.14;
  return (
    <div style={{ position: "relative", width: 23.91, height: 23.91, flexShrink: 0 }}>
      <img src={FIGMA_CDJ.ellipse8} alt="" style={{ position: "absolute", inset: 0, width: "100%", height: "100%" }} />
      <img src={FIGMA_CDJ.ellipse9} alt="" style={{ position: "absolute", left: 1.91, top: 1.91, width: 20.09, height: 20.09 }} />
      <img src={FIGMA_CDJ.ellipse10} alt="" style={{ position: "absolute", left: 2.39, top: 2.39, width: 19.13, height: 19.13 }} />
      <div style={{
        position: "absolute", left: a1, top: 8.7, width: 7.25, height: 6.04,
        transform: rewind ? "rotate(180deg)" : undefined,
        background: `url(${FIGMA_CDJ.playIcon}) center/contain no-repeat`,
        filter: "invert(1) opacity(0.7)",
      }} />
      <div style={{
        position: "absolute", left: a2, top: 8.7, width: 7.25, height: 6.04,
        transform: rewind ? "rotate(180deg)" : undefined,
        background: `url(${FIGMA_CDJ.playIcon}) center/contain no-repeat`,
        filter: "invert(1) opacity(0.7)",
      }} />
    </div>
  );
}

function LoopCueBtn() {
  return (
    <div style={{
      background: "#43423f", border: "1px solid #0d0c0c", borderRadius: 50,
      padding: 2, display: "flex", alignItems: "center", width: 25,
    }}>
      <div style={{ position: "relative", width: 21, height: 21 }}>
        <img src={FIGMA_CDJ.cueRing} alt="" style={{ width: "100%", height: "100%" }} />
      </div>
    </div>
  );
}

export function FigmaCDJ3000({ deck, entry, interactive, onCue, onHotcue }: Props) {
  const [cache, setCache] = useState<WaveformCache | null>(null);
  const dur = cache?.duration_seconds || deck.durationSec || 0;

  useEffect(() => {
    if (!entry?.file_path) { setCache(null); return; }
    loadWaveformCache(entry.file_path).then(setCache).catch(() => setCache(null));
  }, [entry?.file_path]);

  const cueLit = deck.cueLit || !interactive;
  const playLit = deck.playLit || !interactive;

  const artworkUrl = useMemo(
    () => (entry?.has_artwork && entry?.id ? apiClient.select.artworkUrl(entry.id) : null),
    [entry?.id, entry?.has_artwork],
  );

  // Tempo fader cap: center = 0%, top = -100%, bottom = +100%
  const pitchNorm = Math.max(-1, Math.min(1, deck.pitchPercent / 100));
  const faderCapTop = 16 + (74 - 74 * pitchNorm);

  return (
    <div
      data-node-id="392:2090"
      style={{
        position: "relative",
        width: FIGMA_CDJ_SIZE.width,
        height: FIGMA_CDJ_SIZE.height,
        background: "#363636",
        paddingBottom: 8,
        flexShrink: 0,
        overflow: "visible",
        fontFamily: "Inter, system-ui, sans-serif",
      }}
    >
      {/* Rectangle 9 — faceplate 392:49 */}
      <div
        data-node-id="392:49"
        style={{
          position: "absolute", left: 0, top: -5,
          width: 485, height: 595, borderRadius: 2.5,
          border: "1px solid rgba(121,121,121,0.2)",
          background: "linear-gradient(155.601deg, rgb(50,50,52) 5.9553%, rgb(27,27,27) 44.272%)",
          pointerEvents: "none",
        }}
      />

      {/* Frame 35 — screen bezel 392:2211 */}
      <div
        data-node-id="392:2211"
        style={{
          position: "absolute", left: 81, top: -64,
          width: 340, height: 235,
          background: "#1e1e1e", border: "1px solid #151515",
          padding: "6px 10px", boxSizing: "border-box",
          overflow: "hidden",
        }}
      >
        {/* Rectangle 10 — screen placeholder gradient 392:2209 */}
        <div
          data-node-id="392:2209"
          style={{
            position: "absolute", left: 10, top: 6, width: 320, height: 223,
            backgroundImage: [
              "linear-gradient(-34.1389deg, rgba(0,0,0,0.5) 68.409%, rgba(102,102,102,0.5) 165.64%)",
              "linear-gradient(-64.799deg, rgba(0,0,0,0.2) 69.158%, rgba(102,102,102,0.2) 69.435%)",
              "linear-gradient(90deg, rgb(0,0,0) 0%, rgb(0,0,0) 100%)",
            ].join(", "),
            pointerEvents: "none",
          }}
        />

        {/* Live CDJ-3000 screen */}
        <div style={{ position: "relative", width: 320, height: 223, zIndex: 1 }}>
          {cache && deck.isLoaded ? (
            <CDJWaveformScreen
              cache={cache}
              entry={entry}
              positionSec={deck.positionSec}
              durationSec={dur}
              isPlaying={deck.isPlaying}
              deckIndex={deck.deckIndex}
              title={deck.title}
              pitchPercent={deck.pitchPercent}
              bpm={deck.bpm}
              key={deck.key}
              hotCueSlots={deck.hotCueSlots}
              hotCueTimes={deck.hotCueTimes}
            />
          ) : (
            <div style={{
              position: "absolute", inset: 0, display: "flex",
              alignItems: "center", justifyContent: "center",
              color: "#555", fontSize: 9, background: "#000",
            }}>
              {deck.isLoaded ? "Loading…" : "No Track"}
            </div>
          )}
        </div>
      </div>

      {/* Hot Cue — 392:2344 */}
      <FigmaHotCueRow
        slots={deck.hotCueSlots}
        interactive={interactive}
        onHotcue={onHotcue}
      />

      {/* Disk — jog wheel 392:2206 */}
      <div
        data-node-id="392:2206"
        style={{
          position: "absolute", left: 98, top: 242, width: 309, height: 309,
          padding: "35px 34px", boxSizing: "border-box",
        }}
      >
        <img src={FIGMA_CDJ.diskOuter} alt="" style={{
          position: "absolute", left: 0, top: 0, width: 309, height: 309,
          transform: `rotate(${deck.jogAngle}deg)`,
          transformOrigin: "center center",
        }} />
        <img src={FIGMA_CDJ.ellipse11} alt="" style={{
          position: "absolute", left: 34, top: 35, width: 239, height: 239,
        }} />
        <div
          data-node-id="392:2227"
          style={{
            position: "absolute", left: 102, top: 102, width: 97, height: 97,
            padding: "12px 12px 13px 13px", boxSizing: "border-box", borderRadius: 48.5,
            background: "#222",
            boxShadow: "inset 0px 1px 4px 0px rgba(0,0,0,0.8)",
            overflow: "hidden",
          }}
        >
          {/* Dynamic cover art — 392:2230 (replaces static ellipse14) */}
          {artworkUrl ? (
            <img
              key={entry?.id}
              src={artworkUrl}
              alt=""
              style={{
                position: "absolute", left: 24, top: 24, width: 49, height: 49,
                borderRadius: "50%", objectFit: "cover", display: "block",
              }}
            />
          ) : (
            <div style={{
              position: "absolute", left: 24, top: 24, width: 49, height: 49,
              borderRadius: "50%",
              background: "radial-gradient(circle at 35% 30%, #3a3a3a 0%, #111 70%)",
            }} />
          )}
          <img src={FIGMA_CDJ.ellipse13} alt="" style={{
            position: "absolute", left: 20, top: 20, width: 57, height: 57,
            pointerEvents: "none",
          }} />
          <img src={FIGMA_CDJ.ellipse12} alt="" style={{
            position: "absolute", left: 13, top: 12, width: 72, height: 72,
            pointerEvents: "none",
          }} />
        </div>
      </div>

      {/* Fader — tempo slider 392:2218 */}
      <div
        data-node-id="392:2218"
        style={{
          position: "absolute", left: 425, top: 385, width: 37, height: 181,
          padding: 2, borderRadius: 4, background: "#2c2c2c", pointerEvents: "none",
        }}
      >
        <div style={{
          width: 33, height: 179, borderRadius: 4, background: "#282828",
          boxShadow: "inset 0px 4px 4px 0px rgba(0,0,0,0.6)",
          position: "relative",
        }}>
          <div
            data-node-id="392:2220"
            style={{
              position: "absolute", left: 17, top: 16, width: 3, height: 149,
              background: "#313131", boxShadow: "inset 0px 0px 8px 0px rgba(0,0,0,0.8)",
            }}
          />
          <div style={{
            position: "absolute", left: 12, top: faderCapTop, width: 9, height: 14,
            borderRadius: 2, background: "linear-gradient(180deg, #555 0%, #2a2a2a 100%)",
            boxShadow: "0 1px 2px rgba(0,0,0,0.8)",
          }} />
        </div>
      </div>

      {/* IN/CUE — 392:2183 */}
      <div style={{
        position: "absolute", left: 12, top: 210, width: 25,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
      }}>
        <span style={{ fontSize: 4.5, color: "#d4d4d4", fontWeight: 500, textAlign: "center", width: "100%" }}>IN/CUE</span>
        <LoopCueBtn />
      </div>

      {/* OUT — 392:2182 */}
      <div style={{
        position: "absolute", left: 47, top: 210, width: 25,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 1,
      }}>
        <span style={{ fontSize: 4.5, color: "#d4d4d4", fontWeight: 500, textAlign: "center", width: "100%" }}>OUT</span>
        <LoopCueBtn />
      </div>

      {/* Line 4 — 392:2189 */}
      <img src={FIGMA_CDJ.line4} alt="" style={{ position: "absolute", left: 39, top: 228, width: 7, height: 1 }} />

      {/* TRACK SEARCH — 392:2144 */}
      <div style={{
        position: "absolute", left: 14, top: 380, width: 52,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      }}>
        <span style={{ fontSize: 4.5, color: "#d4d4d4", fontWeight: 500, whiteSpace: "nowrap" }}>TRACK SEARCH</span>
        <div style={{
          width: 52, height: 25, borderRadius: 80, border: "0.5px solid #181818",
          padding: 1, background: "#3c3c3c", boxShadow: "inset 0px 0px 8px 0px rgba(0,0,0,0.8)",
        }}>
          <div style={{
            display: "flex", gap: 3, width: 50, height: 23, borderRadius: 80,
            background: "#262626", border: "1px solid #161616", alignItems: "center", overflow: "hidden",
          }}>
            <SearchPill rewind />
            <SearchPill />
          </div>
        </div>
      </div>

      {/* SEARCH — 392:2143 */}
      <div style={{
        position: "absolute", left: 15, top: 418, width: 52,
        display: "flex", flexDirection: "column", alignItems: "center", gap: 2,
      }}>
        <span style={{ fontSize: 4.5, color: "#d4d4d4", fontWeight: 500, textAlign: "center", width: "100%" }}>SEARCH</span>
        <div style={{
          width: 52, height: 25, borderRadius: 80, border: "0.5px solid #181818",
          padding: 1, background: "#3c3c3c", boxShadow: "inset 0px 0px 8px 0px rgba(0,0,0,0.8)",
        }}>
          <div style={{
            display: "flex", gap: 3, width: 50, height: 23, borderRadius: 80,
            background: "#262626", border: "1px solid #161616", alignItems: "center", overflow: "hidden",
          }}>
            <SearchPill rewind />
            <SearchPill />
          </div>
        </div>
      </div>

      {/* CUE button — 392:2095 */}
      <button
        type="button"
        data-node-id="392:2095"
        onClick={interactive ? onCue : undefined}
        style={{
          position: "absolute", left: 17, top: 464, width: 50, height: 50,
          padding: 3, borderRadius: 25, border: "none", cursor: interactive ? "pointer" : "default",
          background: "transparent",
          boxShadow: "inset 0px 0px 5px 0px rgba(91,46,0,0.6)",
        }}
      >
        <div aria-hidden style={{
          position: "absolute", inset: 0, borderRadius: 25,
          background: cueLit ? "#ffc200" : "#3c3c3c", pointerEvents: "none",
        }} />
        <img src={FIGMA_CDJ.ellipse5} alt="" style={{ position: "absolute", left: 3, top: 3, width: 44, height: 44 }} />
        <img src={FIGMA_CDJ.ellipse6} alt="" style={{ position: "absolute", left: 4, top: 4, width: 42, height: 42 }} />
        <img src={FIGMA_CDJ.ellipse7} alt="" style={{ position: "absolute", left: 5, top: 5, width: 40, height: 40 }} />
        <span style={{
          position: "absolute", left: 19, top: 21, fontSize: 6, fontWeight: 500,
          color: "#d9d9d7",
        }}>
          CUE
        </span>
      </button>

      {/* PLAY/PAUSE — 392:2147 */}
      <div
        data-node-id="392:2147"
        style={{
          position: "absolute", left: 18, top: 528, width: 50, height: 50,
          padding: 3, borderRadius: 25,
          boxShadow: "inset 0px 0px 5px 0px rgba(91,46,0,0.6)",
        }}
      >
        <div aria-hidden style={{
          position: "absolute", inset: 0, borderRadius: 25,
          background: playLit ? "#00ff73" : "#3c3c3c", pointerEvents: "none",
        }} />
        <img src={FIGMA_CDJ.ellipse5} alt="" style={{ position: "absolute", left: 3, top: 3, width: 44, height: 44 }} />
        <img src={FIGMA_CDJ.ellipse6} alt="" style={{ position: "absolute", left: 4, top: 4, width: 42, height: 42 }} />
        <img src={FIGMA_CDJ.ellipse7} alt="" style={{ position: "absolute", left: 5, top: 5, width: 40, height: 40 }} />
        <img src={FIGMA_CDJ.playIcon} alt="" style={{
          position: "absolute", left: 14, top: 21, width: 12, height: 9,
        }} />
        <img src={FIGMA_CDJ.pauseIcon} alt="" style={{
          position: "absolute", left: 25, top: 22, width: 9, height: 7,
        }} />
      </div>
    </div>
  );
}
