import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { IconChevronRight } from '@tabler/icons-react';
import {
  type AgentStatus,
  type AssistantNode,
  type ToolNode,
  type TranscriptNode,
} from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH } from '../lib/layoutConstants';
import {
  analyzeTurn,
  buildTurns,
  formatWorkingDuration,
  shouldShowTimer,
  type MinimalTurn,
  type MinimalTurnAnalysis,
  type MinimalTurnItem,
} from '../lib/minimalTurns';
import MarkdownMessage from './markdownMessage';
import ToolBlock from './ToolBlock';
import ThinkingBlock from './thinkingBlock';
import { SystemBubble, UserBubble } from './messageBubbles';
import { getToolCommandParts } from '../lib/toolDisplay';
import { terminalEase } from '../lib/easing';
import ShimmerOverlay, {
  SHIMMER_BAND_WIDTH_PX,
  SHIMMER_SPEED_PX_PER_SECOND,
} from './shimmerOverlay';
import { cn } from '../lib/utils';

/**
 * MinimalView - minimal/codex-style activity view.
 *
 * This component is content only: it renders inside MessageList's scroll
 * container, which owns auto-scroll pinning, scroll-position restore, and the
 * user-message minimap for every view mode.
 *
 * Each user message starts a turn: the agent's first text message (intro) is
 * rendered at the top, followed by a "Working for Xm Ys" timer and a divider.
 * Below them sits the activity feed: the turn's recent activities (tools,
 * thinking, narration), at most MAX_ACTIVITY_ROWS rows, each guaranteed
 * MIN_ACTIVITY_VISIBLE_MS of visibility before being replaced. The feed is
 * event-driven and never queues — during a burst faster than the eye can
 * follow, only the latest pending arrival survives (middle ones drop), so
 * the display can never lag behind reality. The turn ends with the agent's
 * final text message (summary), rendered without its thinking.
 */

interface MinimalViewProps {
  nodes: TranscriptNode[];
  sessionStatus: AgentStatus;
  /** Called when the user expands/collapses a turn's details — MessageList
   *  uses it to release the auto-scroll pin so the viewport stays put. The
   *  argument says whether the turn is still running (expanding a running
   *  turn lands on the bottom of the list). */
  onExpandDetails: (isActive: boolean) => void;
  /** Called when a turn finishes (its activity area collapses) — MessageList
   *  uses it to release the top pin and its viewport-height padding. */
  onTurnEnd?: (turnId: string) => void;
  /** Called when expanded details collapse while the turn is still running —
   *  MessageList re-pins the working area (the pin was only dropped so the
   *  details could be read). */
  onCollapseDetails?: (isActive: boolean) => void;
  /** Called when the collapse animation starts (isCollapsing=true) and ends
   *  (false) — MessageList stands its auto-scroll ResizeObserver down for the
   *  animation's duration (its scrollToBottom would fight the fold), drops
   *  the auto-scroll flag on start, and re-arms both on end. The single
   *  callback structurally pairs start and end, so every exit path (finish,
   *  cleanup, fallback) re-arms the observers. */
  onCollapseChange?: (isCollapsing: boolean) => void;
  /** Reports the revealer's current height while a finished turn's summary
   *  streams in — MessageList shrinks the pin's padding by that height, so
   *  the text replaces the open space and nothing jumps. */
  onSummaryGrowth?: (height: number) => void;
  /** The rows wrapper (MessageList's padding target): the active-turn
   *  collapse grows the padding back to the viewport height while the
   *  details fold, so the list bottom never rises into the viewport. */
  rowsWrapperRef?: React.RefObject<HTMLDivElement | null>;
  /** The message list scroll container: the details-collapse animation
   *  follows it so the sticky header stays glued to the top of the list
   *  while the details fold up beneath it. */
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}

export default function MinimalView({
  nodes,
  sessionStatus,
  onExpandDetails,
  onTurnEnd,
  onCollapseDetails,
  onCollapseChange,
  onSummaryGrowth,
  rowsWrapperRef,
  scrollContainerRef,
}: MinimalViewProps): React.JSX.Element {
  const turns = useMemo(() => buildTurns(nodes), [nodes]);
  const analyses = useMemo(
    () => turns.map((turn, index) => analyzeTurn(turn, sessionStatus, index === turns.length - 1)),
    [turns, sessionStatus],
  );

  return (
    <div data-testid="minimal-view">
      {turns.map((turn, index) => (
        <TurnSection
          key={turn.id}
          turn={turn}
          analysis={analyses[index]}
          onExpandDetails={onExpandDetails}
          onTurnEnd={onTurnEnd}
          onCollapseDetails={onCollapseDetails}
          onCollapseChange={onCollapseChange}
          onSummaryGrowth={onSummaryGrowth}
          rowsWrapperRef={rowsWrapperRef}
          scrollContainerRef={scrollContainerRef}
        />
      ))}
    </div>
  );
}

/** Each feed row stays visible at least this long before being replaced —
 *  rapid tool bursts otherwise flicker past faster than they can be read. */
const MIN_ACTIVITY_VISIBLE_MS = 1000;
/** The feed holds at most this many rows. */
const MAX_ACTIVITY_ROWS = 1;
/** Details collapse animation: exactly the terminal panel's close rhythm
 *  (240ms on the shared cubic-bezier(0.32,0.72,0,1) accelerate curve). The
 *  curve is front-loaded — half the time covers 96% of the motion — so at
 *  240ms the tail is imperceptible and the fold reads as crisp, not as a
 *  slow creep into the stop. */
