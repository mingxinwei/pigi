import React, { useRef, useLayoutEffect, useEffect, useCallback, useMemo, useState } from 'react';
import { useAppStore } from '../state/appStore';
import { useVirtualizer } from '@tanstack/react-virtual';
import { IconArrowDown } from '@tabler/icons-react';
import {
  type TranscriptNode,
  type AssistantNode,
  type ToolNode,
  getToolArgs,
} from '../state/transcriptController';
import {
  MESSAGE_CONTENT_MAX_WIDTH,
  MESSAGE_LIST_MAX_WIDTH,
  MESSAGE_ROW_GAP,
  BLOCK_CONTENT_MAX_HEIGHT,
} from '../lib/layoutConstants';
import ToolBlock from './ToolBlock';
import { getToolCommandParts, getToolSearchText } from '../lib/toolDisplay';
import CollapsedReadGroup from './CollapsedReadGroup';
import MarkdownMessage from './markdownMessage';
import UserMessageMiniMap from './UserMessageMiniMap';
import { escapeAbortScopeProps } from '../lib/focusScopes';
import MessageSearch, { type MessageSearchTarget, type OccurrenceResult } from './MessageSearch';
import { useHighlightTextNodes, findOccurrenceRanges } from '../lib/highlightMatches';
import { buildRenderItems, type RenderItem } from '../lib/readGrouping';
import ThinkingBlock from './thinkingBlock';
import { MessageToolbar, SystemBubble, UserBubble } from './messageBubbles';
import { parseSkillBlock } from '../lib/skillBlock';
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

/** Minimal-mode pin state machine. */
type PinPhase =
  | { phase: 'idle' }
  | { phase: 'pinned'; turnId: string }
  | { phase: 'following'; turnId: string }
  | { phase: 'scrolled'; turnId: string }
  | { phase: 'ending'; turnId: string };

const AUTO_SCROLL_BOTTOM_THRESHOLD = 2;
const SCROLL_BUTTON_VIEWPORT_MULTIPLIER = 2;
const TOOL_BLOCK_ESTIMATE_BUFFER = 24;
const TOOL_STATUS_LINE_ESTIMATE_HEIGHT = 24;
const USER_MESSAGE_TOOLBAR_HEIGHT = 24;
const USER_MESSAGE_LEADING_PADDING = 24;
const USER_MESSAGE_TRAILING_PADDING = 8;
const USER_MESSAGE_WRAP_ESTIMATE_WIDTH = 72;
/** Conservative estimate cap for the user bubble's reduced viewport clamp. */
const USER_MESSAGE_MAX_ESTIMATE_HEIGHT = 200;

/** Extract a search-friendly command string for a tool node, matching the text rendered in the tool label. */
function getToolSearchMeta(node: ToolNode): string {
  const { prefix, body } = getToolCommandParts(node);
  return `${prefix}${body}`;
}

function buildSearchTargets(items: RenderItem[]): MessageSearchTarget[] {
  const targets: MessageSearchTarget[] = [];
  for (let renderIndex = 0; renderIndex < items.length; renderIndex++) {
    const item = items[renderIndex];
    if (item.type === 'readGroup') {
      for (const entry of item.entries) {
        if (entry.kind === 'tool') {
          targets.push({
            renderIndex,
            itemId: item.id,
            groupId: item.id,
            toolNodeId: entry.node.id,
            role: 'tool',
            text: getToolSearchText(entry.node),
            meta: getToolSearchMeta(entry.node),
            preview: entry.node.output || getToolSearchMeta(entry.node),
          });
        } else {
          targets.push({
            renderIndex,
            itemId: item.id,
            groupId: item.id,
            toolNodeId: entry.node.id,
            role: 'assistant',
            text: entry.node.thinking,
            meta: '',
            preview: entry.node.thinking,
          });
        }
      }
    } else {
      const node = item.node;
      switch (node.role) {
        case 'user':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'user',
            text: node.text,
            meta: '',
            preview: node.text,
          });
          break;
        case 'assistant':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'assistant',
            text: node.text,
            meta: node.thinking,
            preview: node.text || node.thinking,
          });
          break;
        case 'tool':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'tool',
            text: getToolSearchText(node),
            meta: getToolSearchMeta(node),
            preview: node.output || getToolSearchMeta(node),
          });
          break;
        case 'system':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'system',
            text: node.text,
            meta: '',
            preview: node.text,
          });
          break;
      }
    }
  }
  return targets;
}

