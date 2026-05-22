import { IconStarFilled } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { CHAT_INPUT_MAX_WIDTH } from '../lib/layoutConstants';

interface StreamingQueueProps {
  isStreaming: boolean;
  queuedSteering: string[];
  queuedFollowUp: string[];
  onEditQueuedMessage: (type: 'steer' | 'followUp', index: number) => void;
}

/**
 * A single bar that "grows out" from behind the element below it.
 * - rounded-t-2xl top corners
 * - pb-6 bottom padding (the lower portion is covered by the next element)
 * - z-[-1] relative to its sibling below
 */
function QueueBar({
  icon,
  children,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="rounded-t-2xl bg-muted px-4 pb-15 pt-2 text-xs text-muted-foreground">
      <div className="flex items-center gap-2">
        {icon}
        {children}
      </div>
    </div>
  );
}

/** A queued message bar with Edit button that moves message to ChatInput. */
function QueuedMessageBar({
  label,
  labelClassName,
  message,
  onEdit,
}: {
  label: string;
  labelClassName: string;
  message: string;
  onEdit: () => void;
}): React.JSX.Element {
  return (
    <QueueBar>
      <span className={cn('shrink-0 font-normal', labelClassName)}>{label}</span>
      <span className="flex-1 truncate">{message}</span>
      <button
        type="button"
        className="ml-auto shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
        onClick={onEdit}
      >
        Edit
      </button>
    </QueueBar>
  );
}

export default function StreamingQueue({
  isStreaming,
  queuedSteering,
  queuedFollowUp,
  onEditQueuedMessage,
}: StreamingQueueProps): React.JSX.Element | null {
  if (!isStreaming) return null;

  // Build list of all bars with stable keys
  const bars: { key: string; node: React.ReactNode }[] = [];

  queuedSteering.forEach((message, i) => {
    bars.push({
      key: `steer-${i}`,
      node: (
        <QueuedMessageBar
          label="Steer"
          labelClassName="text-yellow-600"
          message={message}
          onEdit={() => onEditQueuedMessage('steer', i)}
        />
      ),
    });
  });

  queuedFollowUp.forEach((message, i) => {
    bars.push({
      key: `followUp-${i}`,
      node: (
        <QueuedMessageBar
          label="Follow-up"
          labelClassName="text-blue-500"
          message={message}
          onEdit={() => onEditQueuedMessage('followUp', i)}
        />
      ),
    });
  });

  bars.push({
    key: 'working',
    node: (
      <QueueBar
        icon={
          <IconStarFilled className="size-4 animate-[spin_2s_linear_infinite] text-green-500" />
        }
      >
        <span>Working...</span>
      </QueueBar>
    ),
  });

  // Layout: each bar's pb-6 bottom is covered by the bar below (via -mt-5).
  // The whole queue ends with -mb-5 so ChatInput (relative z-10 bg-background)
  // covers the last bar's bottom — creating the "growing out from behind" effect.
  // Each bar is `relative` so later DOM elements naturally paint on top.
  return (
    <div className="shrink-0 -mb-14 px-8">
      <div className="mx-auto w-full" style={{ maxWidth: `${CHAT_INPUT_MAX_WIDTH}px` }}>
        {bars.map((bar, i) => (
          <div key={bar.key} className={cn('relative', i > 0 && '-mt-14')}>
            {bar.node}
          </div>
        ))}
      </div>
    </div>
  );
}