const COLLAPSE_MS = 240;
/** Pause after the fold completes, before the viewport rolls to its rest
 *  position — a deliberate beat so the two motions read as separate
 *  steps, never one blur. */
const COLLAPSE_HOLD_MS = 300;
/** The collapsed layout drops open with the terminal-open feel, slower. */
const COLLAPSE_EXPAND_MS = 520;
/** Shared empty feed for ended turns (stable reference, no re-renders). */
const NO_FEED_ROWS: Array<{ key: string; shownAt: number }> = [];

// =============================================================================
// Turn
// =============================================================================

// Memoized: MessageList re-renders on scroll (minimap active-message tracking),
// while turn/analysis object identities stay stable unless the transcript
// actually changed — so scrolling does not reconcile the whole turn tree.
const TurnSection = React.memo(function TurnSection({
  turn,
  analysis,
  onExpandDetails,
  onTurnEnd,
  onCollapseDetails,
  onCollapseChange,
  onSummaryGrowth,
  rowsWrapperRef,
  scrollContainerRef,
}: {
  turn: MinimalTurn;
  analysis: MinimalTurnAnalysis;
  onExpandDetails: (isActive: boolean) => void;
  onTurnEnd?: (turnId: string) => void;
  onCollapseDetails?: (isActive: boolean) => void;
  onCollapseChange?: (isCollapsing: boolean) => void;
  onSummaryGrowth?: (height: number) => void;
  rowsWrapperRef?: React.RefObject<HTMLDivElement | null>;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [detailsPhase, setDetailsPhase] = useState<'expanded' | 'collapsing' | 'collapsed'>(
    'collapsed',
  );
  // Set true when a collapse animation completes, so the collapsed layout
  // that renders next plays its own expand-in; historic turns render
  // directly without it.
  const [collapsedAnimateIn, setCollapsedAnimateIn] = useState(false);
  // The final summary of a just-finished turn reveals itself in a fast fake
  // stream (the text is already complete) before the layout restores — the
  // content must be fully rendered before the view settles.
  const [revealingSummary, setRevealingSummary] = useState(false);
  const [wasActive, setWasActive] = useState(() => analysis.isActive);
  const [justEnded, setJustEnded] = useState(false);
  // Set during render (adjust-state pattern): the ended turn's very first
  // render must already show the revealer, or the full summary would flash
  // for a frame before streaming from zero.
  if (wasActive && !analysis.isActive) {
    setWasActive(false);
    setJustEnded(true);
    if (analysis.summary && analysis.summary !== analysis.intro) {
      setRevealingSummary(true);
    }
  }
  // The turn's ending reveals the summary in place (pinned working area),
  // while the pin's padding shrinks by the summary height — the text
  // replaces the open space, so the layout never jumps. Once the summary has
  // fully streamed in (plus a short beat), the normal layout is restored
  // (MessageList glides the view to the bottom). A turn without a distinct
  // summary (or whose summary arrived outside the reveal window) restores
  // right away.
  const restoreTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (!justEnded) return;
    if (!analysis.summary || analysis.summary === analysis.intro || !revealingSummary) {
      onTurnEnd?.(turn.id);
    }
  }, [analysis.intro, analysis.summary, revealingSummary, justEnded, onTurnEnd, turn.id]);

  // Fired once by RevealText when the summary has fully streamed in: a
  // short beat lets the completed summary land, then the layout restores.
  const handleRevealComplete = useCallback(() => {
    if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    restoreTimerRef.current = setTimeout(() => {
      restoreTimerRef.current = null;
      onTurnEnd?.(turn.id);
    }, SUMMARY_RESTORE_DELAY_MS);
  }, [onTurnEnd, turn.id]);
  useEffect(() => {
    return () => {
      if (restoreTimerRef.current) clearTimeout(restoreTimerRef.current);
    };
  }, []);

  // While the summary reveals, its height replaces the pin's viewport-height
  // padding one for one (total height stays constant, so the pinned working
  // area never moves). MessageList owns the padding — it is reported through
  // onSummaryGrowth every time the revealer grows (ResizeObserver, so the
  // hand-over tracks every frame of the stream).
  const summaryRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!revealingSummary) return;
    const summaryEl = summaryRef.current;
    if (!summaryEl) return;
    const observer = new ResizeObserver(() => {
      onSummaryGrowth?.(summaryEl.getBoundingClientRect().height);
    });
    observer.observe(summaryEl);
    return () => observer.disconnect();
  }, [revealingSummary, onSummaryGrowth]);

  // Details collapse animation: the outer div animates its height (measured
  // at collapse start) to zero — grid-template-rows 0fr<->1fr is unreliable
  // in auto-height containers (Chrome does not interpolate fr tracks there),
  // so we drive height explicitly. null = auto (natural height).
  const [detailsHeight, setDetailsHeight] = useState<number | null>(null);
  // The details inner div: measured at collapse start, and its last entry is
  // the scroll target when expanding a working turn.
  const detailsRef = useRef<HTMLDivElement>(null);

  // Expanding details grows the content; release the scroll pin first so the
  // viewport isn't yanked away from the turn being opened. A working turn
  // lands on the bottom of the list (MessageList scrolls there — the newest
  // activity is what the user is about to read); a finished turn keeps the
  // current view and shows its details from the first entry. Collapsing runs
  // a staged animation: the details shrink first, then the collapsed layout
  // drops open — see the phase effect below.
  // The latest values are read through refs by the collapse effect's
  // animation callbacks (the effect itself must not re-run mid-collapse);
  // the refs are refreshed after every render.
  const activeRef = useRef(analysis.isActive);
  const onCollapseDetailsRef = useRef(onCollapseDetails);
  const onCollapseChangeRef = useRef(onCollapseChange);
  useEffect(() => {
    activeRef.current = analysis.isActive;
    onCollapseDetailsRef.current = onCollapseDetails;
    onCollapseChangeRef.current = onCollapseChange;
  });
  const handleToggleDetails = useCallback(() => {
    // Only an expand releases the pin (the collapse owns the viewport: it
    // folds in place, then glides to the pin). Calling the release here for
    // a collapse would re-run the expand-time logic — re-measuring the
    // details, re-fitting the padding, rolling to the details bottom — on
    // the very frame the fold starts.
    const expanding = detailsPhase === 'collapsed' || detailsPhase === 'collapsing';
    if (expanding) onExpandDetails(activeRef.current);
    if (detailsPhase === 'collapsing') {
      // Clicking mid-collapse cancels it: animate the height back from the
      // current fold to the natural height, then release it to auto (so
      // streaming content is never clipped). The release must wait for the
      // height transition to finish — auto cannot transition, so releasing
      // mid-flight would snap the details open instantly.
      const inner = detailsRef.current;
      if (inner) {
        const naturalHeight = inner.getBoundingClientRect().height;
        setDetailsHeight(naturalHeight);
        setTimeout(() => setDetailsHeight(null), COLLAPSE_MS);
      }
      setDetailsPhase('expanded');
      return;
    }
    if (expanding) {
      // Expanding releases any fixed height left over from a previous
      // collapse, or the details would mount clipped at zero.
      setDetailsHeight(null);
    }
    if (!expanding && window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
      // Reduced motion: collapse instantly, no fold, no roll — but the pin
      // must still be restored (the turn is running, and the pin was only
      // dropped so the details could be read). Without this, the collapsed
      // mount would resize the wrapper, the ResizeObserver would see a
      // missing pin and scroll the viewport to the list bottom.
      onCollapseDetailsRef.current?.(activeRef.current);
      setDetailsPhase('collapsed');
      setCollapsedAnimateIn(true);
      return;
    }
    setDetailsPhase(expanding ? 'expanded' : 'collapsing');
  }, [detailsPhase, onExpandDetails]);

  // Collapse staging runs in two sequential phases — the details shrink
  // away first (COLLAPSE_MS, terminal-close rhythm), then, once it is fully
  // folded, the viewport glides to its rest position. The shrink is
  // rAF-driven: every frame sets the details height from the same progress
  // curve that counter-scrolls the sticky header, so the fold never pushes
  // the header away from where it was clicked. The roll only happens after
  // the fold completes, so the two motions never fight each other.
  //
  // The roll target depends on where the header was:
  //  - pinned at the top: the list rests where the header sits exactly at
  //    the top edge (its document-flow position), or at the list bottom if
  //    there is not enough content below to pin it there — the header
  //    settles at its natural place instead of being yanked.
  //  - not pinned: no roll at all — the turn folds in place, unless the
  //    current scroll would clamp when the details content leaves
  //    scrollHeight, in which case it eases to the post-removal bottom.
  useEffect(() => {
    if (detailsPhase !== 'collapsing') return;
    // Stand the auto-scroll ResizeObserver down for the whole animation: its
    // scrollToBottom would fight the fold (the details shrink every frame,
    // so it would chase a moving bottom). MessageList also drops the
    // auto-scroll flag here, so the commit that starts the animation cannot
    // yank the viewport to the bottom either.
    onCollapseChangeRef.current?.(true);
    const inner = detailsRef.current;
    const container = scrollContainerRef?.current;
    const outer = inner?.parentElement;
    if (inner && container && outer) {
      const isActive = activeRef.current;
      const startHeight = inner.getBoundingClientRect().height;
      const startScrollTop = container.scrollTop;
      const containerTop = container.getBoundingClientRect().top;
      const startAt = performance.now();
      let raf = 0;
      let holdTimer: ReturnType<typeof setTimeout> | undefined;
      const finish = (): void => {
        setDetailsPhase('collapsed');
        setCollapsedAnimateIn(true);
        // Collapsing while the turn is still running: the working area goes
        // back to being pinned (padding included) — the pin was only dropped
        // so the expanded details could be read. By now the viewport is
        // already at the pinned position, so the re-pin is a zero delta.
        onCollapseDetailsRef.current?.(activeRef.current);
        // Let the ResizeObserver resume next frame (after the collapsed
        // layout has committed, so its mount cannot fight the animation).
        onCollapseChangeRef.current?.(false);
      };
      if (isActive) {
        // Working turn: the collapse restores the pin, so the viewport's
        // final position is the pinned one — the turn's top edge glued to
        // the container top. Phase 1 folds the details while the padding
        // grows by exactly the folded-away height (the fold would otherwise
        // pull the list bottom up into the viewport and clamp the scroll):
        // the total content height stays constant by construction, so the
        // viewport never needs to move. Phase 2 then glides the viewport to
        // the pin position, where finish() re-pins with a zero delta.
        const wrapper = rowsWrapperRef?.current;
        const section = inner.closest('section');
        const sectionTop = section ? section.getBoundingClientRect().top : containerTop;
        const pinScrollTop = startScrollTop + (sectionTop - containerTop);
        const fillStart = parseFloat(wrapper?.style.paddingBottom ?? '') || 0;
        // Exact compensation: total content = above + startHeight·(1−eased) +
        // padding, which stays constant only when padding grows by startHeight.
        const fillTarget = fillStart + startHeight;
        const startRoll = (): void => {
          const from = container.scrollTop;
          const distance = Math.abs(pinScrollTop - from);
          if (distance < 1) {
            finish();
            return;
          }
          const rollStartAt = performance.now();
          const rollTick = (): void => {
            const elapsed = performance.now() - rollStartAt;
            const progress = Math.min(1, elapsed / COLLAPSE_MS);
            container.scrollTop = from + (pinScrollTop - from) * terminalEase(progress);
            if (progress < 1) {
              raf = requestAnimationFrame(rollTick);
            } else {
              finish();
            }
          };
          raf = requestAnimationFrame(rollTick);
        };
        const foldTick = (): void => {
          const elapsed = performance.now() - startAt;
          const progress = Math.min(1, elapsed / COLLAPSE_MS);
          const eased = terminalEase(progress);
          outer.style.height = `${Math.round(startHeight * (1 - eased))}px`;
          if (wrapper) {
            wrapper.style.paddingBottom = `${Math.round(fillStart + (fillTarget - fillStart) * eased)}px`;
          }
          if (progress < 1) {
            raf = requestAnimationFrame(foldTick);
          } else {
            startRoll();
          }
        };
        raf = requestAnimationFrame(foldTick);
        return () => {
          cancelAnimationFrame(raf);
          if (holdTimer !== undefined) clearTimeout(holdTimer);
          onCollapseChangeRef.current?.(false);
        };
      }
      // A finished turn expands without moving the viewport, so its fold
      // keeps the current view: the header either rests where it was
      // clicked (document-flow position) or, when there is not enough
      // content below, at the post-removal bottom — whichever is closer.
      const timerRow = inner.closest('section')?.querySelector('[data-testid="minimal-timer-row"]');
      const timerTop = timerRow?.getBoundingClientRect().top;
      const isPinned = timerTop !== undefined && Math.abs(timerTop - containerTop) < 64;
      // The header's document-flow position (relative to the container's
      // content top): temporarily drop the sticky so the measured top is the
      // natural one. Synchronous measure + restore — no paint in between.
      let docFlowTop = 0;
      const wrap = timerRow?.parentElement;
      if (timerRow !== undefined && timerRow !== null && wrap) {
        const savedPosition = (wrap as HTMLElement).style.position;
        (wrap as HTMLElement).style.position = 'static';
        docFlowTop = timerRow.getBoundingClientRect().top - containerTop + container.scrollTop;
        (wrap as HTMLElement).style.position = savedPosition;
      }
      // Where the list rests once the details content leaves scrollHeight
      // (it stays measurable until the collapsed layout unmounts it).
      const restTarget = Math.max(0, container.scrollHeight - startHeight - container.clientHeight);
      const rollTarget = isPinned
        ? Math.min(docFlowTop, restTarget)
        : Math.min(startScrollTop, restTarget);
      // Phase 2: after a long beat (COLLAPSE_HOLD_MS — the fold and the
      // roll are two deliberate steps), glide to the rest position on the
      // same crisp 240ms terminal rhythm as the fold, then mount the
      // collapsed layout. The beat exists only for a pinned header (where
      // the roll follows the fold); an unpinned fold has no second motion,
      // so it proceeds straight to the collapsed layout — a pause there
      // would just read as a stutter.
      const startRoll = (): void => {
        const proceed = (): void => {
          const from = container.scrollTop;
          const distance = Math.abs(rollTarget - from);
          if (distance < 1) {
            finish();
            return;
          }
          const rollStartAt = performance.now();
          const rollTick = (): void => {
            const elapsed = performance.now() - rollStartAt;
            const progress = Math.min(1, elapsed / COLLAPSE_MS);
            container.scrollTop = from + (rollTarget - from) * terminalEase(progress);
            if (progress < 1) {
              raf = requestAnimationFrame(rollTick);
            } else {
              finish();
            }
          };
          raf = requestAnimationFrame(rollTick);
        };
        if (isPinned) {
          holdTimer = setTimeout(proceed, COLLAPSE_HOLD_MS);
        } else {
          proceed();
        }
      };
      // Phase 1: fold the details. While pinned, the viewport rolls toward
      // the header's document-flow position on the same eased curve that
      // shrinks the details — at that scrollTop the header sits exactly at
      // the top edge, so it stays glued at its click position the whole
      // fold (the document-flow position is fixed, so this is feedforward,
      // not a feedback loop that could oscillate). Unpinned, the fold
      // happens in place and the viewport does not move.
      const collapseTick = (): void => {
        const elapsed = performance.now() - startAt;
        const progress = Math.min(1, elapsed / COLLAPSE_MS);
        const eased = terminalEase(progress);
        outer.style.height = `${Math.round(startHeight * (1 - eased))}px`;
        if (isPinned) {
          container.scrollTop = startScrollTop + (docFlowTop - startScrollTop) * eased;
        }
        if (progress < 1) {
          raf = requestAnimationFrame(collapseTick);
        } else {
          // Phase 1 ends at (or near) the roll target already; startRoll
          // skips straight to the hold when there is nothing left to roll.
          startRoll();
        }
      };
      raf = requestAnimationFrame(collapseTick);
      return () => {
        cancelAnimationFrame(raf);
        if (holdTimer !== undefined) clearTimeout(holdTimer);
        onCollapseChangeRef.current?.(false);
      };
    }
    const timer = setTimeout(() => {
      setDetailsPhase('collapsed');
      setCollapsedAnimateIn(true);
      onCollapseDetailsRef.current?.(activeRef.current);
      onCollapseChangeRef.current?.(false);
    }, COLLAPSE_MS + COLLAPSE_HOLD_MS);
    return () => {
      clearTimeout(timer);
      onCollapseChangeRef.current?.(false);
    };
  }, [detailsPhase, scrollContainerRef, rowsWrapperRef]);

  const showTimer = shouldShowTimer(analysis);
  // The intro occupies the slot above the activity area. It disappears when
  // the turn ends, except for tool-less turns where it doubles as the summary
  // (the turn's only text must not vanish).
  const showIntro =
    analysis.intro !== null &&
    (analysis.isActive || (!analysis.hasTools && analysis.intro === analysis.summary));
  const isPureSystemTurn =
    turn.userNode === null &&
    turn.entries.length > 0 &&
    turn.entries.every((node) => node.role === 'system');

  // Activity feed: the turn's recent activities (tools, thinking, narration),
  // at most MAX_ACTIVITY_ROWS rows, each guaranteed MIN_ACTIVITY_VISIBLE_MS
  // of visibility. Rows render from the transcript by key, so in-place
  // updates (streaming text, running -> finished) pass through instantly —
  // only row swaps are paced. Errors and system markers are not activities:
  // they render as pinned rows above the feed.
  const activityKeys = turn.entries
    .filter(
      (node) =>
        node.role === 'tool' ||
        (node.role === 'assistant' && node.errorMessage === undefined && node !== analysis.intro),
    )
    .map((node) => node.id);
  const activityKeysJoined = activityKeys.join('|');

  const [feed, setFeed] = useState<Array<{ key: string; shownAt: number }>>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const pendingKeyRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!analysis.isActive) return;
    const newKeys = activityKeysJoined
      .split('|')
      .filter((key) => key.length > 0 && !seenKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    for (const key of newKeys) seenKeysRef.current.add(key);

    const now = Date.now();
    if (feed.length === 0) {
      // The turn's first activities (or a hydrating in-flight turn): show the
      // most recent ones directly — never replay history through pacing.
      setFeed(newKeys.slice(-MAX_ACTIVITY_ROWS).map((key) => ({ key, shownAt: now })));
      return;
    }

    let next = [...feed];
    for (const key of newKeys) {
      if (next.length < MAX_ACTIVITY_ROWS) {
        next.push({ key, shownAt: now });
        continue;
      }
      const waitMs = MIN_ACTIVITY_VISIBLE_MS - (now - next[0].shownAt);
      if (waitMs <= 0) {
        next = [...next.slice(1), { key, shownAt: Date.now() }];
      } else {
        // Both slots are young: park the arrival in the single pending slot
        // (a newer arrival overwrites it — middle activities drop, never
        // queue) and flush it in once the oldest row has been seen.
        pendingKeyRef.current = key;
        if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
        flushTimerRef.current = setTimeout(() => {
          flushTimerRef.current = null;
          const pendingKey = pendingKeyRef.current;
          pendingKeyRef.current = null;
          if (pendingKey !== null) {
            setFeed((current) => [...current.slice(1), { key: pendingKey, shownAt: Date.now() }]);
          }
        }, waitMs);
      }
    }
    if (next.length !== feed.length || next.some((row, index) => row.key !== feed[index]?.key)) {
      setFeed(next);
    }
  }, [activityKeysJoined, analysis.isActive, feed]);

  // The feed is ignored the moment the turn ends (never paced) so "Worked"
  // and the summary arrive crisply; any parked pending flush is cancelled.
  useEffect(() => {
    if (analysis.isActive) return;
    pendingKeyRef.current = null;
    if (flushTimerRef.current) {
      clearTimeout(flushTimerRef.current);
      flushTimerRef.current = null;
    }
  }, [analysis.isActive]);

  useEffect(() => {
    return () => {
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
    };
  }, []);

  // Pinned rows (errors, system markers) render above the feed; feed rows
  // resolve their key against the transcript so content updates stream
  // through without re-entering the feed.
  const nodeById = new Map(turn.entries.map((node) => [node.id, node]));
  const pinnedRows: React.ReactNode[] = analysis.items.map((item) => (
    <TurnItemRenderer key={item.node.id} item={item} />
  ));
  // The feed sits in a fixed-height slot so swapping thinking / narration /
  // tool lines (22.5px vs 26.5px tall) never moves the layout. Only the
  // active turn renders the slot — an ended turn's activity area collapses.
  const feedRows: React.ReactNode[] = [];
  const visibleFeed = analysis.isActive ? feed : NO_FEED_ROWS;
  for (const { key } of visibleFeed) {
    const node = nodeById.get(key);
    if (!node) continue;
    if (node.role === 'tool') {
      feedRows.push(<ToolLine key={key} node={node} />);
    } else if (node.role === 'assistant') {
      // The intro renders in its fixed slot above the feed — once it has
      // text it must never also stream as a narration row. (A text-empty
      // intro still passes through as the thinking row: the intro slot has
      // nothing to show yet, and it is indistinguishable from any other
      // thinking at that point.)
      if (node === analysis.intro && node.text.length > 0) continue;
      if (node.text.length > 0) {
        feedRows.push(<NarrationLine key={key} node={node} />);
      } else {
        feedRows.push(
          <div
            key={key}
            className="relative w-fit overflow-hidden text-[15px] text-muted-foreground"
            data-testid="minimal-thinking"
          >
            Thinking...
            <ShimmerOverlay />
          </div>,
        );
      }
    }
  }

  return (
    <section
      className={cn('mt-8 first:mt-0', isPureSystemTurn && 'mt-2')}
      data-testid="minimal-turn"
      data-turn-id={turn.id}
    >
      {turn.userNode && (
        /* data-display-index lets the minimap locate user messages in the DOM
           (no virtualizer measurements exist in this mode). */
        <div data-display-index={turn.userIndex}>
          <UserBubble node={turn.userNode} searchQuery="" activeOccurrenceIndex={null} />
        </div>
      )}

      {showTimer && (
        /* While the details are expanded (or collapsing) the timer row (with
           its chevron) is sticky at the viewport top: scrolling through a
           long activity list keeps the expand/collapse control reachable.
           Only then — in collapsed turns the row would briefly stick while
           the turn scrolls past, which reads as flicker. */
        <div
          className={cn(
            'flex flex-col',
            detailsPhase !== 'collapsed' && 'sticky top-0 z-10 bg-background',
          )}
        >
          <button
            type="button"
            onClick={handleToggleDetails}
            aria-expanded={detailsPhase !== 'collapsed'}
            className="flex w-full items-center gap-1.5 pt-3 pb-1 text-left"
            data-testid="minimal-timer-row"
          >
            {/* The turn stops counting as "working" once it ends (the timer
                freezes and the final summary appears together). */}
            <WorkingTimer
              startAt={analysis.startAt}
              endAt={analysis.endAt}
              active={analysis.isActive}
            />
            <IconChevronRight
              className={cn(
                'size-4 shrink-0 text-muted-foreground/50 transition-transform',
                detailsPhase !== 'collapsed' && 'rotate-90',
              )}
            />
          </button>
          <div className="h-px bg-border/60" data-testid="minimal-divider" />
        </div>
      )}

      {detailsPhase !== 'collapsed' ? (
        /* Expanded (or collapsing away): the turn's full activity — every
           tool call as a card, thinking blocks, and narration text
           (conclusion excluded). The outer div animates its height to zero
           (measured at collapse start — grid-template-rows 0fr<->1fr does
           not interpolate in auto-height containers) while the content
           fades, so the details visibly fold back into the header instead
           of vanishing. */
        <div
          className={cn(
            'mt-3 transition-[height,opacity] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
            detailsPhase === 'collapsing' && 'opacity-0',
          )}
          style={{
            height: detailsHeight === null ? undefined : `${detailsHeight}px`,
            transitionDuration: `${COLLAPSE_MS}ms`,
            // During the fold the rAF below drives height frame-by-frame;
            // the CSS height transition would fight it (every per-frame
            // inline change restarts the transition, so the rendered height
            // only closes ~18% of the gap per frame — the fold lags and the
            // leftover height pops away when the details unmounts). Leave
            // only opacity on the transition; height is fully rAF-owned.
            transitionProperty: detailsPhase === 'collapsing' ? 'opacity' : undefined,
          }}
        >
          {' '}
          <div ref={detailsRef} className="overflow-hidden" data-testid="minimal-details">
            <div className="flex flex-col gap-2 pb-1">
              {turn.entries.map((node) => {
                if (node === analysis.summary) return null;
                return <DetailItem key={node.id} node={node} />;
              })}
            </div>
          </div>
        </div>
      ) : (
        /* Collapsed: the intro (first text) sits above the activity area;
           below it, pinned rows (errors, system markers), then the feed in
           its fixed-height slot — the single current activity (thinking,
           narration or tool) shows what the agent is doing. Mounted with an
           expand-in animation only when it follows a collapse. */
        <CollapsedContent
          animateIn={collapsedAnimateIn}
          showIntro={showIntro}
          intro={analysis.intro}
          pinnedRows={pinnedRows}
          feedRows={feedRows}
          isActive={analysis.isActive}
        />
      )}

      {analysis.summary &&
        analysis.summary !== analysis.intro &&
        (revealingSummary ? (
          /* Reveal the completed summary in a smooth fake stream (the
             content is already fully available) so the turn's ending reads
             like the streaming it just came from. The revealer's height
             replaces the pin's padding as it grows (see the layout effect
             above); onComplete restores the layout. */
          <div
            ref={summaryRef}
            className="mt-4 w-full min-w-0 text-[15px] text-foreground"
            style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
            data-testid="minimal-summary"
          >
            <RevealText text={analysis.summary.text} onComplete={handleRevealComplete}>
              {(revealed) => <MarkdownMessage text={revealed} />}
            </RevealText>
          </div>
        ) : (
          <AssistantText node={analysis.summary} className="mt-4" testId="minimal-summary" />
        ))}
    </section>
  );
});