export default React.memo(function MessageList({
  nodes,
  sessionPath,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const rowsWrapperRef = useRef<HTMLDivElement>(null);
  const autoScrollRef = useRef(true);
  // In-flight layout-restore animation (cancelled the moment the user
  // scrolls, so their position is never yanked back).
  const restoreAnimRef = useRef<{ cancel: () => void } | null>(null);

  // Minimal-mode pin state machine. A single ref encodes the phase of the
  const pinRef = useRef<PinPhase>({ phase: 'idle' });
  // The turn id that was pinned before details expanded — re-pin on collapse.
  const lastPinnedTurnIdRef = useRef<string | null>(null);
  const lastTurnIdRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
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

  // eslint-disable-next-line react-hooks/incompatible-library
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
  // size delta for items above the viewport) is intentionally left ON. It runs
  // in the ResizeObserver step of the same frame a measurement lands in,
  // before paint, so it compensates estimate-error shifts of rows mounting or
  // being measured above the viewport — the micro-jitter seen when scrolling
  // to the bottom of a long list. It previously had to be disabled because its
  // gapless coordinate model disagreed with the DOM scrollHeight and it fought
  // the auto-scroll pin without converging; with gap restored both corrections
  // now target the same bottom, and the pin (registered later, in an effect
  // after mount) still wins when both run in the same frame.

  // Viewport-height spacer below the active turn so it can reach the top.
  const [topPaddingPx, setTopPaddingPx] = useState(0);
  const topPaddingPxRef = useRef(0);
  useLayoutEffect(() => {
    topPaddingPxRef.current = topPaddingPx;
  }, [topPaddingPx]);

  // New active turn: pin it in minimal mode, or enable auto-scroll. Resolve
  // the turn rather than checking only the latest transcript node: React may
  // batch the user message with agent_start or the first assistant delta, so
  // the user node is often no longer last by the time this layout effect runs.
  useLayoutEffect(() => {
    const lastTurnId = lastMinimalTurn?.id ?? null;
    const isNewActiveTurn =
      lastMinimalTurn !== null && lastTurnId !== lastTurnIdRef.current && isLastMinimalTurnActive;
    if (isNewActiveTurn) {
      if (isMinimal) {
        pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
        autoScrollRef.current = false;
        // Set an initial spacer — the RO's pinned case will refine it to
        // the exact value on the next layout, but we need SOME space now so
        // the browser doesn't clamp scrollTop before the RO fires.
        const container = containerRef.current;
        if (container) {
          setTopPaddingPx(container.clientHeight);
        }
      } else {
        autoScrollRef.current = true;
      }
    }
    lastTurnIdRef.current = lastTurnId;
  }, [isLastMinimalTurnActive, isMinimal, lastMinimalTurn]);

  // While a just-expanded details area settles (one frame: the details mount,
  // the pin padding is re-fit, the viewport rolls to the details bottom), the
  // auto-scroll ResizeObserver must stand down — its scrollToBottom would
  // otherwise fight the roll (it targets the old bottom, computed while the
  // padding is still in place) and leave the viewport wherever it clamped.
  const expandSettlingRef = useRef(false);

  // Auto-scroll + wheel handler.
  //
  // Pinning is done synchronously inside ResizeObserver callbacks, which run
  // after layout but BEFORE paint in the same frame — so the pinned scroll
  // position is what actually gets painted. This is the only timing that
  // avoids visible jitter during fast streaming:
  //
  // - Pinning from a React effect keyed on the virtualizer's total size is one
  //   frame too late: the streaming commit grows the row DOM immediately, but
  //   the virtualizer only learns the new size via its own ResizeObserver, so
  //   the growth frame paints unpinned (content visually jumps up) and the
  //   next frame snaps back — a high-amplitude vibration at fast output rates.
  // - The virtualizer's built-in correction (resizeItem -> scrollTo) runs in
  //   the right frame and — now that the virtualizer's gap option keeps its
  //   coordinate model in sync with the DOM — converges on the same bottom as
  //   this pin instead of fighting it.
  //
  // Two observers cover both ways the bottom can move:
  // - rowsWrapperRo: any row grows (streaming text, async code highlight,
  //   late re-measure) — the wrapper's border-box tracks the real rows, which
  //   lead the virtualizer's measurements.
  // - containerRo: the container itself shrinks (e.g. StreamingQueue appears).
  //
  // The useLayoutEffect keyed on totalSize below remains as a backup for
  // spacer-height commits (virtualizer re-measures change totalSize without a
  // row-DOM resize, which rowsWrapperRo cannot see).
  // Re-created on view-mode switch: minimal mode attaches rowsWrapperRef to a
  // different element, so the observers must re-bind.
  // Re-glues the pinned turn's top edge to the viewport top.
  const pinTopToViewport = useCallback(() => {
    const pin = pinRef.current;
    if (pin.phase === 'idle' || pin.phase === 'ending') return;
    const container = containerRef.current;
    if (!container) return;
    const turnEl = container.querySelector(`[data-turn-id="${pin.turnId}"]`);
    if (!turnEl) return;
    container.scrollTop =
      turnEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
  }, []);

  useEffect(() => {
    const container = containerRef.current;
    const rowsWrapper = rowsWrapperRef.current;
    if (!container || !rowsWrapper) return;

    function handleResize(): void {
      if (expandSettlingRef.current) return;
      const pin = pinRef.current;
      switch (pin.phase) {
        case 'pinned': {
          const turnEl = container!.querySelector(`[data-turn-id="${pin.turnId}"]`);
          if (!turnEl) break;
          // Pin turn to viewport top.
          const pinPosition =
            turnEl.getBoundingClientRect().top -
            container!.getBoundingClientRect().top +
            container!.scrollTop;
          container!.scrollTop = pinPosition;
          // Refine spacer so maxScroll = pinPosition (user can't scroll past).
          // Read actual spacer height from DOM (state may lag behind).
          const spacerEl = container!.querySelector('[data-testid="minimal-top-padding"]');
          const actualSpacer = spacerEl ? spacerEl.getBoundingClientRect().height : 0;
          const contentHeight = container!.scrollHeight - actualSpacer;
          const ideal = Math.max(0, pinPosition + container!.clientHeight - contentHeight);
          if (Math.abs(actualSpacer - ideal) > 1) {
            setTopPaddingPx(ideal);
          }
          break;
        }
        case 'following': {
          // Ride the content bottom (spacer excluded).
          if (!autoScrollRef.current) break;
          container!.scrollTop =
            container!.scrollHeight - topPaddingPxRef.current - container!.clientHeight;
          break;
        }
        case 'idle':
          if (!autoScrollRef.current) break;
          container!.scrollTop = container!.scrollHeight;
          break;
        // 'scrolled' / 'ending': don't touch scrollTop
      }
    }

    const rowsWrapperRo = new ResizeObserver(handleResize);
    rowsWrapperRo.observe(rowsWrapper);

    const containerRo = new ResizeObserver(() => {
      handleResize();
      setContainerWidth(container!.clientWidth);
    });
    containerRo.observe(container);
    setContainerWidth(container.clientWidth);

    function handleWheel(event: WheelEvent): void {
      restoreAnimRef.current?.cancel();
      restoreAnimRef.current = null;
      const pin = pinRef.current;
      if (pin.phase === 'pinned' && event.deltaY < 0) {
        // Only scrolling UP releases the pin (user wants to see history).
        // Scrolling down is blocked by the scroll clamp.
        pinRef.current = { phase: 'scrolled', turnId: pin.turnId };
      } else if (pin.phase === 'following') {
        pinRef.current = { phase: 'scrolled', turnId: pin.turnId };
      }
      if (event.deltaY < 0) {
        autoScrollRef.current = false;
      } else if (event.deltaY > 0 && !autoScrollRef.current && isAtBottom(container!)) {
        autoScrollRef.current = true;
      }
    }

    function handleScroll(): void {
      // While pinned, clamp scrollTop so the user cannot scroll past the
      // turn header — the spacer adjustment is async (React state), so this
      // synchronous clamp covers the gap.
      const pin = pinRef.current;
      if (pin.phase === 'pinned') {
        const turnEl = container!.querySelector(`[data-turn-id="${pin.turnId}"]`);
        if (turnEl) {
          const pinPosition =
            turnEl.getBoundingClientRect().top -
            container!.getBoundingClientRect().top +
            container!.scrollTop;
          if (container!.scrollTop > pinPosition) {
            container!.scrollTop = pinPosition;
          }
        }
      }
      const distanceFromBottom =
        container!.scrollHeight - container!.scrollTop - container!.clientHeight;
      setShowScrollButton(
        distanceFromBottom > container!.clientHeight * SCROLL_BUTTON_VIEWPORT_MULTIPLIER,
      );
    }

    container.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    handleResize();

    return () => {
      rowsWrapperRo.disconnect();
      containerRo.disconnect();
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isMinimal]);

  // Save scroll position to store on every scroll event.
  // If user is at the bottom, save sentinel -1 so restore knows to auto-scroll.
  // Mount-time observers can scroll before restoration runs, so saving remains
  // disabled until the current session's initial position has been applied.
  const restoredScrollSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionPath) return;

    function savePosition(): void {
      if (restoredScrollSessionRef.current !== sessionPath) return;
      const atBottom = isAtBottom(container!);
      const next = atBottom ? -1 : container!.scrollTop;
      // Skip redundant writes (e.g. staying pinned at the bottom during the
      // terminal open/close animation) so we don't allocate a new Map and
      // re-render store subscribers on every scroll frame.
      if (useAppStore.getState().scrollPositions.get(sessionPath) === next) return;
      useAppStore.getState().setScrollPosition(sessionPath, next);
    }

    container.addEventListener('scroll', savePosition, { passive: true });
    return () => container.removeEventListener('scroll', savePosition);
  }, [sessionPath]);

  // Restore saved scroll position on session change, or auto-scroll to bottom.
  // -1 sentinel means user was at bottom → enable auto-scroll so ResizeObserver
  // tracks the true bottom even if content height changed.
  // Guarded to run only on an actual session change: the restore logic reads
  // displayNodes/sessionStatus, which change on every streaming commit —
  // re-running it there would re-pin and yank the viewport mid-stream.
  const prevSessionPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSessionPathRef.current === sessionPath) return;
    prevSessionPathRef.current = sessionPath;
    restoredScrollSessionRef.current = null;
    // Cancel the previous session's turn-end animation before establishing a
    // new pin. Its cleanup is ownership-checked and cannot clear the new turn.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;

    // Re-pin a still-running minimal turn: switching away and back while a
    // turn executes must keep the working area pinned (padding and all).
    // Resolve the turn itself rather than using the last transcript node:
    // while tools or assistant output stream, that node is not the user node
    // used by data-turn-id.
    if (isMinimal && lastMinimalTurn && isLastMinimalTurnActive) {
      pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
      autoScrollRef.current = false;
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
      }
      // A running turn takes over the viewport: skip the saved-position
      // restore entirely (it would override the re-pin).
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          restoredScrollSessionRef.current = sessionPath;
        }
      });
      return;
    }
    clearTopPin();

    const savedPosition = sessionPath
      ? useAppStore.getState().scrollPositions.get(sessionPath)
      : undefined;

    if (savedPosition === -1) {
      // Was at bottom: let ResizeObserver handle it
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    } else if (savedPosition !== undefined) {
      autoScrollRef.current = false;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          containerRef.current.scrollTop = savedPosition;
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    } else {
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    }
  }, [isLastMinimalTurnActive, isMinimal, lastMinimalTurn, pinTopToViewport, sessionPath]);

  const virtualItems = rowVirtualizer.getVirtualItems();
  const totalSize = rowVirtualizer.getTotalSize();

  // Backup pin for spacer-height commits: when the virtualizer's total size
  // changes without a row-DOM resize (late re-measurements only rewrite the
  // spacer height, which the rows-wrapper ResizeObserver cannot see), pin here
  // — synchronously after the height commit, before paint. Row growth during
  // streaming is primarily pinned by the ResizeObserver above.
  const scrollSessionRef = useRef(sessionPath);
  useLayoutEffect(() => {
    // On session switch the restore effect owns initial positioning; skip the
    // pin for that render so a restored mid-scroll position isn't flashed to the
    // bottom first.
    const sessionChanged = scrollSessionRef.current !== sessionPath;
    scrollSessionRef.current = sessionPath;
    if (sessionChanged) return;
    if (!autoScrollRef.current) return;
    const container = containerRef.current;
    if (!container) return;
    container.scrollTop = container.scrollHeight;
  }, [totalSize, sessionPath]);

  // Derive active user message from visible virtual items — no scroll listener needed
  // because the virtualizer already triggers re-renders on scroll.
  // Returns a displayNodes index (what the MiniMap uses).
  // Uses measurement cache to check ALL user messages, not just visible ones,
  // so the last user message stays highlighted when scrolled to the bottom.
  const virtualActiveUserMessageIndex = useMemo(() => {
    if (virtualItems.length === 0) return -1;
    const container = containerRef.current;
    const viewportCenter = container
      ? container.scrollTop + container.clientHeight / 2
      : (virtualItems[0].start + virtualItems[virtualItems.length - 1].end) / 2;
    let closestDisplayIndex = -1;
    let closestDistance = Infinity;
    const measurements = rowVirtualizer.measurementsCache;
    for (let renderIndex = 0; renderIndex < renderItems.length; renderIndex++) {
      const item = renderItems[renderIndex];
      if (item.type !== 'node' || item.node.role !== 'user') continue;
      const measurement = measurements[renderIndex];
      if (!measurement) continue;
      const itemCenter = measurement.start + measurement.size / 2;
      const distance = Math.abs(itemCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDisplayIndex = nodeToDisplayIndex.get(item.node) ?? -1;
      }
    }
    return closestDisplayIndex;
    // virtualItems included as dependency to re-derive on scroll
  }, [virtualItems, renderItems, nodeToDisplayIndex, rowVirtualizer]);

  const [minimalActiveUserMessageIndex, setMinimalActiveUserMessageIndex] = useState(-1);

  // Minimal mode renders every turn without virtualization, so the minimap's
  // active user message comes from DOM positions instead of the virtualizer's
  // measurement cache.
  const updateMinimalActiveUserMessage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll<HTMLElement>('[data-display-index]');
    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.top + containerRect.height / 2;
    let closestIndex = -1;
    let closestDistance = Infinity;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = Number(element.dataset.displayIndex);
      }
    }
    setMinimalActiveUserMessageIndex(closestIndex);
  }, []);

  // Scroll-driven updates: stable listener, rAF-throttled so a scroll burst
  // (e.g. continuous auto-scroll pinning) costs at most one pass per frame.
  const minimalMinimapRafRef = useRef(0);
  useEffect(() => {
    if (!isMinimal) return;
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      cancelAnimationFrame(minimalMinimapRafRef.current);
      minimalMinimapRafRef.current = requestAnimationFrame(updateMinimalActiveUserMessage);
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(minimalMinimapRafRef.current);
    };
  }, [isMinimal, updateMinimalActiveUserMessage]);

  // Transcript-driven updates: a new turn mounted or content grew. Routed
  // through the same rAF throttle so a streaming delta burst costs at most
  // one layout pass per frame.
  useEffect(() => {
    if (!isMinimal) return;
    cancelAnimationFrame(minimalMinimapRafRef.current);
    minimalMinimapRafRef.current = requestAnimationFrame(updateMinimalActiveUserMessage);
  }, [isMinimal, displayNodes, updateMinimalActiveUserMessage]);

  const activeUserMessageIndex = isMinimal
    ? minimalActiveUserMessageIndex
    : virtualActiveUserMessageIndex;

  // View-mode switch swaps the content layout entirely, so a pixel scrollTop
  // (and the pin flag) carried over from the other mode is meaningless —
  // re-derive pinning from where the viewport actually landed.
  // Guarded to run only on an actual mode change: on mount the restore effect
  // owns the pin, and deriving here would clobber a restored mid-scroll
  // position (this effect runs after restore but before its rAF applies,
  // while the observer effect's mount-time scrollToBottom still has the
  // container at the bottom → isAtBottom wrongly reads true).
  const prevIsMinimalRef = useRef(isMinimal);
  useLayoutEffect(() => {
    if (prevIsMinimalRef.current === isMinimal) return;
    prevIsMinimalRef.current = isMinimal;
    // A mode switch must not be clobbered by an in-flight restore glide.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;
    clearTopPin();
    const container = containerRef.current;
    if (!container) return;

    if (isMinimal) {
      if (lastMinimalTurn && isLastMinimalTurnActive) {
        pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
        autoScrollRef.current = false;
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
        return;
      }
    }

    autoScrollRef.current = isAtBottom(container);
  }, [isLastMinimalTurnActive, isMinimal, lastMinimalTurn, pinTopToViewport]);

  // Search is unavailable in minimal mode; drop any stale search state so it
  // doesn't resurface with outdated targets when switching back.
  useEffect(() => {
    if (!isMinimal) return;
    setSearchOpen(false);
    setSearchQuery('');
    setActiveOccurrenceInfo(null);
  }, [isMinimal]);

  function clearTopPin(): void {
    pinRef.current = { phase: 'idle' };
    setTopPaddingPx(0);
  }

  const handleMinimalTurnEnd = useCallback((turnId: string) => {
    const pin = pinRef.current;
    // Pin already released (details expanded, turn ended mid-collapse).
    if (pin.phase === 'idle' || pin.turnId !== turnId) {
      setTopPaddingPx(0);
      return;
    }
    const container = containerRef.current;
    if (!container) {
      clearTopPin();
      return;
    }

    switch (pin.phase) {
      case 'scrolled':
        // User scrolled: their position wins, just drop everything.
        clearTopPin();
        return;

      case 'following': {
        // Viewport was riding content bottom. Drop spacer, stand there.
        const contentBottom =
          container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
        pinRef.current = { phase: 'idle' };
        setTopPaddingPx(0);
        container.scrollTop = contentBottom;
        autoScrollRef.current = true;
        return;
      }

      case 'pinned': {
        // Content still fits viewport. Glide to content bottom.
        const scrollContainer = container;
        pinRef.current = { phase: 'ending', turnId };
        autoScrollRef.current = false;
        const target = Math.max(
          0,
          scrollContainer.scrollHeight - topPaddingPxRef.current - scrollContainer.clientHeight,
        );
        // Use native smooth scroll (compositor-driven, jank-free).
        scrollContainer.scrollTo({ top: target, behavior: 'smooth' });
        // Clean up when the smooth scroll finishes or when user input
        // interrupts it. Cancellation preserves the user's current position
        // and disables auto-follow, but must still release ending + spacer.
        function finish(shouldAutoScroll: boolean): void {
          scrollContainer.removeEventListener('scrollend', onEnd);
          if (restoreAnimRef.current?.cancel === cancel) {
            restoreAnimRef.current = null;
          }
          if (pinRef.current.phase !== 'ending' || pinRef.current.turnId !== turnId) {
            return;
          }
          pinRef.current = { phase: 'idle' };
          setTopPaddingPx(0);
          autoScrollRef.current = shouldAutoScroll;
        }
        function onEnd(): void {
          finish(true);
        }
        function cancel(): void {
          finish(false);
        }
        scrollContainer.addEventListener('scrollend', onEnd, { once: true });
        restoreAnimRef.current = { cancel };
        return;
      }
    }
  }, []);

  function handleScrollToBottom(): void {
    const container = containerRef.current;
    if (!container) return;
    clearTopPin();
    autoScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    // Re-assert next frame in case an item measurement lands right after the
    // click and grows scrollHeight; autoScrollRef stays true so this is safe.
    requestAnimationFrame(() => {
      if (autoScrollRef.current && containerRef.current) {
        containerRef.current.scrollTop = containerRef.current.scrollHeight;
      }
    });
    setShowScrollButton(false);
  }

  const handleScrollToIndex = useCallback(
    (displayIndex: number) => {
      autoScrollRef.current = false;
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
    [isMinimal, rowVirtualizer, displayToRenderIndex],
  );

  const releaseAutoScrollPin = useCallback((isActive: boolean) => {
    const pin = pinRef.current;
    if (pin.phase !== 'idle') {
      lastPinnedTurnIdRef.current = pin.turnId;
    }
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;

    if (isActive) {
      // Preserve pinned/following/scrolled so expanded details use the same
      // fill-then-follow behavior as normal streaming output.
      return;
    }

    // Finished turn: release the pin and drop the spacer after commit.
    autoScrollRef.current = false;
    pinRef.current = { phase: 'idle' };
    expandSettlingRef.current = true;
    requestAnimationFrame(() => {
      expandSettlingRef.current = false;
      setTopPaddingPx(0);
    });
  }, []);

  // Content growth handler: transitions pinned → following when the turn's
  // content exceeds the viewport, then rides the content bottom.
  const handleOutputGrowth = useCallback((sectionHeight: number) => {
    const container = containerRef.current;
    if (!container) return;
    const pin = pinRef.current;
    if (pin.phase !== 'pinned' && pin.phase !== 'following') return;
    const exceedsViewport = sectionHeight > container.clientHeight;
    if (exceedsViewport) {
      // Transition pinned → following: content outgrew the viewport.
      // Drop the spacer (no longer needed) and ride content bottom.
      if (pin.phase === 'pinned') {
        pinRef.current = { phase: 'following', turnId: pin.turnId };
        autoScrollRef.current = true;
        setTopPaddingPx(0);
      }
      const contentBottom =
        container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
      container.scrollTop = contentBottom;
    } else if (pin.phase === 'pinned') {
      // Content still fits viewport: size the spacer so maxScroll exactly
      // equals the pinned position (user cannot scroll past the turn).
      const turnEl = container.querySelector(`[data-turn-id="${pin.turnId}"]`);
      if (turnEl) {
        const pinPosition =
          turnEl.getBoundingClientRect().top -
          container.getBoundingClientRect().top +
          container.scrollTop;
        const spacerEl = container.querySelector('[data-testid="minimal-top-padding"]');
        const actualSpacer = spacerEl ? spacerEl.getBoundingClientRect().height : 0;
        const contentHeight = container.scrollHeight - actualSpacer;
        const ideal = Math.max(0, pinPosition + container.clientHeight - contentHeight);
        if (Math.abs(actualSpacer - ideal) > 1) {
          setTopPaddingPx(ideal);
        }
      }
    }
  }, []);

  const handleCollapseChange = useCallback((isCollapsing: boolean) => {
    // The collapse animation owns the viewport for its whole duration:
    // stand the auto-scroll ResizeObserver down and drop the auto-scroll
    // flag (the commit that starts the animation would otherwise scroll the
    // viewport to the bottom, then the fold would fight it). On end, let
    // the observer resume next frame (after the collapsed layout has
    // committed, so its mount cannot fight the animation).
    if (isCollapsing) {
      expandSettlingRef.current = true;
      autoScrollRef.current = false;
    } else {
      requestAnimationFrame(() => {
        expandSettlingRef.current = false;
      });
    }
  }, []);

  // Re-pin on collapse of active turn's details.
  const handleCollapseDetails = useCallback(
    (isActive: boolean) => {
      if (!isActive) return;
      const turnId = lastPinnedTurnIdRef.current;
      if (!turnId) return;
      pinRef.current = { phase: 'pinned', turnId };
      autoScrollRef.current = false;
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
      }
    },
    [pinTopToViewport],
  );

  const toggleGroupExpand = useCallback((groupId: string) => {
    autoScrollRef.current = false;
    setExpandedGroupIds((prev) => {
      const next = new Set(prev);
      if (next.has(groupId)) {
        next.delete(groupId);
      } else {
        next.add(groupId);
      }
      return next;
    });
  }, []);

  const handleSearchJump = useCallback(
    (result: OccurrenceResult): void => {
      const target = result.target;
      autoScrollRef.current = false;
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
    [rowVirtualizer],
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
  }, [activeOccurrenceInfo, searchQuery]);

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

