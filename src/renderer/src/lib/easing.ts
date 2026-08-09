// Motion-curve tokens shared by the JS-driven rAF animations, so they match
// the CSS transitions (which reference the same curves as arbitrary Tailwind
// values). Two curves cover the two motion styles the app uses:
//
// - terminalEase: cubic-bezier(0.32, 0.72, 0, 1) — the terminal panel's
//   open/close drawer curve. Fast start, long soft tail; right for short
//   entrances/exits (collapses, panel toggles), wrong for slow long
//   movements where the tail reads as creeping.
// - terminalInOutEase: cubic-bezier(0.77, 0, 0.175, 1) — a strong
//   ease-in-out for on-screen movement (scrolling a viewport a long
//   distance): accelerates quickly, cruises, then settles with a short
//   deceleration instead of a long tail.

/** Inverts a cubic-bezier's x(t) to find t for the given progress, then
 *  evaluates y(t). x must be monotonic in t (true for 0 <= p1x, p2x <= 1). */
function sampleCubicBezier(
  p1x: number,
  p1y: number,
  p2x: number,
  p2y: number,
  progress: number,
): number {
  let lower = 0;
  let upper = 1;
  for (let i = 0; i < 14; i += 1) {
    const mid = (lower + upper) / 2;
    const x = 3 * p1x * mid * (1 - mid) ** 2 + 3 * p2x * mid ** 2 * (1 - mid) + mid ** 3;
    if (x < progress) lower = mid;
    else upper = mid;
  }
  const t = (lower + upper) / 2;
  return 3 * p1y * t * (1 - t) ** 2 + 3 * p2y * t ** 2 * (1 - t) + t ** 3;
}

/** The app-wide drawer curve: cubic-bezier(0.32, 0.72, 0, 1) — fast start,
 *  long soft tail (the terminal panel's open/close rhythm). */
export function terminalEase(progress: number): number {
  return sampleCubicBezier(0.32, 0.72, 0, 1, progress);
}

/** The on-screen movement curve: cubic-bezier(0.77, 0, 0.175, 1) — strong
 *  ease-in-out for long scrolls: quick acceleration, cruise, short settle. */
export function terminalInOutEase(progress: number): number {
  return sampleCubicBezier(0.77, 0, 0.175, 1, progress);
}