function AssistantText({
  node,
  className,
  testId,
}: {
  node: AssistantNode;
  className?: string;
  testId?: string;
}): React.JSX.Element {
  // Minimal view never renders thinking: the intro/summary text is shown as-is,
  // the node's thinking field is intentionally ignored (separated from text).
  // No shimmer here: text shown in the activity area is always complete (a
  // still-streaming text is the latest one and lands in the summary slot), so
  // it is content, not a live indicator.
  return (
    <div
      className={cn('w-full min-w-0 text-[15px] text-foreground', className)}
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid={testId}
    >
      {node.text.length > 0 && <MarkdownMessage text={node.text} />}
      {node.errorMessage && (
        <div className="mt-3 w-fit rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
          {node.errorMessage}
        </div>
      )}
    </div>
  );
}

function TurnItemRenderer({ item }: { item: MinimalTurnItem }): React.JSX.Element {
  switch (item.kind) {
    case 'text':
      // Pinned error message — the turn's outcome, full block.
      return <AssistantText node={item.node} />;
    case 'system':
      return (
        <SystemBubble
          text={item.node.text}
          isLoading={item.node.isLoading}
          searchQuery=""
          activeOccurrenceIndex={null}
        />
      );
  }
}

/** A narration message (middle narration or the final summary message) as a
 *  single truncated line in the activity stream. */