/** Height estimates for collapsed read-only group */
const COLLAPSED_GROUP_TRIGGER_HEIGHT = 28;
const COLLAPSED_GROUP_COMMAND_LINE_HEIGHT = 16;

function estimateRenderItemHeight(item: RenderItem | undefined): number {
  if (!item) return 96;
  if (item.type === 'readGroup') {
    return (
      COLLAPSED_GROUP_TRIGGER_HEIGHT + item.entries.length * COLLAPSED_GROUP_COMMAND_LINE_HEIGHT
    );
  }
  return estimateNodeHeight(item.node);
}

function estimateNodeHeight(node: TranscriptNode | undefined): number {
  if (!node) {
    return 96;
  }
  switch (node.role) {
    case 'user':
      return estimateUserHeight(node.text);
    case 'assistant':
      return estimateAssistantHeight(node);
    case 'tool':
      return estimateToolHeight(node);
    case 'system':
      return 56;
  }
}

/** Animates scrollTop toward target on the app-wide motion curve, returning
 *  a cancel handle (the user's own scroll must always win). */

function isAtBottom(container: HTMLDivElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    AUTO_SCROLL_BOTTOM_THRESHOLD
  );
}

function estimateUserHeight(text: string): number {
  if (parseSkillBlock(text)) {
    return 88;
  }
  const visibleLineCount = countLines(text);
  const characterLineCount = Math.ceil(text.length / USER_MESSAGE_WRAP_ESTIMATE_WIDTH);
  const estimatedLineCount = Math.max(visibleLineCount, characterLineCount);
  const rawHeight =
    estimatedLineCount * 24 +
    20 +
    USER_MESSAGE_TOOLBAR_HEIGHT +
    USER_MESSAGE_LEADING_PADDING +
    USER_MESSAGE_TRAILING_PADDING;
  return Math.max(56, Math.min(rawHeight, USER_MESSAGE_MAX_ESTIMATE_HEIGHT));
}

