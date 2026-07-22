import { useEffect, useState } from 'react';
import OverflowClamp from './overflowClamp';
import { cn } from '../lib/utils';

/**
 * Format a thinking duration: sub-second as `0.x s`, seconds under a
 * minute, `m ss` under an hour, `h mm` beyond that.
 */
function formatThinkingDuration(durationMs: number): string {
  if (durationMs < 1000) {
    const seconds = durationMs / 1000;
    return `${seconds.toFixed(1)}s`;
  }
  const totalSeconds = Math.floor(durationMs / 1000);
  if (totalSeconds < 60) {
    return `${totalSeconds}s`;
  }
  const totalMinutes = Math.floor(totalSeconds / 60);
  const seconds = String(totalSeconds % 60).padStart(2, '0');
  if (totalMinutes < 60) {
    return `${totalMinutes}m ${seconds}s`;
  }
  const hours = Math.floor(totalMinutes / 60);
  const minutes = String(totalMinutes % 60).padStart(2, '0');
  return `${hours}h ${minutes}m`;
}

interface ThinkingTimingProps {
  /** Timestamp of the first thinking delta (undefined for replayed history) */
  startedAt?: number;
  /** Timestamp when thinking ended (undefined while still thinking) */
  endedAt?: number;
  isStreaming?: boolean;
}

/** Live-ticking thinking duration. Renders nothing when timing is unknown. */
export function ThinkingDuration({
  startedAt,
  endedAt,
  isStreaming,
  className,
}: ThinkingTimingProps & { className?: string }): React.JSX.Element | null {
  const inProgress = startedAt !== undefined && endedAt === undefined && isStreaming === true;
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!inProgress) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [inProgress]);

  if (startedAt === undefined) return null;
  const endMs = endedAt ?? (inProgress ? now : undefined);
  if (endMs === undefined) return null;

  return (
    <span className={cn('tabular-nums', className)}>
      {formatThinkingDuration(endMs - startedAt)}
    </span>
  );
}

export default function ThinkingBlock({
  text,
  startedAt,
  endedAt,
  isStreaming,
}: {
  text: string;
} & ThinkingTimingProps): React.JSX.Element {
  return (
    <div className="rounded-md bg-muted/70 px-3 py-1.5 text-muted-foreground">
      <div className="flex items-center justify-between gap-2 text-[13px] font-medium">
        <span data-search-ignore>Thinking</span>
        <ThinkingDuration
          startedAt={startedAt}
          endedAt={endedAt}
          isStreaming={isStreaming}
          className="font-normal"
        />
      </div>
      <OverflowClamp maxHeight={120}>
        <pre className="whitespace-pre-wrap break-words font-sans text-[14px] leading-5 text-muted-foreground">
          {text}
        </pre>
      </OverflowClamp>
    </div>
  );
}