function NarrationLine({ node }: { node: AssistantNode }): React.JSX.Element {
  return (
    <div className="line-clamp-1 text-[15px] text-muted-foreground" data-testid="minimal-narration">
      <MarkdownMessage text={node.text} />
    </div>
  );
}

/** Reveals a complete text in a smooth fake stream: the content is
 *  already fully available, so this only paces the reveal. Words are the
 *  reveal unit (like a real API token stream — characters would flash
 *  half-rendered markdown, e.g. a lone "*"), at a steady clip scaled to
 *  the text length (clamped 300–1500ms). Children receive the revealed
 *  prefix and re-render as it grows. */
function RevealText({
  text,
  onComplete,
  children,
}: {
  text: string;
  onComplete: () => void;
  children: (revealed: string) => React.ReactNode;
}): React.JSX.Element {
  const tokens = useMemo(() => text.split(/(?<=\s)/), [text]);
  const [shown, setShown] = useState(0);
  useEffect(() => {
    if (text.length === 0) return;
    // Split on word boundaries (done in the useMemo above), keeping the
    // separators so the revealed slices join back into the exact original
    // text. The pacing scales with the token count, clamped 300–1500ms.
    const durationMs = Math.min(1500, Math.max(120, tokens.length * 24));
    const startAt = performance.now();
    let raf = 0;
    const tick = (now: number): void => {
      const progress = Math.min(1, (now - startAt) / durationMs);
      setShown(Math.floor(tokens.length * progress));
      if (progress < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [tokens, text]);
  useEffect(() => {
    if (shown >= tokens.length) onComplete();
  }, [onComplete, shown, tokens.length]);
  const revealed = tokens.slice(0, shown).join('');
  return <>{children(revealed)}</>;
}

/** The collapsed turn layout (intro, pinned rows, activity feed) in its
 *  fixed feed slot. When it mounts right after a collapse it starts at zero
 *  height and drops open slowly (terminal-open feel), so the eye follows
 *  the content down from the header instead of it popping in place.
 *  Historic/initial renders (animateIn=false) show directly, no animation. */
function CollapsedContent({
  animateIn,
  showIntro,
  intro,
  pinnedRows,
  feedRows,
  isActive,
}: {
  animateIn: boolean;
  showIntro: boolean;
  intro: AssistantNode | null;
  pinnedRows: React.ReactNode[];
  feedRows: React.ReactNode[];
  isActive: boolean;
}): React.JSX.Element {
  // null = auto (natural height). Start at 0 when animating in; the height
  // is released back to auto after the transition so later content changes
  // (feed updates) are never clipped.
  const [height, setHeight] = useState<number | null>(() => (animateIn ? 0 : null));
  const releaseTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    return () => {
      if (releaseTimerRef.current) clearTimeout(releaseTimerRef.current);
    };
  }, []);
  const innerRef = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    if (!animateIn) return;
    const inner = innerRef.current;
    if (!inner) return;
    const target = inner.getBoundingClientRect().height;
    // Next frame: animate 0 -> natural height, then release to auto once the
    // transition has landed. (requestAnimationFrame defers the setState out
    // of the effect body so no cascading-render warning.)
    const raf = requestAnimationFrame(() => {
      setHeight(target);
      releaseTimerRef.current = setTimeout(() => setHeight(null), COLLAPSE_EXPAND_MS);
    });
    return () => cancelAnimationFrame(raf);
  }, [animateIn]);
  return (
    <div
      className={cn(
        'mt-2 transition-[height,opacity] ease-[cubic-bezier(0.32,0.72,0,1)] motion-reduce:transition-none',
        height === 0 && 'opacity-0',
      )}
      style={{
        height: height === null ? undefined : `${height}px`,
        transitionDuration: `${COLLAPSE_EXPAND_MS}ms`,
      }}
    >
      <div ref={innerRef} className="overflow-hidden">
        <div className="flex flex-col gap-1">
          {showIntro && <AssistantText node={intro!} testId="minimal-intro" />}
          {pinnedRows}
          {isActive && <div className="flex h-[27px] items-center overflow-hidden">{feedRows}</div>}
        </div>
      </div>
    </div>
  );
}

