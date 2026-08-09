// The app-wide motion curve: cubic-bezier(0.32, 0.72, 0, 1) — an
// accelerate-out curve that starts slow and speeds up (the terminal panel's
// open/close rhythm). CSS transitions reference it as an arbitrary Tailwind
// value (ease-[cubic-bezier(0.32,0.72,0,1)]); JS-driven rAF animations must
// use this exact same curve or the two motion styles drift apart and the
// animation feels linear next to the CSS ones.
export function terminalEase(progress: number): number {
  const p1x = 0.32;
  const p1y = 0.72;
  const p2x = 0;
  const p2y = 1;
  // The curve's x coordinate is monotonic in t (0 <= x <= 1), so binary
  // search inverts it to find the t whose x matches the progress, then
  // evaluates y at that t.
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
