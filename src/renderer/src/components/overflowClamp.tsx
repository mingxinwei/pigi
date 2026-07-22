import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { cn } from '../lib/utils';

/** Fade applied at the top edge where tail-anchored content is clipped */
const TAIL_FADE_MASK = 'linear-gradient(to bottom, transparent, black 16px)';

/**
 * Clamps tall content to `maxHeight`, keeping the LAST lines visible instead
 * of the first: content sits in a flex column anchored to the bottom
 * (`justify-end`), so overflow is clipped at the top where a fade mask
 * softens the cut. Pure CSS — no JS slicing, streaming-friendly.
 *
 * The Show more/less toggle is a sticky pill: while scrolling through long
 * expanded content it hovers above the bottom of the scrollport, and settles
 * into its natural place at the end of the block. Sticky requires that no
 * ancestor between this component and the scroll container has
 * `overflow: hidden/auto/scroll` — use `overflow: clip` where visual
 * clipping (e.g. rounded corners) is needed.
 */
export default function OverflowClamp({
  maxHeight,
  children,
  className,
  contentStyle,
  buttonClassName,
}: {
  /** Max visible height in px while collapsed */
  maxHeight: number;
  children: React.ReactNode;
  /** Extra classes for the clamped content wrapper */
  className?: string;
  /** Extra inline styles for the clamped content wrapper */
  contentStyle?: React.CSSProperties;
  /** Extra classes for the Show more/less button */
  buttonClassName?: string;
}): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const [isStuck, setIsStuck] = useState(false);
  const innerRef = useRef<HTMLDivElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);
  const sentinelRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const inner = innerRef.current;
    if (!inner) return;
    const measure = (): void => setIsOverflowing(inner.offsetHeight > maxHeight);
    // Measure synchronously — RO delivery is tied to rendering frames and is
    // not guaranteed to fire promptly (e.g. occluded window).
    measure();
    // inner grows with streamed content even while the outer box is clamped
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [maxHeight]);

  // Detect whether the sticky button is floated away from its natural
  // position (marked by the sentinel) so it can get a frosted background.
  useEffect(() => {
    if (!isOverflowing) return;
    const button = buttonRef.current;
    const sentinel = sentinelRef.current;
    if (!button || !sentinel) return;

    let raf = 0;
    const check = (): void => {
      // When stuck, the button is pulled down by sticky positioning,
      // creating a gap between the sentinel (natural position) and the button
      setIsStuck(button.getBoundingClientRect().top - sentinel.getBoundingClientRect().bottom > 8);
    };
    const scheduleCheck = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    scheduleCheck();
    // capture: scroll events don't bubble, this observes any scrollable ancestor
    window.addEventListener('scroll', scheduleCheck, { capture: true, passive: true });
    window.addEventListener('resize', scheduleCheck);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', scheduleCheck, { capture: true });
      window.removeEventListener('resize', scheduleCheck);
    };
  }, [isOverflowing, expanded]);

  const clamped = !expanded && isOverflowing;

  return (
    <>
      {isOverflowing && (
        <>
          {/* marks the button's natural position for stuck detection */}
          <div ref={sentinelRef} aria-hidden className="h-0" />
          <button
            ref={buttonRef}
            type="button"
            data-action="expand-overflow" // search auto-expand relies on this attr
            onClick={() => setExpanded((current) => !current)}
            className={cn(
              'sticky bottom-4 z-10 mb-1 flex w-fit items-center gap-1 rounded-full py-0.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground',
              isStuck && 'bg-background/70 shadow-sm backdrop-blur-sm',
              buttonClassName,
            )}
          >
            {expanded ? (
              <>
                Show less
                <IconChevronDown className="size-4" />
              </>
            ) : (
              <>
                Show more
                <IconChevronUp className="size-4" />
              </>
            )}
          </button>
        </>
      )}
      <div
        className={cn('flex flex-col justify-end overflow-hidden', className)}
        style={{
          ...contentStyle,
          // inline max-height is required: message search auto-expand
          // locates this element via '[style*="max-height"]'
          maxHeight: expanded ? undefined : maxHeight,
          maskImage: clamped ? TAIL_FADE_MASK : undefined,
          WebkitMaskImage: clamped ? TAIL_FADE_MASK : undefined,
        }}
      >
        <div ref={innerRef} className="flow-root shrink-0">
          {children}
        </div>
      </div>
    </>
  );
}