/** Full-detail rendering for an expanded turn: complete tool cards, thinking blocks, text. */
function DetailItem({ node }: { node: TranscriptNode }): React.JSX.Element | null {
  if (node.role === 'tool') {
    return <ToolBlock node={node} />;
  }
  if (node.role === 'assistant') {
    return (
      <>
        {node.thinking.length > 0 && (
          <ThinkingBlock
            text={node.thinking}
            startedAt={node.thinkingStartedAt}
            endedAt={node.thinkingEndedAt}
            isStreaming={node.isStreaming}
          />
        )}
        {(node.text.length > 0 || node.errorMessage) && <AssistantText node={node} />}
      </>
    );
  }
  if (node.role === 'system') {
    return (
      <SystemBubble
        text={node.text}
        isLoading={node.isLoading}
        searchQuery=""
        activeOccurrenceIndex={null}
      />
    );
  }
  return null;
}

// =============================================================================
// Working timer
// =============================================================================

/**
 * Live elapsed-time display for the current turn.
 *
 * Accuracy: never accumulates ticks (which drifts with setInterval throttling);
 * the elapsed value is always derived from `Date.now() - startAt`, so a
 * throttled interval self-corrects on the next tick. The interval runs while
 * the turn is ACTIVE (not while endAt is undefined — endAt can be populated
 * mid-stream by the thinking-end timestamp, which would freeze the timer).
 * When the turn ends the timer freezes at the timestamp-derived endAt and the
 * label switches from "Working" to "Worked".
 */
