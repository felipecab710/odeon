/**
 * Mixxx-inspired transport + vinyl simulation for Pioneer booth.
 *
 * References:
 * - WSpinnyBase::calculateAngle (33⅓ RPM from play position)
 * - CueControl::updateIndicators (Pioneer cue/play LED state machine)
 * - ControlIndicator blink ratios (250 ms / 500 ms)
 */

/** Mixxx MIXXX_VINYL_SPEED_33_NUM */
export const VINYL_RPM_33 = 100 / 3;

export function vinylRotationsPerSecond(rpm = VINYL_RPM_33): number {
  return rpm / 60;
}

/** Mixxx WSpinnyBase::calculateAngle — degrees from local track position. */
export function vinylAngleFromPositionSec(
  localPosSec: number,
  rate = 1,
  rpm = VINYL_RPM_33,
): number {
  const angle = 360 * vinylRotationsPerSecond(rpm) * Math.max(0, localPosSec) * rate;
  return ((angle % 360) + 360) % 360;
}

export type TrackAt = "cue" | "elsewhere" | "end";

/** Mixxx CueControl::getTrackAt — 0.5 frame tolerance ≈ 11 µs; use ~30 ms for UI. */
export function getTrackAt(
  localPosSec: number,
  cueSec: number,
  durationSec: number,
  toleranceSec = 0.03,
): TrackAt {
  if (durationSec > 0 && localPosSec >= durationSec - 0.05) return "end";
  if (Math.abs(localPosSec - cueSec) <= toleranceSec) return "cue";
  return "elsewhere";
}

export type IndicatorBlink = "off" | "on" | "blink250" | "blink500";

export interface PioneerIndicators {
  play: IndicatorBlink;
  cue: IndicatorBlink;
}

/** Pioneer default cue mode — CueControl::updateIndicators + updatePlay. */
export function pioneerIndicators(opts: {
  isLoaded: boolean;
  deckPlaying: boolean;
  localPosSec: number;
  cueSec: number;
  durationSec: number;
}): PioneerIndicators {
  const { isLoaded, deckPlaying, localPosSec, cueSec, durationSec } = opts;
  if (!isLoaded) return { play: "off", cue: "off" };

  const trackAt = getTrackAt(localPosSec, cueSec, durationSec);

  if (deckPlaying) {
    return { play: "on", cue: "off" };
  }

  // Paused / stopped
  let play: IndicatorBlink = "blink500";
  let cue: IndicatorBlink = "off";

  switch (trackAt) {
    case "cue":
      cue = "on";
      play = "off";
      break;
    case "end":
      cue = "off";
      play = "off";
      break;
    case "elsewhere":
      cue = "blink250";
      play = "blink500";
      break;
  }

  return { play, cue };
}

export function indicatorToLit(state: IndicatorBlink, nowMs: number): boolean {
  switch (state) {
    case "on":
      return true;
    case "blink250":
      return Math.floor(nowMs / 250) % 2 === 0;
    case "blink500":
      return Math.floor(nowMs / 500) % 2 === 0;
    default:
      return false;
  }
}

export function firstCueSec(
  hotCueTimes: (number | null)[],
  hotCueSlots: boolean[],
): number {
  for (let i = 0; i < hotCueTimes.length; i++) {
    if (hotCueSlots[i] && hotCueTimes[i] != null) return hotCueTimes[i]!;
  }
  return 0;
}
