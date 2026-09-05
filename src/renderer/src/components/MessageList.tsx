import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown } from '@tabler/icons-react';
import type { TranscriptNode } from '../state/transcriptController';
import { MESSAGE_LIST_MAX_WIDTH, MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import { buildRenderItems } from '../lib/readGrouping';
import { estimateRenderItemHeight } from '../lib/messageListEstimates';
import { buildSearchTargets } from './messageSearchTargets';
import { RenderItemRenderer } from './messageListRows';
import { escapeAbortScopeProps } from '../lib/focusScopes';
import MessageSearch, { type OccurrenceResult } from './MessageSearch';
import { findOccurrenceRanges } from '../lib/highlightMatches';
import { useMessageListScrollController } from '../hooks/useMessageListScrollController';
import { useActiveUserMessageIndex } from '../hooks/useActiveUserMessageIndex';
import UserMessageMiniMap from './UserMessageMiniMap';
import MinimalView from './minimalView';
import { analyzeTurn, buildTurns } from '../lib/minimalTurns';

interface MessageListProps {
  nodes: TranscriptNode[];
  sessionPath: string;
}

function isRenderableNode(node: TranscriptNode): boolean {
  if (node.role !== 'assistant') return true;
  return Boolean(node.text || node.thinking || node.errorMessage);
}

export default React.memo(function MessageList({
  nodes,
  sessionPath,
}: MessageListProps): React.JSX.Element {
  // Created here (not inside the scroll controller) because the virtualizer
  // needs containerRef for getScrollElement while the controller needs the
  // virtualizer's totalSize — the refs break that cycle.
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsWrapperRef = useRef<HTMLDivElement>(null);

  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRefocus, setSearchRefocus] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());
  // Always reflects latest searchQuery so expandIfHidden's deferred callback
  // doesn't read a stale closure value if the query changed in the meantime.
  const searchQueryRef = useRef(searchQuery);
  searchQueryRef.current = searchQuery;
  const [activeOccurrenceInfo, setActiveOccurrenceInfo] = useState<{
    itemId: string;
    toolNodeId: string | null;
    occurrenceIndex: number;
  } | null>(null);

  const toolBlockViewMode = useAppStore((state) => state.toolBlockViewMode);
  // Minimal mode renders plain (non-virtualized) turn content inside the same
  // scroll container, sharing auto-scroll / restore / minimap with other modes.
  const isMinimal = toolBlockViewMode === 'minimal';
  const sessionStatus = useAppStore(
    (state) => (sessionPath ? state.sessions.get(sessionPath)?.status : undefined) ?? 'idle',
  );

  const displayNodes = useMemo(() => nodes.filter(isRenderableNode), [nodes]);
  const { lastMinimalTurn, isLastMinimalTurnActive } = useMemo(() => {
    const turns = buildTurns(displayNodes);
    const lastTurn = turns[turns.length - 1] ?? null;
    return {
      lastMinimalTurn: lastTurn,
      isLastMinimalTurnActive:
        lastTurn !== null && analyzeTurn(lastTurn, sessionStatus, true).isActive,
    };
  }, [displayNodes, sessionStatus]);

  // O(1) lookup: node reference → displayNodes index
  const nodeToDisplayIndex = useMemo(() => {
    const map = new WeakMap<TranscriptNode, number>();
    for (let index = 0; index < displayNodes.length; index++) {
      map.set(displayNodes[index], index);
    }
    return map;
  }, [displayNodes]);

  const renderItems = useMemo(
    () => buildRenderItems(displayNodes, toolBlockViewMode === 'compact_read'),
    [displayNodes, toolBlockViewMode],
  );

  // Map from displayNodes index → renderItems index for user messages
  const displayToRenderIndex = useMemo(() => {
    const map = new Map<number, number>();
    for (let renderIndex = 0; renderIndex < renderItems.length; renderIndex++) {
      const item = renderItems[renderIndex];
      if (item.type === 'node') {
        const displayIndex = nodeToDisplayIndex.get(item.node);
        if (displayIndex !== undefined) map.set(displayIndex, renderIndex);
      }
    }
    return map;
  }, [renderItems, nodeToDisplayIndex]);

  const searchTargets = useMemo(
    () => (isMinimal ? [] : buildSearchTargets(renderItems)),
    [renderItems, isMinimal],
  );

  const getItemKey = useCallback((index: number) => renderItems[index]?.id ?? index, [renderItems]);

  // TanStack Virtual returns imperative measurement helpers; this follows its documented React pattern.

  const rowVirtualizer = useVirtualizer({
    // Inert in minimal mode: turns render unvirtualized, so there is nothing
    // to measure or window. The hook still runs to keep hook order stable.
    count: isMinimal ? 0 : renderItems.length,
    getScrollElement: () => containerRef.current,
    getItemKey,
    estimateSize: (index) => estimateRenderItemHeight(renderItems[index]),
    overscan: 8,
    // gap makes the virtualizer's coordinate model match the DOM flow layout:
    // rows are laid out in-flow with marginBottom = MESSAGE_ROW_GAP, so without
    // gap the model is gapless while the DOM is not. Every rendered row then
    // sits one gap lower than the model per preceding row — a systematic drift
    // of windowIndex * gap px that shifts ALL visible rows every time the
    // window re-anchors (rows entering/leaving the render window), and makes
    // the model's bottom disagree with the real DOM scrollHeight.
    gap: MESSAGE_ROW_GAP,
  });

  // The virtualizer's built-in scroll correction (resizeItem -> scroll by the
  // size delta for items above the viewport) is intentionally left ON but
  // gated on auto-scroll. It runs in the ResizeObserver step of the same
  // frame a measurement lands in, before paint, so it compensates
  // estimate-error shifts of rows mounting or being measured above the
  // viewport — the micro-jitter seen when scrolling to the bottom of a long
  // list. It previously had to be disabled because its gapless coordinate
  // model disagreed with the DOM scrollHeight and it fought the auto-scroll
  // pin without converging; with gap restored both corrections now target the
  // same bottom, and the pin (registered later, in an effect after mount)
  // still wins when both run in the same frame.
  //
  // The gate matters: the correction writes scrollTop through
  // applyScrollAdjustment without consulting the scroll controller, so an
  // un-gated correction keeps adjusting while the user is scrolled up (e.g. a
  // late re-measure of a row above the viewport — async code highlight
  // landing — drags the locked viewport down, defeating the wheel lock).
  // Preserve the virtualizer's default positional check while following:
  // returning only the auto-follow flag would force a correction for EVERY
  // resized item, including the active row in or below the viewport. That
  // correction can run after the real-DOM bottom pin and move a painted
  // frame off-bottom.

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const scrollController = useMessageListScrollController({
    containerRef,
    rowsWrapperRef,
    sessionPath,
    isMinimal,
    lastMinimalTurn,
    isLastMinimalTurnActive,
    totalSize,
  });

  const {
    topPaddingPx,
    showScrollButton,
    containerWidth,
    suspendAutoScroll,
    handleScrollToBottom,
    handleMinimalTurnEnd,
    releaseAutoScrollPin,
    handleOutputGrowth,
    handleCollapseChange,
    handleCollapseDetails,
  } = scrollController;

  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = (item) => {
    const scrollOffset = containerRef.current?.scrollTop;
    return (
      scrollController.isAutoScrollEnabled() &&
      scrollOffset !== undefined &&
      item.start < scrollOffset
    );
  };

  const activeUserMessageIndex = useActiveUserMessageIndex({
    isMinimal,
    containerRef,
    renderItems,
    displayNodes,
    nodeToDisplayIndex,
    virtualizer: rowVirtualizer,
    virtualItems,
  });

  // Search is unavailable in minimal mode; drop any stale search state so it
  // doesn't resurface with outdated targets when switching back.
  useEffect(() => {
    if (!isMinimal) return;
    setSearchOpen(false);
    setSearchQuery('');
    setActiveOccurrenceInfo(null);
  }, [isMinimal]);

  const handleScrollToIndex = useCallback(
    (displayIndex: number) => {
      suspendAutoScroll();
      if (isMinimal) {
        // No virtual rows to scroll to — locate the user bubble in the DOM.
        const container = containerRef.current;
        const element = container?.querySelector<HTMLElement>(
          `[data-display-index="${displayIndex}"]`,
        );
        if (!container || !element) return;
        container.scrollTop +=
          element.getBoundingClientRect().top - container.getBoundingClientRect().top;
        return;
      }
      const renderIndex = displayToRenderIndex.get(displayIndex);
      if (renderIndex === undefined) return;
      rowVirtualizer.scrollToIndex(renderIndex, { align: 'start', behavior: 'auto' });
    },
    [isMinimal, rowVirtualizer, displayToRenderIndex, containerRef, suspendAutoScroll],
  );

  const toggleGroupExpand = useCallback(
    (groupId: string) => {
      suspendAutoScroll();
      setExpandedGroupIds((prev) => {
        const next = new Set(prev);
        if (next.has(groupId)) {
          next.delete(groupId);
        } else {
          next.add(groupId);
        }
        return next;
      });
    },
    [suspendAutoScroll],
  );

  const handleSearchJump = useCallback(
    (result: OccurrenceResult): void => {
      const target = result.target;
      suspendAutoScroll();
      if (target.groupId) {
        setExpandedGroupIds((prev) => {
          if (prev.has(target.groupId!)) return prev;
          const next = new Set(prev);
          next.add(target.groupId!);
          return next;
        });
      }
      rowVirtualizer.scrollToIndex(target.renderIndex, { align: 'start', behavior: 'auto' });
      setActiveOccurrenceInfo({
        itemId: target.itemId,
        toolNodeId: target.toolNodeId ?? null,
        occurrenceIndex: result.occurrenceIndex,
      });

      // Auto-expand overflow-hidden tool content when a match is inside
      if (target.role === 'tool') {
        const expandIfHidden = (): void => {
          const container = containerRef.current;
          if (!container) return;
          const toolSelector = target.toolNodeId
            ? `[data-tool-node-id="${target.toolNodeId}"]`
            : `[data-index="${target.renderIndex}"]`;
          const root = container.querySelector(toolSelector);
          if (!(root instanceof HTMLElement)) return;

          const overflowEl = root.querySelector<HTMLElement>('[style*="max-height"]');
          if (!overflowEl) return;

          // Read from ref to avoid stale closure if query changed after this
          // deferred callback was scheduled.
          const query = searchQueryRef.current.trim();
          if (!query) return;
          const segments = findOccurrenceRanges(root, query, result.occurrenceIndex);
          if (!segments || segments.length === 0) return;

          // Check if the match is fully visible (both ends within the overflow container).
          // Content is tail-anchored (overflow clipped at the TOP), so we check
          // the first segment's top and the last segment's bottom.
          const firstSegment = segments[0];
          const lastSegment = segments[segments.length - 1];
          const firstRect = firstSegment.getBoundingClientRect();
          const lastRect = lastSegment.getBoundingClientRect();
          const overflowRect = overflowEl.getBoundingClientRect();
          if (firstRect.top >= overflowRect.top && lastRect.bottom <= overflowRect.bottom) return;

          // relies on [data-action="expand-overflow"] on overflow buttons
          const expandButton = root.querySelector<HTMLButtonElement>(
            '[data-action="expand-overflow"]',
          );
          if (!expandButton) return;
          expandButton.click();

          //     After the expand animation, scroll to the matched text
          const scrollToMatch = (): void => {
            const freshSegments = findOccurrenceRanges(root, query, result.occurrenceIndex);
            const firstSegment = freshSegments?.[0];
            if (!firstSegment || !container) return;
            const rect = firstSegment.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            container.scrollTo({
              top: container.scrollTop + rect.top - containerRect.top - containerRect.height / 2,
              behavior: 'auto',
            });
          };
          requestAnimationFrame(() => requestAnimationFrame(scrollToMatch));
        };
        // Delay for scroll + expand animations to settle, then check
        requestAnimationFrame(() => setTimeout(expandIfHidden, 100));
      }
    },
    [rowVirtualizer, containerRef, suspendAutoScroll],
  );

  // Scroll to active occurrence within the message
  useEffect(() => {
    if (!activeOccurrenceInfo) return;
    const container = containerRef.current;
    if (!container) return;
    const query = searchQuery.trim();
    if (!query) return;

    requestAnimationFrame(() => {
      const itemEl = container.querySelector(
        `[data-item-id="${CSS.escape(activeOccurrenceInfo.itemId)}"]`,
      );
      if (!(itemEl instanceof HTMLElement)) return;

      // Scope to the specific tool node when the match is inside a read group
      const scopeEl = activeOccurrenceInfo.toolNodeId
        ? (itemEl.querySelector<HTMLElement>(
            `[data-tool-node-id="${CSS.escape(activeOccurrenceInfo.toolNodeId)}"]`,
          ) ?? itemEl)
        : itemEl;

      const segments = findOccurrenceRanges(scopeEl, query, activeOccurrenceInfo.occurrenceIndex);
      const firstSegment = segments?.[0];
      if (!firstSegment) return;

      const rect = firstSegment.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + rect.top - containerRect.top - containerRect.height / 2,
        behavior: 'auto',
      });
    });
  }, [activeOccurrenceInfo, searchQuery, containerRef]);

  // Cmd/Ctrl+F opens search (not supported in minimal mode)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isMinimal) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (searchOpen) {
          setSearchRefocus((prev) => prev + 1);
        } else {
          setSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, isMinimal]);

  return (
    <div className="relative min-h-0 flex-1">
      <div
        ref={containerRef}
        className="h-full overflow-y-auto bg-background [overflow-anchor:none] focus:outline-none"
        data-testid="message-list"
        tabIndex={0}
        aria-label="Message list"
        {...escapeAbortScopeProps}
      >
        <div
          className="mx-auto px-5 pb-8 pt-6 user-content"
          style={{ maxWidth: `${MESSAGE_LIST_MAX_WIDTH}px` }}
        >
          {displayNodes.length === 0 && <div style={{ minHeight: '60vh' }} />}

          {isMinimal ? (
            /* Minimal mode: unvirtualized turn content. rowsWrapperRef gives
               the ResizeObserver pin a box that tracks content growth. The
               pinned turn's open space below it is a real spacer row (state
               driven, part of the render tree — minimap jumps, view/session
               switches and streaming commits can never lose it). */
            <div ref={rowsWrapperRef}>
              <MinimalView
                nodes={displayNodes}
                sessionStatus={sessionStatus}
                onExpandDetails={releaseAutoScrollPin}
                onTurnEnd={handleMinimalTurnEnd}
                onCollapseDetails={handleCollapseDetails}
                onCollapseChange={handleCollapseChange}
                onOutputGrowth={handleOutputGrowth}
                scrollContainerRef={containerRef}
              />
              {topPaddingPx > 0 && (
                <div
                  style={{ height: `${topPaddingPx}px` }}
                  aria-hidden="true"
                  data-testid="minimal-top-padding"
                />
              )}
            </div>
          ) : (
            /*
             * Spacer div for the virtualizer. We add paddingBottom instead of
             * using the virtualizer's paddingEnd option because paddingEnd
             * feeds into getTotalSize() and triggers a measure → scroll adjust
             * → re-render loop that causes visible flickering. paddingBottom on
             * this spacer is invisible to the virtualizer (the items inside are
             * position:absolute and ignore it), but it increases scrollHeight
             * so scroll-to-bottom reaches the last item's full margin-bottom.
             */
            <div
              className="relative"
              style={{
                height: `${totalSize}px`,
                paddingBottom: `${MESSAGE_ROW_GAP + 16}px`,
              }}
              data-testid="message-virtualizer"
            >
              <div
                ref={rowsWrapperRef}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItems[0]?.start ?? 0}px)` }}
              >
                {virtualItems.map((virtualItem) => {
                  const item = renderItems[virtualItem.index];
                  const isLast = virtualItem.index === renderItems.length - 1;
                  return (
                    <div
                      key={item.id}
                      ref={rowVirtualizer.measureElement}
                      data-index={virtualItem.index}
                      data-item-id={item.id}
                      style={{
                        marginBottom: `${isLast ? MESSAGE_ROW_GAP + 16 : MESSAGE_ROW_GAP}px`,
                      }}
                    >
                      <RenderItemRenderer
                        item={item}
                        isLast={isLast}
                        sessionActive={sessionStatus !== 'idle'}
                        searchQuery={searchQuery}
                        expanded={
                          item.type === 'readGroup' ? expandedGroupIds.has(item.id) : undefined
                        }
                        onToggleExpand={
                          item.type === 'readGroup' ? () => toggleGroupExpand(item.id) : undefined
                        }
                        activeOccurrenceItemId={activeOccurrenceInfo?.itemId ?? null}
                        activeOccurrenceToolNodeId={activeOccurrenceInfo?.toolNodeId ?? null}
                        activeOccurrenceIndex={activeOccurrenceInfo?.occurrenceIndex ?? null}
                      />
                    </div>
                  );
                })}
              </div>
            </div>
          )}
        </div>
      </div>
      {!isMinimal && (
        <MessageSearch
          key={searchOpen ? 'open' : 'closed'}
          refocus={searchRefocus}
          open={searchOpen}
          onOpenChange={setSearchOpen}
          query={searchQuery}
          onQueryChange={setSearchQuery}
          targets={searchTargets}
          onJump={handleSearchJump}
        />
      )}
      <UserMessageMiniMap
        nodes={displayNodes}
        containerWidth={containerWidth}
        activeUserMessageIndex={activeUserMessageIndex}
        onScrollToIndex={handleScrollToIndex}
      />
      {/* Top gradient fade */}
      <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-linear-to-b from-background to-transparent" />
      {/* Bottom gradient fade */}
      <div className="pointer-events-none absolute inset-x-0 bottom-0 h-4 bg-linear-to-t from-background to-transparent" />
      {showScrollButton && (
        <button
          type="button"
          onClick={handleScrollToBottom}
          className="absolute bottom-6 left-1/2 z-10 flex -translate-x-1/2 items-center justify-center rounded-full border-[0.5px] border-border bg-background/90 shadow-md backdrop-blur-sm transition-opacity hover:bg-muted size-9"
        >
          <IconArrowDown className="size-5 text-muted-foreground" stroke={1.5} />
        </button>
      )}
    </div>
  );
});
