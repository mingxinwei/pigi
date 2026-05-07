import { useState } from 'react';
import { IconStarFilled } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { CHAT_INPUT_MAX_WIDTH } from '../lib/layoutConstants';

interface StreamingQueueProps {
  isStreaming: boolean;
  queuedSteering: string[];
  queuedFollowUp: string[];
  onEditQueuedMessage: (type: 'steer' | 'followUp', index: number, newText: string) => void;
  onDequeue: () => void;
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

/** An editable queued message bar. */
function QueuedMessageBar({
  label,
  labelClassName,
  message,
  onEdit,
}: {
  label: string;
  labelClassName: string;
  message: string;
  onEdit: (newText: string) => void;
}): React.JSX.Element {
  const [editing, setEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const startEdit = (): void => {
    setEditing(true);
    setEditValue(message);
  };

  const confirmEdit = (): void => {
    if (editValue.trim()) {
      onEdit(editValue.trim());
    }
    setEditing(false);
  };

  const cancelEdit = (): void => {
    setEditing(false);
  };

  return (
    <QueueBar>
      <span className={cn('shrink-0 font-medium', labelClassName)}>{label}</span>
      {editing ? (
        <input
          type="text"
          className="flex-1 rounded border bg-background px-2 py-0.5 text-xs outline-none focus:ring-1 focus:ring-ring"
          value={editValue}
          onChange={(e) => setEditValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') confirmEdit();
            if (e.key === 'Escape') cancelEdit();
          }}
          autoFocus
        />
      ) : (
        <>
          <span className="flex-1 truncate">{message}</span>
          <button
            type="button"
            className="ml-auto shrink-0 text-muted-foreground/60 hover:text-foreground transition-colors"
            onClick={startEdit}
          >
            Edit
          </button>
        </>
      )}
    </QueueBar>
  );
}

export default function StreamingQueue({
  isStreaming,
  queuedSteering,
  queuedFollowUp,
  onEditQueuedMessage,
  onDequeue,
}: StreamingQueueProps): React.JSX.Element | null {
  if (!isStreaming) return null;

  const hasQueued = queuedSteering.length > 0 || queuedFollowUp.length > 0;

  // Build list of all bars with stable keys
  const bars: { key: string; node: React.ReactNode }[] = [];

  queuedSteering.forEach((msg, i) => {
    bars.push({
      key: `steer-${i}`,
      node: (
        <QueuedMessageBar
          label="Steer"
          labelClassName="text-yellow-600"
          message={msg}
          onEdit={(newText) => onEditQueuedMessage('steer', i, newText)}
        />
      ),
    });
  });

  queuedFollowUp.forEach((msg, i) => {
    bars.push({
      key: `followUp-${i}`,
      node: (
        <QueuedMessageBar
          label="Follow-up"
          labelClassName="text-blue-500"
          message={msg}
          onEdit={(newText) => onEditQueuedMessage('followUp', i, newText)}
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
        {hasQueued && (
          <button
            type="button"
            className="ml-auto text-muted-foreground/60 hover:text-foreground transition-colors"
            onClick={onDequeue}
          >
            Edit all
          </button>
        )}
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
