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
import { terminalInOutEase } from '../lib/easing';
import MessageSearch, { type MessageSearchTarget, type OccurrenceResult } from './MessageSearch';
import { useHighlightTextNodes, findOccurrenceRanges } from '../lib/highlightMatches';
import { buildRenderItems, type RenderItem } from '../lib/readGrouping';
import ThinkingBlock from './thinkingBlock';
import { MessageToolbar, SystemBubble, UserBubble } from './messageBubbles';
import { parseSkillBlock } from '../lib/skillBlock';
import MinimalView from './minimalView';

interface MessageListProps {
  nodes: TranscriptNode[];
  sessionPath: string;
}

function isRenderableNode(node: TranscriptNode): boolean {
  if (node.role !== 'assistant') return true;
  return Boolean(node.text || node.thinking || node.errorMessage);
}

const AUTO_SCROLL_BOTTOM_THRESHOLD = 2;
const SCROLL_BUTTON_VIEWPORT_MULTIPLIER = 2;
/** Restore animation for the minimal view's top-pin release: a slow,
 *  deliberate settle on the on-screen movement curve (ease-in-out) — quick
 *  acceleration, cruise, short deceleration — so a long scroll ends crisply
 *  instead of creeping through the last quarter of its distance. */
const RESTORE_LAYOUT_MS = 500;
const TOOL_BLOCK_ESTIMATE_BUFFER = 24;
const TOOL_STATUS_LINE_ESTIMATE_HEIGHT = 24;
const USER_MESSAGE_TOOLBAR_HEIGHT = 24;
const USER_MESSAGE_LEADING_PADDING = 24;
const USER_MESSAGE_TRAILING_PADDING = 8;
const USER_MESSAGE_WRAP_ESTIMATE_WIDTH = 72;
/** Max estimated height for user bubbles capped by max-h-[40vh] CSS */
const USER_MESSAGE_MAX_ESTIMATE_HEIGHT = 400;

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
  // Minimal mode: the turn whose top edge is pinned to the top of the
  // viewport (set when a new user message arrives, cleared the moment the
  // user scrolls or the view/session changes).
  const pinTopTurnIdRef = useRef<string | null>(null);
  // The turn that was pinned before details expanded (or the pin was
  // released for another reason) — collapsing details while the turn is
  // still running re-pins this turn.
  const lastPinnedTurnIdRef = useRef<string | null>(null);
  // In-flight layout-restore animation (cancelled the moment the user
  // scrolls, so their position is never yanked back).
  const restoreAnimRef = useRef<{ cancel: () => void } | null>(null);
  // Set when the user wheels while a minimal turn is pinned: at turn end the
  // restore glide is skipped (the user's scroll intent wins — they have
  // moved to read something else, so the view must not glide away). Reset
  // each time a new turn gets pinned.
  const userScrolledDuringPinRef = useRef(false);
  const lastNodeIdRef = useRef<string | null>(null);
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
  });

  // Always disable the virtualizer's built-in scroll correction. Auto-scroll
  // pinning is owned exclusively by the ResizeObserver pin + the
  // useLayoutEffect below, both of which target the real DOM scrollHeight. The
  // virtualizer's correction (resizeItem -> scrollTo(modelOffset + delta))
  // uses the virtualizer's OWN coordinate model, which is gapless (the row gap
  // is applied as CSS marginBottom, invisible to measurements) while
  // scrollHeight includes those gaps — so its target is never the true bottom.
  rowVirtualizer.shouldAdjustScrollPositionOnItemSizeChange = () => false;

  // Minimal-mode top pin: the working area of the running turn is glued to
  // the viewport top with open space below it. That open space is rendered
  // as a real spacer row (see the minimal branch below) whose height lives
  // in React state — it is part of the render tree, so minimap jumps, view
  // switches, session switches and streaming commits can never lose it the
  // way a DOM style side-effect could; it simply re-renders wherever the
  // content does. All padding mutations (pin, spacer release) go through
  // setTopPaddingPx.
  const [topPaddingPx, setTopPaddingPx] = useState(0);
  // Mirror for callbacks that must read the latest value without re-running
  // (handleMinimalTurnEnd / handleOutputGrowth are stable useCallbacks).
  const topPaddingPxRef = useRef(0);
  useEffect(() => {
    topPaddingPxRef.current = topPaddingPx;
  }, [topPaddingPx]);

  // Resume auto-scroll when a new user message appears. In minimal mode a
  // new turn instead pins its TOP edge to the top of the viewport: the work
  // area gets the whole window as its canvas and grows downward. While the
  // pin is active a viewport-height spacer row renders below the content —
  // without it the browser clamps scrollTop once the turn is shorter than
  // the viewport, and the turn can never reach the top. The ResizeObserver
  // below re-asserts the pin as content grows. Any user scroll, the
  // scroll-to-bottom button, or a view/session switch cancels the pin and
  // removes the spacer.
  useLayoutEffect(() => {
    const lastNode = displayNodes[displayNodes.length - 1];
    if (lastNode?.id !== lastNodeIdRef.current && lastNode?.role === 'user') {
      if (isMinimal) {
        pinTopTurnIdRef.current = lastNode.id;
        userScrolledDuringPinRef.current = false;
        autoScrollRef.current = false;
        const container = containerRef.current;
        if (container) {
          setTopPaddingPx(container.clientHeight);
        }
      } else {
        autoScrollRef.current = true;
      }
    }
    lastNodeIdRef.current = lastNode?.id ?? null;
  }, [displayNodes, isMinimal]);

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
  //   the right frame but targets its own gapless coordinate model (the row
  //   gap is CSS marginBottom, invisible to measurements) instead of the real
  //   DOM scrollHeight, causing a low-amplitude high-frequency vibration.
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
  // Pinned turn lookup: the turn whose top edge stays glued to the
  // viewport top while it grows (see pinTopTurnIdRef).
  const findPinnedTurn = useCallback((): HTMLElement | null => {
    const targetId = pinTopTurnIdRef.current;
    if (targetId === null) return null;
    const current = containerRef.current;
    if (!current) return null;
    for (const element of current.querySelectorAll('[data-turn-id]')) {
      if (element.getAttribute('data-turn-id') === targetId) {
        return element as HTMLElement;
      }
    }
    return null;
  }, []);

  // Re-glues the pinned turn's top edge to the viewport top (call after
  // content grew or a pin was (re-)established).
  const pinTopToViewport = useCallback(() => {
    const turnEl = findPinnedTurn();
    const container = containerRef.current;
    if (!turnEl || !container) return;
    container.scrollTop =
      turnEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
  }, [findPinnedTurn]);

  // DOM fallback for the re-pin: the transcript (and session status) can
  // still be mid-load right after a session switch, so the node-based
  // running-turn check may miss a turn that is about to resume. Poll for the
  // working timer instead. Deliberately NOT tied to the restore effect's
  // cleanup — that effect re-runs on every streaming commit (its cleanup
  // would kill the pending retry), so the retry chain manages itself and
  // stops when it finds the timer (or exhausts its attempts).
  const retryPinTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const retryPinAttemptRef = useRef(0);
  const scheduleRetryPin = useCallback(() => {
    if (retryPinTimerRef.current) return;
    retryPinTimerRef.current = setTimeout(() => {
      retryPinTimerRef.current = null;
      const container = containerRef.current;
      if (!container) return;
      const workingTimers = container.querySelectorAll(
        '[data-testid=minimal-working-timer][data-active="true"]',
      );
      // The last active timer is the turn that is actually running now — a
      // replay can light up several, but only the newest is the live one.
      const workingTimer = workingTimers[workingTimers.length - 1];
      const turnEl = workingTimer?.closest<HTMLElement>('[data-turn-id]');
      if (workingTimer && turnEl) {
        pinTopTurnIdRef.current = turnEl.dataset.turnId ?? null;
        userScrolledDuringPinRef.current = false;
        autoScrollRef.current = false;
        const container = containerRef.current;
        if (container) {
          setTopPaddingPx(container.clientHeight);
          pinTopToViewport();
          // The transcript may still be replaying (heights settling), so the
          // turn's position measured now can be stale — re-glue it after the
          // layout has had a frame to settle.
          requestAnimationFrame(() => {
            if (pinTopTurnIdRef.current !== null) pinTopToViewport();
          });
        }
        retryPinAttemptRef.current = 0;
        return;
      }
      retryPinAttemptRef.current += 1;
      // The transcript replay can take a couple of seconds; keep polling
      // well past it (the chain stops on its own once a working turn is
      // found, and never runs when no turn is running at all).
      if (retryPinAttemptRef.current <= 20) {
        scheduleRetryPin();
      }
    }, 250);
  }, [pinTopToViewport]);

  useEffect(() => {
    const container = containerRef.current;
    const rowsWrapper = rowsWrapperRef.current;
    if (!container || !rowsWrapper) return;

    // Pinned turn lookup: the turn whose top edge stays glued to the
    // viewport top while it grows (see pinTopTurnIdRef).
    function findPinnedTurn(): HTMLElement | null {
      const targetId = pinTopTurnIdRef.current;
      if (targetId === null) return null;
      const current = containerRef.current;
      if (!current) return null;
      for (const element of current.querySelectorAll('[data-turn-id]')) {
        if (element.getAttribute('data-turn-id') === targetId) {
          return element as HTMLElement;
        }
      }
      return null;
    }

    function scrollToBottom(): void {
      if (!autoScrollRef.current) return;
      container!.scrollTop = container!.scrollHeight;
    }

    function pinTopToViewport(): void {
      const turnEl = findPinnedTurn();
      if (!turnEl) return;
      container!.scrollTop =
        turnEl.getBoundingClientRect().top -
        container!.getBoundingClientRect().top +
        container!.scrollTop;
    }

    // The transcript replay after a session switch can momentarily light up
    // working timers on turns that have already finished (or that vanish
    // once the replay settles), so a retry may pin the wrong turn. Verify
    // the pinned turn still exists and is still working before gluing it to
    // the top; otherwise drop the pin and let the retry chain find the turn
    // that is actually running.
    // A just-finished turn keeps its pin while its final message (summary)
    // renders in the current-message slot — without this the moment the
    // turn ends the observer would drop the pin and the layout would jump
    // into document flow mid-stream (MessageList's turn-end handler glides
    // the view instead).
    // The viewport is free while the user scrolled during the pin or the
    // follow rides the output past the viewport: re-glueing the turn
    // to the top would fight the follow (and yank the user back).
    function pinVerifiedOrRepin(): void {
      if (userScrolledDuringPinRef.current || followEndRef.current) return;
      const turnEl = findPinnedTurn();
      const stillWorking =
        turnEl?.querySelector('[data-testid=minimal-working-timer][data-active="true"]') != null;
      const hasMessage = turnEl?.querySelector('[data-testid=minimal-current-msg]') != null;
      if (!turnEl || (!stillWorking && !hasMessage)) {
        pinTopTurnIdRef.current = null;
        clearTopPin();
        retryPinAttemptRef.current = 0;
        scheduleRetryPin();
        return;
      }
      pinTopToViewport();
    }

    const rowsWrapperRo = new ResizeObserver(() => {
      if (expandSettlingRef.current) return;
      if (pinTopTurnIdRef.current !== null) {
        pinVerifiedOrRepin();
      } else {
        scrollToBottom();
      }
    });
    rowsWrapperRo.observe(rowsWrapper);

    const containerRo = new ResizeObserver(() => {
      if (expandSettlingRef.current) return;
      if (pinTopTurnIdRef.current !== null) {
        pinVerifiedOrRepin();
      } else {
        scrollToBottom();
      }
      setContainerWidth(container!.clientWidth);
    });
    containerRo.observe(container);
    setContainerWidth(container.clientWidth);

    function handleWheel(event: WheelEvent): void {
      // A mid-flight restore animation must not fight the user's scroll.
      restoreAnimRef.current?.cancel();
      restoreAnimRef.current = null;
      // NOTE: no clearTopPin() here — while a minimal turn is pinned (i.e.
      // until its summary has fully appeared) the working area must keep its
      // padding and stay reachable at the top; a user scroll glides away but
      // the next content change re-pins the turn. The pin only ends when the
      // turn finishes, the details are expanded, the scroll-to-bottom button
      // is used, or the view/session changes. The flag below only cancels
      // the end-of-turn glide, never the pin itself.
      if (pinTopTurnIdRef.current !== null) {
        userScrolledDuringPinRef.current = true;
        // A user scroll also releases the summary end-follow (the follow
        // re-engages only when the viewport returns to the bottom, like a
        // normal message's auto-scroll).
        followEndRef.current = false;
      }
      if (event.deltaY < 0) {
        autoScrollRef.current = false;
      } else if (event.deltaY > 0 && !autoScrollRef.current && isAtBottom(container!)) {
        autoScrollRef.current = true;
      }
    }

    function handleScroll(): void {
      const distanceFromBottom =
        container!.scrollHeight - container!.scrollTop - container!.clientHeight;
      setShowScrollButton(
        distanceFromBottom > container!.clientHeight * SCROLL_BUTTON_VIEWPORT_MULTIPLIER,
      );
    }

    container.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    scrollToBottom();

    return () => {
      rowsWrapperRo.disconnect();
      containerRo.disconnect();
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('scroll', handleScroll);
    };
  }, [isMinimal, scheduleRetryPin]);

  // Save scroll position to store on every scroll event.
  // If user is at the bottom, save sentinel -1 so restore knows to auto-scroll.
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionPath) return;

    function savePosition(): void {
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
  const prevSessionPathRef = useRef(sessionPath);
  useEffect(() => {
    if (prevSessionPathRef.current === sessionPath) return;
    prevSessionPathRef.current = sessionPath;
    let cancelled = false;

    // Re-pin a still-running minimal turn: switching away and back while a
    // turn executes must keep the working area pinned (padding and all). A
    // running turn ends with an assistant node still streaming, so accept
    // either the bare user node (nothing streamed yet) or a live assistant
    // node.
    const lastNode = displayNodes[displayNodes.length - 1];
    const hasRunningTurn =
      lastNode?.role === 'user' || (lastNode?.role === 'assistant' && sessionStatus !== 'idle');
    if (isMinimal && hasRunningTurn) {
      pinTopTurnIdRef.current = lastNode.id;
      userScrolledDuringPinRef.current = false;
      autoScrollRef.current = false;
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
      }
      // A running turn takes over the viewport: skip the saved-position
      // restore entirely (it would override the re-pin).
      return () => {
        cancelled = true;
      };
    }
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;
    clearTopPin();
    // The node check above may have missed a turn that is about to resume
    // (transcript still loading, agent not resumed yet): keep polling the
    // DOM for its working timer.
    retryPinAttemptRef.current = 0;
    scheduleRetryPin();

    const savedPosition = sessionPath
      ? useAppStore.getState().scrollPositions.get(sessionPath)
      : undefined;

    if (savedPosition === -1) {
      // Was at bottom: let ResizeObserver handle it
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (!cancelled && containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
        }
      });
    } else if (savedPosition !== undefined) {
      autoScrollRef.current = false;
      requestAnimationFrame(() => {
        if (!cancelled && containerRef.current) {
          containerRef.current.scrollTop = savedPosition;
        }
      });
    } else {
      autoScrollRef.current = true;
    }

    return () => {
      cancelled = true;
    };
  }, [displayNodes, isMinimal, pinTopToViewport, scheduleRetryPin, sessionPath, sessionStatus]);

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
  useEffect(() => {
    if (prevIsMinimalRef.current === isMinimal) return;
    prevIsMinimalRef.current = isMinimal;
    // A mode switch must not be clobbered by an in-flight restore glide.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;
    clearTopPin();
    const container = containerRef.current;
    if (!container) return;
    autoScrollRef.current = isAtBottom(container);
  }, [isMinimal]);

  // Search is unavailable in minimal mode; drop any stale search state so it
  // doesn't resurface with outdated targets when switching back.
  useEffect(() => {
    if (!isMinimal) return;
    setSearchOpen(false);
    setSearchQuery('');
    setActiveOccurrenceInfo(null);
  }, [isMinimal]);

  // Cancel the minimal-mode top pin: stop gluing the turn to the viewport
  // top and drop the viewport-height spacer row that let it scroll up there.
  function clearTopPin(): void {
    pinTopTurnIdRef.current = null;
    setTopPaddingPx(0);
  }

  // When the pinned turn finishes, the layout restores immediately — glide
  // scrollTop to the post-padding bottom position while the summary streams
  // in there (like a normal message produced at the bottom of the list), then
  // drop the spacer row — the target equals the new max scrollTop, so
  // nothing jumps. If the user scrolled during the pin, their position
  // wins and the pin is dropped in place without gliding.
  const handleMinimalTurnEnd = useCallback((turnId: string) => {
    if (pinTopTurnIdRef.current !== turnId) {
      // The pin was already released (details expanded, or the turn ended
      // mid-collapse): there is nothing to glide — but a spacer that was
      // re-fit/filled for the expanded view must not linger under the
      // collapsed turn as dead space.
      setTopPaddingPx(0);
      return;
    }
    if (userScrolledDuringPinRef.current) {
      // The user scrolled while the pin was held: their position wins —
      // drop the pin and spacer without gliding anywhere.
      followEndRef.current = false;
      pinTopTurnIdRef.current = null;
      setTopPaddingPx(0);
      return;
    }
    pinTopTurnIdRef.current = null;
    const container = containerRef.current;
    if (!container) return;
    // The viewport was already riding the turn's output (the section
    // outgrew the viewport while the agent was still working): the user is
    // reading at the content bottom. Release the spacer and stand exactly
    // there — the spacer lives below the content, so removing it leaves the
    // viewport position untouched (no glide, no jump).
    if (followEndRef.current) {
      followEndRef.current = false;
      autoScrollRef.current = true;
      const contentBottom =
        container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
      setTopPaddingPx(0);
      container.scrollTop = contentBottom;
      return;
    }
    // The final message (summary) already sits in the current-message slot,
    // so the spacer is still full — the glide target is the content bottom
    // (spacer excluded; releasing the spacer later lands the viewport at the
    // exact same position).
    autoScrollRef.current = false;
    const target = Math.max(
      0,
      container.scrollHeight - topPaddingPxRef.current - container.clientHeight,
    );
    let cancelled = false;
    const { promise, cancel } = animateScrollTop(container, target, RESTORE_LAYOUT_MS);
    restoreAnimRef.current = {
      cancel: () => {
        cancelled = true;
        cancel();
      },
    };
    void promise.then(() => {
      restoreAnimRef.current = null;
      setTopPaddingPx(0);
      // Re-assert the true bottom (the spacer release made it the new
      // maxScroll); skipped when the user took over scrolling mid-flight.
      if (!cancelled) {
        autoScrollRef.current = true;
        container.scrollTop = container.scrollHeight;
      }
    });
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
    autoScrollRef.current = false;
    // Remember which turn was pinned so collapsing details can re-pin it
    // while the turn keeps running — but only when there IS a pinned turn:
    // a collapse click also reaches here (handleToggleDetails calls this
    // unconditionally) with the pin already released, and overwriting with
    // null would lose the target we need to restore.
    if (pinTopTurnIdRef.current !== null) {
      lastPinnedTurnIdRef.current = pinTopTurnIdRef.current;
    }
    // Expanding details must also drop the minimal-mode top pin (or the
    // ResizeObserver would glue the turn back to the viewport top and
    // defeat the expand-time scroll). The viewport-height padding stays in
    // place for now: dropping it before React's commit would shrink the
    // scroll range while the details are still closed, and the browser
    // would clamp scrollTop — yanking the working header down even for a
    // short expansion. It is re-fit (or dropped) after the commit below.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;
    pinTopTurnIdRef.current = null;
    // Expanding while the turn is still running: the newest activity is what
    // the user is about to read, so the viewport lands on the bottom of the
    // expanded details — not the bottom of the whole list (the header would
    // be yanked to wherever it sits in the document flow, even for a short
    // expansion). Runs after React's commit (details mounted, padding still
    // holding the scroll range open): the padding is then re-fit to fill
    // only what the details do not cover — a short expansion keeps the
    // working header glued exactly where it was, a long one leaves no
    // padding and just rolls to the details bottom.
    if (isActive) {
      autoScrollRef.current = true;
      expandSettlingRef.current = true;
      requestAnimationFrame(() => {
        const c = containerRef.current;
        const wrapper = rowsWrapperRef.current;
        expandSettlingRef.current = false;
        if (!c || !wrapper) return;
        const details = c.querySelector('[data-testid=minimal-details]');
        if (!details) return;
        // Mounting the details would trigger the auto-scroll ResizeObserver
        // before this frame (padding still in place, so it would scroll to
        // the old bottom) — the settling flag above kept it standing down.
        const containerRect = c.getBoundingClientRect();
        const detailsRect = details.getBoundingClientRect();
        // Scroll before re-fitting the padding: shrinking the padding clamps
        // an over-long scrollTop back to the new bottom, which would cancel
        // the roll below. Rolling first lands the details bottom exactly on
        // the viewport edge, then the padding re-fit cannot clamp it (the
        // new bottom equals that scroll position).
        if (detailsRect.bottom > containerRect.bottom) {
          c.scrollTop += detailsRect.bottom - containerRect.bottom;
        }
        const fill = Math.max(0, containerRect.height - (detailsRect.bottom - containerRect.top));
        setTopPaddingPx(fill);
      });
    } else {
      // A finished turn expands without moving the viewport: drop the pin
      // spacer after the commit — it still held the scroll range open, so
      // nothing clamps mid-transition.
      expandSettlingRef.current = true;
      requestAnimationFrame(() => {
        expandSettlingRef.current = false;
        setTopPaddingPx(0);
      });
    }
  }, []);

  const followEndRef = useRef(false);
  // While a turn is active its content (the intro streaming in) grows below
  // the pinned working area. Once the section is taller than the viewport,
  // follow the output like a normal message at the bottom of the list: the
  // pin stays armed (spacer intact, so nothing jumps when the turn ends) but
  // the viewport rides the growing content. A user scroll releases the
  // follow; scrolling back to the bottom re-engages it.
  const handleOutputGrowth = useCallback((sectionHeight: number) => {
    const container = containerRef.current;
    if (!container) return;
    const exceedsViewport = sectionHeight > container.clientHeight;
    // The follow target is the CONTENT bottom, not the document bottom: the
    // pin's spacer (a viewport-height blank row) sits below the content, so
    // the document bottom is a full viewport of white space — gluing the
    // viewport there would show a blank page. Aligning the viewport bottom
    // with the content bottom shows the growing output exactly like a
    // normal message list; and when the spacer is released at turn end that
    // position happens to equal the new maxScroll, so nothing jumps.
    const contentBottom = container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
    const atContentBottom =
      Math.abs(container.scrollTop - contentBottom) < AUTO_SCROLL_BOTTOM_THRESHOLD;
    followEndRef.current =
      exceedsViewport &&
      (followEndRef.current || !userScrolledDuringPinRef.current || atContentBottom);
    if (followEndRef.current && container.scrollTop < contentBottom) {
      container.scrollTop = contentBottom;
    }
  }, []);

  // The collapse animation's fold grows the spacer back (the details fold
  // away by exactly the same height, so the list bottom never rises into the
  // viewport). The fold drives the height frame by frame through this
  // callback — state, so the spacer row re-renders with the fold.
  const handleCollapseFill = useCallback((paddingPx: number) => {
    setTopPaddingPx(paddingPx);
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

  // Details collapsed while the turn is still running: the working area must
  // go back to being pinned to the viewport top (viewport-height padding and
  // all) — the pin was only dropped so the expanded details could be read.
  const handleCollapseDetails = useCallback(
    (isActive: boolean) => {
      if (!isActive) return;
      const turnId = lastPinnedTurnIdRef.current;
      if (!turnId) return;
      pinTopTurnIdRef.current = turnId;
      userScrolledDuringPinRef.current = false;
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
                onCollapseFill={handleCollapseFill}
                topPaddingPx={topPaddingPx}
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
function animateScrollTop(
  container: HTMLElement,
  target: number,
  durationMs: number,
): { promise: Promise<void>; cancel: () => void } {
  const start = container.scrollTop;
  const delta = target - start;
  let raf = 0;
  let cancelled = false;
  let resolvePromise: () => void = () => {};
  const promise = new Promise<void>((resolve) => {
    resolvePromise = resolve;
  });
  if (Math.abs(delta) < 1 || window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
    container.scrollTop = target;
    resolvePromise();
    return { promise, cancel: () => {} };
  }
  const startAt = performance.now();
  const tick = (now: number): void => {
    if (cancelled) {
      resolvePromise();
      return;
    }
    const progress = Math.min(1, (now - startAt) / durationMs);
    const eased = terminalInOutEase(progress);
    container.scrollTop = start + delta * eased;
    if (progress < 1) {
      raf = requestAnimationFrame(tick);
    } else {
      resolvePromise();
    }
  };
  raf = requestAnimationFrame(tick);
  return {
    promise,
    cancel: () => {
      cancelled = true;
      cancelAnimationFrame(raf);
      resolvePromise();
    },
  };
}

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
    32 +
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