function estimateAssistantHeight(node: AssistantNode): number {
  const thinkingLineCap = Math.ceil(BLOCK_CONTENT_MAX_HEIGHT / 20) + 4; // lines + header slack
  const thinkingLineCount = Math.min(countLines(node.thinking), thinkingLineCap);
  const textLength = node.text.length + Math.min(node.thinking.length, thinkingLineCap * 84);
  const lineCount = countLines(node.text) + thinkingLineCount;
  return Math.max(80, Math.max(Math.ceil(textLength / 84), lineCount) * 24 + 56);
}

function estimateToolHeight(node: ToolNode): number {
  const outputLineCount = node.output ? node.output.split('\n').length : 0;
  const commandLineCount = estimateToolCommandLineCount(node);
  const contentHeight = outputLineCount * 20;
  const cappedContentHeight = Math.min(contentHeight, BLOCK_CONTENT_MAX_HEIGHT);

  return Math.max(
    96,
    commandLineCount * 24 +
      cappedContentHeight +
      TOOL_STATUS_LINE_ESTIMATE_HEIGHT +
      TOOL_BLOCK_ESTIMATE_BUFFER,
  );
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

function estimateToolCommandLineCount(node: ToolNode): number {
  const args = getToolArgs(node);
  const command =
    node.name === 'bash'
      ? `$ ${String(args?.command ?? '')}`
      : node.name === 'read' || node.name === 'write' || node.name === 'edit'
        ? `${node.name} ${String(args?.path ?? '')}`
        : String(JSON.stringify(args ?? {}) ?? '');

  return Math.min(2, Math.max(1, Math.ceil(command.length / 80)));
}

// Memoized so that virtualizer-driven re-renders (e.g. while the bottom terminal
// panel animates open/close and the scroll container resizes every frame) skip
// re-rendering rows whose props are unchanged, instead of reconciling every
// visible markdown/tool tree on each frame.
const RenderItemRenderer = React.memo(function RenderItemRenderer({
  item,
  isLast,
  sessionActive,
  searchQuery,
  expanded,
  onToggleExpand,
  activeOccurrenceItemId,
  activeOccurrenceToolNodeId,
  activeOccurrenceIndex,
}: {
  item: RenderItem;
  isLast: boolean;
  sessionActive: boolean;
  searchQuery: string;
  expanded?: boolean;
  onToggleExpand?: () => void;
  activeOccurrenceItemId: string | null;
  activeOccurrenceToolNodeId: string | null;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  const activeIndex = item.id === activeOccurrenceItemId ? activeOccurrenceIndex : null;
  const activeToolNodeId = item.id === activeOccurrenceItemId ? activeOccurrenceToolNodeId : null;
  if (item.type === 'readGroup') {
    return (
      <CollapsedReadGroup
        entries={item.entries}
        isActive={isLast && sessionActive}
        open={expanded ?? false}
        onOpenChange={onToggleExpand ?? (() => {})}
        searchQuery={searchQuery}
        activeToolNodeId={activeToolNodeId}
        activeOccurrenceIndex={activeIndex}
      />
    );
  }
  return (
    <NodeRenderer node={item.node} searchQuery={searchQuery} activeOccurrenceIndex={activeIndex} />
  );
});

function NodeRenderer({
  node,
  searchQuery,
  activeOccurrenceIndex,
}: {
  node: TranscriptNode;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return (
        <UserBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'assistant':
      return (
        <AssistantBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'tool':
      return (
        <ToolBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'system':
      return (
        <SystemBubble
          text={node.text}
          isLoading={node.isLoading}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
  }
}

function ToolBubble({
  node,
  searchQuery,
  activeOccurrenceIndex,
}: {
  node: ToolNode;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useHighlightTextNodes(containerRef, searchQuery, activeOccurrenceIndex);

  return (
    <div ref={containerRef} className="group">
      <ToolBlock node={node} />
      <MessageToolbar text={node.output} />
    </div>
  );
}

function AssistantBubble({
  node,
  searchQuery,
  activeOccurrenceIndex,
}: {
  node: AssistantNode;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  const showThinking = node.thinking.length > 0;
  const showText = node.text.length > 0;
  const contentRef = useRef<HTMLDivElement>(null);

  useHighlightTextNodes(contentRef, searchQuery, activeOccurrenceIndex);

  return (
    <div className="group flex justify-start" data-testid="assistant-message">
      <div
        ref={contentRef}
        className="w-full min-w-0 text-[15px] text-foreground"
        style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      >
        {showThinking && (
          <ThinkingBlock
            text={node.thinking}
            startedAt={node.thinkingStartedAt}
            endedAt={node.thinkingEndedAt}
            isStreaming={node.isStreaming}
          />
        )}

        {showText && (
          <div style={{ marginTop: showThinking ? `${MESSAGE_ROW_GAP}px` : undefined }}>
            <MarkdownMessage text={node.text} />
          </div>
        )}

        {node.errorMessage && (
          <div className="mt-3 w-fit rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
            {node.errorMessage}
          </div>
        )}

        <MessageToolbar text={node.text || node.thinking} />
      </div>
    </div>
  );
}
