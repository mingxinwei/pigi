import { useEffect, useRef, useState } from 'react';
import { IconChevronDown, IconChevronUp } from '@tabler/icons-react';
import { cn } from '../lib/utils';

/** Fade at the top for tail-anchored (streaming) content */
const TOP_FADE_MASK = 'linear-gradient(to bottom, transparent, black 16px)';
/** Fade at the bottom for top-anchored (static) content */
const BOTTOM_FADE_MASK = 'linear-gradient(to top, transparent, black 16px)';

/**
 * Clamps tall content to `maxHeight`.
 *
 * In tail-anchor mode (default), the LAST lines stay visible — useful for
 * streaming tool output where new content appears at the bottom. The Show
 * more/less button sits above the clamped area.
 *
 * In top-anchor mode (`tailAnchor={false}`), the FIRST lines stay visible —
 * useful for user messages. The button sits below the clamped area.
 */
export default function OverflowClamp({
  maxHeight,
  children,
  className,
  contentStyle,
  buttonClassName,
  tailAnchor = false,
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
  /** When true (default), content is bottom-aligned and clipped at the top.
   *  When false, content is top-aligned and clipped at the bottom. */
  tailAnchor?: boolean;
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
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(inner);
    return () => observer.disconnect();
  }, [maxHeight]);

  // Detect whether the sticky button is floated from its natural position
  useEffect(() => {
    if (!isOverflowing || !tailAnchor) return;
    const button = buttonRef.current;
    const sentinel = sentinelRef.current;
    if (!button || !sentinel) return;

    let raf = 0;
    const check = (): void => {
      setIsStuck(button.getBoundingClientRect().top - sentinel.getBoundingClientRect().bottom > 8);
    };
    const scheduleCheck = (): void => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(check);
    };
    scheduleCheck();
    window.addEventListener('scroll', scheduleCheck, { capture: true, passive: true });
    window.addEventListener('resize', scheduleCheck);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('scroll', scheduleCheck, { capture: true });
      window.removeEventListener('resize', scheduleCheck);
    };
  }, [isOverflowing, expanded, tailAnchor]);

  const clamped = !expanded && isOverflowing;

  const fadeMask = tailAnchor ? TOP_FADE_MASK : BOTTOM_FADE_MASK;

  const buttonNode = isOverflowing && (
    <>
      <div ref={sentinelRef} aria-hidden className="h-0" />
      <button
        ref={buttonRef}
        type="button"
        data-action="expand-overflow"
        onClick={() => setExpanded((current) => !current)}
        className={cn(
          'z-10 mb-0 flex w-fit items-center gap-1 rounded-full py-0.5 text-[14px] text-muted-foreground transition-colors hover:text-foreground',
          tailAnchor && 'sticky bottom-4',
          isStuck && tailAnchor && 'bg-background/70 shadow-sm backdrop-blur-sm',
          buttonClassName,
        )}
      >
        {expanded ? (
          <>
            Show less
            {tailAnchor ? (
              <IconChevronDown className="size-4" />
            ) : (
              <IconChevronUp className="size-4" />
            )}
          </>
        ) : (
          <>
            Show more
            {tailAnchor ? (
              <IconChevronUp className="size-4" />
            ) : (
              <IconChevronDown className="size-4" />
            )}
          </>
        )}
      </button>
    </>
  );

  const contentNode = (
    <div
      className={cn(
        'flex flex-col overflow-hidden',
        tailAnchor ? 'justify-end' : 'justify-start',
        className,
      )}
      style={{
        ...contentStyle,
        maxHeight: expanded ? undefined : maxHeight,
        maskImage: clamped ? fadeMask : undefined,
        WebkitMaskImage: clamped ? fadeMask : undefined,
      }}
    >
      <div ref={innerRef} className="flow-root shrink-0">
        {children}
      </div>
    </div>
  );

  return <>{tailAnchor ? [buttonNode, contentNode] : [contentNode, buttonNode]}</>;
}
