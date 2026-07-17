import { useCallback, useEffect, useMemo, useRef, useState, useDeferredValue } from 'react';
import { IconArrowUp, IconArrowDown, IconX, IconSearch } from '@tabler/icons-react';
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

export interface OccurrenceResult {
  target: MessageSearchTarget;
  occurrenceIndex: number;
}

interface MessageSearchProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  targets: MessageSearchTarget[];
  onJump: (result: OccurrenceResult) => void;
  query: string;
  onQueryChange: (query: string) => void;
  refocus: number;
}

export default function MessageSearch({
  open,
  onOpenChange,
  targets,
  onJump,
  query,
  onQueryChange,
  refocus,
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

  // Select all on Cmd+F when already open
  useEffect(() => {
    if (refocus > 0 && inputRef.current) {
      inputRef.current.select();
    }
  }, [refocus]);

  const results = useMemo(() => {
    const trimmed = deferredQuery.trim().toLowerCase();
    if (!trimmed) return [] as OccurrenceResult[];
    const results: OccurrenceResult[] = [];
    const targetCounts = new Map<MessageSearchTarget, number>();
    const lowerTrimmed = trimmed;
    for (const target of targets) {
      // Count matches in DOM tree order: meta (tool label / thinking block) appears
      // before text (output / markdown) in the rendered DOM.
      for (const source of [target.meta, target.text]) {
        const lowerSource = source.toLowerCase();
        let searchIndex = 0;
        while (searchIndex < lowerSource.length) {
          const matchIndex = lowerSource.indexOf(lowerTrimmed, searchIndex);
          if (matchIndex === -1) break;
          const count = targetCounts.get(target) ?? 0;
          targetCounts.set(target, count + 1);
          results.push({ target, occurrenceIndex: count });
          searchIndex = matchIndex + lowerTrimmed.length;
        }
      }
    }
    return results;
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

  return (
    <Popover open={open} onOpenChange={onOpenChange}>
      <PopoverAnchor className="absolute right-5 top-2" />
      <PopoverContent
        align="end"
        sideOffset={0}
        className="w-72 rounded-lg p-0"
        onInteractOutside={(event) => {
          const target = event.target;
          if (target instanceof Element && target.closest('[data-testid="message-list"]')) {
            event.preventDefault();
          }
        }}
      >
        <div className="flex items-center gap-1.5 px-2 py-1">
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
            className="h-7 w-44 border-0 bg-transparent px-px text-sm shadow-none focus-visible:ring-0"
          />
          <div className="ml-auto flex items-center gap-1.5">
            {hasQuery && totalMatches > 0 && (
              <>
                <span className="shrink-0 text-xs tabular-nums text-muted-foreground">
                  {clampedIndex + 1}/{totalMatches}
                </span>
                <span className="flex items-center gap-0.5">
                  <button
                    type="button"
                    onClick={() => jumpTo(clampedIndex - 1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="Previous match (Shift+Enter)"
                  >
                    <IconArrowUp className="size-4" stroke={1.75} />
                  </button>
                  <button
                    type="button"
                    onClick={() => jumpTo(clampedIndex + 1)}
                    className="rounded p-0.5 text-muted-foreground hover:text-foreground"
                    title="Next match (Enter)"
                  >
                    <IconArrowDown className="size-4" stroke={1.75} />
                  </button>
                </span>
              </>
            )}
            {hasQuery && totalMatches === 0 && (
              <span className="shrink-0 text-[10px] whitespace-nowrap text-red-500">NOT FOUND</span>
            )}
            <button
              type="button"
              onClick={() => onOpenChange(false)}
              className="rounded p-0.5 text-muted-foreground hover:text-foreground"
              title="Close (Esc)"
            >
              <IconX className="size-4" stroke={1.75} />
            </button>
          </div>
        </div>
      </PopoverContent>
    </Popover>
  );
}
