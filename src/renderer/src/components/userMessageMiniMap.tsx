import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { TranscriptNode, UserNode } from '../state/transcriptController';
import { OVERLAY_BG } from '../lib/layoutConstants';
import { Popover, PopoverContent, PopoverTrigger } from './ui/popover';
import { MESSAGE_LIST_HORIZONTAL_PADDING, MESSAGE_LIST_MAX_WIDTH } from '../lib/layoutConstants';

interface UserMessageMiniMapProps {
  nodes: TranscriptNode[];
  containerWidth: number;
  onScrollToIndex: (index: number) => void;
}

function formatTime(timestamp: number): string {
  const date = new Date(timestamp);
  const hours = String(date.getHours()).padStart(2, '0');
  const minutes = String(date.getMinutes()).padStart(2, '0');
  return `${hours}:${minutes}`;
}

const HOVER_OPEN_DELAY = 200;
const HOVER_CLOSE_DELAY = 300;
const LINE_WIDTH_MAX_CAP = 48;
const LINE_WIDTH_RIGHT_MARGIN = 8;
const LINE_WIDTH_MIN_CAP = 8;

/** Returns a width based on message count and position. */
function getLineWidth(index: number, total: number, maxWidth: number): number {
  if (total <= 1) return maxWidth * 0.4;
  if (total === 2) return Math.round(maxWidth * 0.5);

  if (total <= 5) {
    // Few messages: linear from min to ~60% of max at center
    const normalized = index / (total - 1);
    const distFromCenter = 1 - Math.abs(normalized * 2 - 1);
    const target = maxWidth * 0.6;
    return Math.round(LINE_WIDTH_MIN_CAP + distFromCenter * (target - LINE_WIDTH_MIN_CAP));
  }

  if (total <= 10) {
    // Medium count: quadratic curve, center reaches ~80% of max
    const normalized = index / (total - 1);
    const distFromCenter = 1 - Math.abs(normalized * 2 - 1);
    const factor = distFromCenter * distFromCenter;
    return Math.round(LINE_WIDTH_MIN_CAP + factor * (maxWidth * 0.8 - LINE_WIDTH_MIN_CAP));
  }

  // Many messages: quadratic curve, center reaches max
  const normalized = index / (total - 1);
  const distFromCenter = 1 - Math.abs(normalized * 2 - 1);
  const factor = distFromCenter * distFromCenter;
  return Math.round(LINE_WIDTH_MIN_CAP + factor * (maxWidth - LINE_WIDTH_MIN_CAP));
}

export default React.memo(function UserMessageMiniMap({
  nodes,
  containerWidth,
  onScrollToIndex,
}: UserMessageMiniMapProps): React.JSX.Element | null {
  const [open, setOpen] = useState(false);
  const openTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const closeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const maxLineWidth = useMemo(() => {
    const centerGap = Math.max(0, (containerWidth - MESSAGE_LIST_MAX_WIDTH) / 2);
    const availableSpace = centerGap + MESSAGE_LIST_HORIZONTAL_PADDING;
    const effectiveMax = Math.min(LINE_WIDTH_MAX_CAP, availableSpace - LINE_WIDTH_RIGHT_MARGIN);
    return Math.max(LINE_WIDTH_MIN_CAP, effectiveMax);
  }, [containerWidth]);

  // Cleanup timers on unmount
  useEffect(() => {
    return () => {
      if (openTimerRef.current) clearTimeout(openTimerRef.current);
      if (closeTimerRef.current) clearTimeout(closeTimerRef.current);
    };
  }, []);

  const userMessages = useMemo(() => {
    const result: { node: UserNode; index: number }[] = [];
    for (let index = 0; index < nodes.length; index++) {
      const node = nodes[index];
      if (node.role === 'user') {
        result.push({ node, index });
      }
    }
    return result;
  }, [nodes]);

  const handleMouseEnter = useCallback((): void => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
    openTimerRef.current = setTimeout(() => setOpen(true), HOVER_OPEN_DELAY);
  }, []);

  const handleMouseLeave = useCallback((): void => {
    if (openTimerRef.current) {
      clearTimeout(openTimerRef.current);
      openTimerRef.current = null;
    }
    closeTimerRef.current = setTimeout(() => setOpen(false), HOVER_CLOSE_DELAY);
  }, []);

  if (userMessages.length === 0) return null;

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <div
          role="navigation"
          aria-label="Message navigation minimap"
          className="absolute right-0 top-1/2 z-10 flex -translate-y-1/2 cursor-default flex-col items-end gap-1.5 rounded-l py-2 pl-1 opacity-40 transition-opacity hover:opacity-80"
          onMouseEnter={handleMouseEnter}
          onMouseLeave={handleMouseLeave}
        >
          {userMessages.map(({ node }, index) => (
            <div
              key={node.id}
              className="h-px rounded-full bg-muted-foreground/50"
              style={{ width: `${getLineWidth(index, userMessages.length, maxLineWidth)}px` }}
            />
          ))}
        </div>
      </PopoverTrigger>
      <PopoverContent
        side="left"
        align="center"
        className={`max-h-[50vh] w-64 overflow-hidden ${OVERLAY_BG} p-0 backdrop-blur-md`}
        onMouseEnter={handleMouseEnter}
        onMouseLeave={handleMouseLeave}
        onOpenAutoFocus={(event) => event.preventDefault()}
        onCloseAutoFocus={(event) => event.preventDefault()}
      >
        <div className="flex flex-col gap-0.5 overflow-y-auto p-1 scrollbar-none">
          {userMessages.map(({ node, index }) => (
            <button
              key={node.id}
              type="button"
              // FLOATING_ITEM_HOVER
              className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors hover:bg-foreground/7"
              onClick={() => {
                onScrollToIndex(index);
                setOpen(false);
              }}
            >
              <span
                className="min-w-0 flex-1 truncate text-[13px] text-foreground"
                title={node.text.split('\n')[0] || 'Empty message'}
              >
                {node.text.split('\n')[0] || 'Empty message'}
              </span>
              <span className="shrink-0 text-[11px] text-muted-foreground">
                {formatTime(node.sentAt)}
              </span>
            </button>
          ))}
        </div>
      </PopoverContent>
    </Popover>
  );
});
