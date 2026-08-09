import { useLayoutEffect, useRef, useState } from 'react';

/**
 * Sweep speed of the shimmer band, in px/s. The band travels its own width
 * plus the text width per cycle (enter + sweep + exit), so on a ~90px element
 * with a 100px band that is 190px per cycle; the base 2.5s class duration
 * yields 76px/s — close to the previous 72px/s reference.
 */
export const SHIMMER_SPEED_PX_PER_SECOND = 72;

/** Fixed band width: the highlight stays a narrow, focused strip no matter
 *  how long the command line is. */
export const SHIMMER_BAND_WIDTH_PX = 100;

interface ShimmerOverlayProps {
  /** Explicit cycle duration. Pass a width-derived value to keep the sweep at
   *  a constant px/s speed across element widths; defaults to the 2.5s class. */
  durationMs?: number;
}

export default function ShimmerOverlay({ durationMs }: ShimmerOverlayProps): React.JSX.Element {
  const overlayRef = useRef<HTMLSpanElement>(null);
  const [scanWidth, setScanWidth] = useState(0);
  // The band only starts once the scan width has been measured. Until then
  // animation-name is pinned to 'none'; flipping it back to the class
  // animation restarts it from the beginning — so a freshly shown row's
  // sweep always starts at the left edge instead of joining a cycle that
  // began while the element had zero width.
  const [measured, setMeasured] = useState(false);

  // The band sweeps only the text it labels: measure the parent (the text
  // span it is placed inside), so truncated long commands do not waste the
  // sweep on invisible areas. The CSS variables drive this element's own
  // keyframes (--shimmer-scan-width), not a child's transform.
  useLayoutEffect(() => {
    const parent = overlayRef.current?.parentElement;
    if (!parent) return;
    const update = (): void => {
      const width = parent.clientWidth;
      setScanWidth(width);
      if (width > 0) setMeasured(true);
    };
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(parent);
    return () => resizeObserver.disconnect();
  }, []);

  // Custom CSS properties need a cast (React does not type them).
  const style = {
    width: `${SHIMMER_BAND_WIDTH_PX}px`,
    background: 'linear-gradient(90deg, transparent, rgba(255,255,255,0.95) 50%, transparent)',
    '--shimmer-band-width': `${SHIMMER_BAND_WIDTH_PX}px`,
    '--shimmer-scan-width': `${scanWidth}px`,
    animationDuration: durationMs !== undefined ? `${durationMs}ms` : undefined,
    // undefined = the class animation applies; 'none' = hold until measured.
    animationName: measured ? undefined : 'none',
  } as React.CSSProperties;

  return (
    /* The band itself: a fixed-width strip that the .shimmer-overlay keyframes
       translate from its own width left of the text to the measured text
       width (enter -> sweep -> exit), transform-only on the compositor. */
    <span ref={overlayRef} className="shimmer-overlay absolute top-0 left-0 h-full" style={style} />
  );
}
