/** Absolute overlay that sweeps a highlight across its (relative) parent, used for shimmer text effects */

/**
 * Sweep speed of the shimmer band, in px/s. Derived from the base 2.5s cycle
 * on a ~90px element: the band travels 2x element width per cycle (the
 * overlay span is 200% wide), so 2 * 90px / 2.5s = 72px/s.
 */
export const SHIMMER_SPEED_PX_PER_SECOND = 72;

interface ShimmerOverlayProps {
  /** Explicit cycle duration. Pass a width-derived value to keep the sweep at
   *  a constant px/s speed across element widths; defaults to the 2.5s class. */
  durationMs?: number;
}

export default function ShimmerOverlay({ durationMs }: ShimmerOverlayProps): React.JSX.Element {
  return (
    /* The span is 200% wide with the band centered in its gradient, and the
       .shimmer-overlay keyframes translate it -50% -> 50% of its own width —
       a transform-only sweep on the compositor (see main.css). */
    <span
      className="shimmer-overlay absolute top-0 left-0 h-full w-[200%]"
      style={{
        background:
          'linear-gradient(90deg, transparent 30%, rgba(255,255,255,0.95) 50%, transparent 70%)',
        animationDuration: durationMs !== undefined ? `${durationMs}ms` : undefined,
      }}
    />
  );
}