function WorkingTimer({
  startAt,
  endAt,
  active,
}: {
  startAt?: number;
  endAt?: number;
  active: boolean;
}): React.JSX.Element {
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!active) return;
    const interval = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(interval);
  }, [active]);

  const elapsedMs = startAt !== undefined ? (active ? now : (endAt ?? now)) - startAt : 0;

  return (
    <span
      className="text-[15px] text-muted-foreground tabular-nums"
      data-testid="minimal-working-timer"
      data-active={active ? 'true' : undefined}
    >
      {active ? 'Working for ' : 'Worked for '}
      {formatWorkingDuration(elapsedMs)}
    </span>
  );
}

// =============================================================================
// Running tool line
// =============================================================================

/** Characters kept at the end of an over-long activity command. The head
 *  shrinks with an ellipsis and this tail stays visible, so the line
 *  ellipsizes in the middle rather than the end — the end of a path/command
 *  is usually the useful part (filename, line range, final args). Same
 *  convention as the collapsed-read-group labels. */
const COMMAND_TAIL_CHARS = 20;

/** Beat after the summary has fully streamed in, before the layout restores
 *  (the view glides to the bottom) — the completed summary gets a moment to
 *  land in the pinned working area first. */
const SUMMARY_RESTORE_DELAY_MS = 200;

