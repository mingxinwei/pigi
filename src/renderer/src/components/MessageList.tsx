import React, { useCallback, useMemo, useRef, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown } from '@tabler/icons-react';
import type { TranscriptNode } from '../state/transcriptController';
import {
  MESSAGE_LIST_BOTTOM_INSET,
  MESSAGE_LIST_MAX_WIDTH,
  MESSAGE_LIST_SCROLL_END_THRESHOLD,
  MESSAGE_LIST_TOP_INSET,
  MESSAGE_ROW_GAP,
} from '../lib/layoutConstants';
import { buildRenderItems } from '../lib/readGrouping';
import { estimateRenderItemHeight } from '../lib/messageListEstimates';
import { getMeasuredRowHeight, recordMeasuredRowHeight } from '../lib/measuredRowHeights';
import { RenderItemRenderer } from './messageListRows';
import { escapeAbortScopeProps } from '../lib/focusScopes';
import MessageSearch from './MessageSearch';
import { useMessageListScrollController } from '../hooks/useMessageListScrollController';
import { useActiveUserMessageIndex } from '../hooks/useActiveUserMessageIndex';
import { useMessageSearchController } from '../hooks/useMessageSearchController';
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

  const [expandedGroupIds, setExpandedGroupIds] = useState<Set<string>>(() => new Set());

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

  // Wrappers are identity-cached by node reference (see readGrouping.ts), so
  // a streaming delta only changes the item objects of rows that changed.
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

  const getItemKey = useCallback((index: number) => renderItems[index]?.id ?? index, [renderItems]);

  // Reuse heights measured in previous visits of this session: on remount
  // (session switch) the virtualizer's cache is gone, but rows keyed by the
  // same ids have known real heights — restoring them keeps the layout close
  // to what the saved scroll position was recorded against.
  const estimateSize = useCallback(
    (index: number): number =>
      getMeasuredRowHeight(renderItems[index]?.id ?? '') ??
      estimateRenderItemHeight(renderItems[index]),
    [renderItems],
  );

  // TanStack Virtual returns imperative measurement helpers; this follows its documented React pattern.

  const rowVirtualizer = useVirtualizer({
    // Inert in minimal mode: turns render unvirtualized, so there is nothing
    // to measure or window. The hook still runs to keep hook order stable.
    count: isMinimal ? 0 : renderItems.length,
    getScrollElement: () => containerRef.current,
    getItemKey,
    estimateSize,
    overscan: 8,
    // gap makes the virtualizer's coordinate model match the DOM flow layout:
    // rows are laid out in-flow with marginBottom = MESSAGE_ROW_GAP, so without
    // gap the model is gapless while the DOM is not. paddingStart/paddingEnd
    // fold the top inset and the below-last-row breathing room into the model,
    // which makes totalSize equal the real scrollHeight — the precondition for
    // anchorTo: 'end' to judge "at end" exactly (see below) and for
    // scrollToIndex alignments to be pixel-accurate.
    gap: MESSAGE_ROW_GAP,
    paddingStart: MESSAGE_LIST_TOP_INSET,
    paddingEnd: MESSAGE_LIST_BOTTOM_INSET,
    // Seed the tracked scroll offset with the session's saved position so
    // restoration happens natively: the virtualizer writes initialOffset on
    // scroll-element attach, and when the transcript loads (item count
    // 0 -> N) its anchor logic re-applies the tracked offset to the element
    // — no post-render scrollTop writes that its reconcile would fight.
    // A bottom sentinel (clamped to the content end) covers both "was at
    // bottom" (-1) and "no saved position": both should land at the end.
    // Lazy function form: read once, at first getScrollOffset() call.
    initialOffset: () => {
      const saved = sessionPath
        ? useAppStore.getState().scrollPositions.get(sessionPath)
        : undefined;
      return saved === undefined || saved === -1 ? Number.MAX_SAFE_INTEGER : saved;
    },
    // anchorTo: 'end' lets the virtualizer own bottom auto-follow: on every
    // item re-measure, if the viewport sits within scrollEndThreshold of the
    // content end it applies the size delta synchronously (inside its own
    // ResizeObserver callback, before paint) so the viewport stays glued to
    // the streaming bottom — replacing the hand-rolled wrapper-observer pin.
    // When NOT at the end, the built-in default correction preserves the
    // reading position (only items entirely above the viewport shift scroll,
    // fold-spanning rows and backward scrolling are exempt).
    anchorTo: 'end',
    // When rows are appended while at the end (new message), scroll to the
    // new end during the same commit, before paint.
    followOnAppend: true,
    scrollEndThreshold: MESSAGE_LIST_SCROLL_END_THRESHOLD,
  });

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  const scrollController = useMessageListScrollController({
    containerRef,
    rowsWrapperRef,
    sessionPath,
    isMinimal,
    lastMinimalTurn,
    isLastMinimalTurnActive,
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

  const activeUserMessageIndex = useActiveUserMessageIndex({
    isMinimal,
    containerRef,
    renderItems,
    displayNodes,
    nodeToDisplayIndex,
    virtualizer: rowVirtualizer,
    virtualItems,
  });

  // Stable expand callback shared by the group toggle and search jumps.
  const expandGroup = useCallback((groupId: string): void => {
    setExpandedGroupIds((prev) => {
      if (prev.has(groupId)) return prev;
      const next = new Set(prev);
      next.add(groupId);
      return next;
    });
  }, []);

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

  const {
    searchOpen,
    setSearchOpen,
    searchRefocus,
    searchQuery,
    setSearchQuery,
    searchTargets,
    activeOccurrenceInfo,
    handleSearchJump,
  } = useMessageSearchController({
    isMinimal,
    containerRef,
    rowVirtualizer,
    suspendAutoScroll,
    renderItems,
    expandGroup,
  });

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
          className="mx-auto px-5 user-content"
          style={{ maxWidth: `${MESSAGE_LIST_MAX_WIDTH}px` }}
        >
          {displayNodes.length === 0 && (
            <div style={{ minHeight: '60vh', marginTop: `${MESSAGE_LIST_TOP_INSET}px` }} />
          )}

          {isMinimal ? (
            /* Minimal mode: unvirtualized turn content. rowsWrapperRef gives
               the ResizeObserver pin a box that tracks content growth. The
               pinned turn's open space below it is a real spacer row (state
               driven, part of the render tree — minimap jumps, view/session
               switches and streaming commits can never lose it). */
            <div ref={rowsWrapperRef} className="pb-8 pt-6">
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
             * Spacer div for the virtualizer: its height IS totalSize (the
             * model includes paddingStart/paddingEnd, so it equals the real
             * scrollHeight — this is what keeps the virtualizer's at-end
             * check exact). Rows are position:absolute inside it.
             */
            <div
              className="relative"
              style={{ height: `${totalSize}px` }}
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
                      ref={(element) => {
                        rowVirtualizer.measureElement(element);
                        if (element) {
                          recordMeasuredRowHeight(item.id, element.offsetHeight);
                        }
                      }}
                      data-index={virtualItem.index}
                      data-item-id={item.id}
                      style={{
                        marginBottom: `${isLast ? MESSAGE_LIST_BOTTOM_INSET : MESSAGE_ROW_GAP}px`,
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
                        onToggleExpand={item.type === 'readGroup' ? toggleGroupExpand : undefined}
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
