import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { IconChevronUp, IconChevronDown, IconX, IconSearch } from '@tabler/icons-react';
import { Popover, PopoverContent, PopoverAnchor } from './ui/popover';
import { Input } from './ui/input';

export interface MessageSearchTarget {
  renderIndex: number;
  itemId: string;
  role: 'user' | 'assistant' | 'tool' | 'system';
  groupId?: string;
  toolNodeId?: string;
  text: string;
  meta: string;
  preview: string;
}

interface MessageSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: MessageSearchTarget[];
  onJump: (target: MessageSearchTarget) => void;
  query: string;
  onQueryChange: (query: string) => void;
}

export default function MessageSearch({
  open,
  onOpenChange,
  targets,
  onJump,
  query,
  onQueryChange,
}: MessageSearchProps): React.JSX.Element | null {
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const deferredQuery = useDeferredValue(query);

  // Focus input on open
  useEffect(() => {
    if (open) {
      requestAnimationFrame(() => {
        inputRef.current?.focus();
        inputRef.current?.select();
      });
    }
  }, [open]);

  const results = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    if (!trimmed) return [] as MessageSearchTarget[];
    const matched = targets.filter((target) => {
      const lowerText = target.text.toLowerCase();
      const lowerMeta = target.meta.toLowerCase();
      return lowerText.includes(trimmed) || lowerMeta.includes(trimmed);
    });
    matched.sort((a, b) => a.renderIndex - b.renderIndex);
    return matched;
  }, [deferredQuery, targets]);

  const totalMatches = results.length;
  const clampedIndex = activeIndex >= totalMatches ? 0 : activeIndex;

  const jumpTo = useCallback(
    (index: number): void => {
      if (results.length === 0) return;
      const clamped = ((index % results.length) + results.length) % results.length;
      setActiveIndex(clamped);
      onJump(results[clamped]);
    },
    [results, onJump],
  );

  // Auto-jump to first match when query changes
  const prevDeferredRef = useRef(deferredQuery);
  useEffect(() => {
    const prev = prevDeferredRef.current;
    prevDeferredRef.current = deferredQuery;
    if (prev === deferredQuery) return;
    if (deferredQuery.trim().length > 0 && results.length > 0) {
      onJump(results[0]);
    }
  }, [deferredQuery, results, onJump]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent<HTMLInputElement>): void => {
      if (event.key === 'Escape') {
        event.preventDefault();
        onOpenChange(false);
        return;
      }
      if (results.length === 0) return;
      if (event.key === 'Enter') {
        event.preventDefault();
        jumpTo(event.shiftKey ? clampedIndex - 1 : clampedIndex + 1);
        return;
      }
      if (event.key === 'ArrowDown') {
        event.preventDefault();
        jumpTo(clampedIndex + 1);
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        jumpTo(clampedIndex - 1);
        return;
      }
    },
    [results.length, clampedIndex, jumpTo, onOpenChange],
  );

  if (!open) return null;

  const hasQuery = deferredQuery.trim().length > 0;
  const empty = hasQuery && results.length === 0;

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor className="absolute right-3 top-2" />
      <PopoverContent
        align="end"
        sideOffset={0}
        className="w-[min(24rem,calc(100%-1.5rem))] p-0"
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('[data-testid="message-list"]')) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1.5">
          <IconSearch className="size-4 shrink-0 text-muted-foreground" />
          <Input
            ref={inputRef}
            value={query}
            onChange={(event) => {
              setActiveIndex(0);
              onQueryChange(event.target.value);
            }}
            onKeyDown={handleKeyDown}
            placeholder="Search messages…"
            className="h-7 flex-1 border-0 bg-transparent px-0 text-sm shadow-none focus-visible:ring-0"
          />
          <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
            {hasQuery ? (totalMatches > 0 ? `${clampedIndex + 1}/${totalMatches}` : '0/0') : ''}
          </span>
          <button
            type="button"
            onClick={() => jumpTo(clampedIndex - 1)}
            disabled={totalMatches === 0}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Previous match (Shift+Enter)"
          >
            <IconChevronUp className="size-4" stroke={1.75} />
          </button>
          <button
            type="button"
            onClick={() => jumpTo(clampedIndex + 1)}
            disabled={totalMatches === 0}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground disabled:opacity-40"
            title="Next match (Enter)"
          >
            <IconChevronDown className="size-4" stroke={1.75} />
          </button>
          <button
            type="button"
            onClick={() => onOpenChange(false)}
            className="rounded p-0.5 text-muted-foreground hover:text-foreground"
            title="Close (Esc)"
          >
            <IconX className="size-4" stroke={1.75} />
          </button>
        </div>
        {empty ? (
          <div className="border-t border-border px-3 py-3 text-center text-sm text-muted-foreground">
            No matches
          </div>
        ) : null}
      </PopoverContent>
    </Popover>
  );
}