/**
 * A tool call as a plain text line in the activity feed. Every feed row is
 * live while it is shown — the shimmer sweeps continuously until the row is
 * replaced (the tool's own status does not stop it: a finished command keeps
 * its live look until the next activity takes its place).
 */
function ToolLine({ node }: { node: ToolNode }): React.JSX.Element {
  const { prefix, body } = getToolCommandParts(node);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const showTail = body.length > COMMAND_TAIL_CHARS;

  // Constant-speed-ish shimmer: the band travels its own width plus the text
  // width per cycle (enter + sweep + exit), so a fixed duration would make
  // wide (long-command) lines sweep faster. Scale the duration with the
  // measured text width, clamped to feel like the Thinking placeholder
  // (2.5s) for short commands and never slower than 5s for long ones.
  const [shimmerDurationMs, setShimmerDurationMs] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    const element = bodyRef.current;
    if (!element) return;
    function update(): void {
      const target = bodyRef.current;
      if (!target) return;
      const width = target.clientWidth;
      if (width > 0) {
        const distance = width + SHIMMER_BAND_WIDTH_PX;
        const scaled = (distance / SHIMMER_SPEED_PX_PER_SECOND) * 1000;
        setShimmerDurationMs(Math.round(Math.min(5000, Math.max(2500, scaled))));
      }
    }
    update();
    const resizeObserver = new ResizeObserver(update);
    resizeObserver.observe(element);
    return () => resizeObserver.disconnect();
  }, []);

  return (
    /* w-fit keeps the shimmer sweep tight around the text itself — a full-width
       box would stretch the same gradient across mostly empty space. The
       shimmer band covers the whole row (prefix included), sweeping in from
       the row's left edge like the Thinking placeholder does. */
    <div
      className="relative w-fit max-w-full overflow-hidden py-0.5 font-mono text-[15px] text-muted-foreground"
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid="minimal-running-tool"
    >
      <span className="flex items-baseline gap-1">
        <span className="shrink-0 text-foreground/80">{prefix}</span>
        {/* An over-long command splits into a shrinking head and a fixed tail
            so the useful end stays visible (middle ellipsis, like the
            collapsed-read-group labels). */}
        <span ref={bodyRef} className="flex min-w-0 flex-1 items-baseline">
          {showTail ? (
            <>
              <span className="truncate">{body.slice(0, -COMMAND_TAIL_CHARS)}</span>
              <span className="shrink-0 whitespace-pre">{body.slice(-COMMAND_TAIL_CHARS)}</span>
            </>
          ) : (
            <span className="truncate">{body}</span>
          )}
        </span>
      </span>
      <ShimmerOverlay durationMs={shimmerDurationMs} />
    </div>
  );
}
