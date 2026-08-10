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
 * Below them sits the activity feed: the turn's current activity (a running
 * tool, or a thinking placeholder), at most MAX_ACTIVITY_ROWS rows, each
 * guaranteed MIN_ACTIVITY_VISIBLE_MS of visibility before being replaced.
 * The feed is event-driven and never queues — during a burst faster than
 * the eye can follow, only the latest pending arrival survives (middle ones
 * drop), so the display can never lag behind reality. A row whose activity
 * ends (a tool finishes, a thinking message starts writing text) is removed
 * immediately — it must not hang around under the next message. Text-bearing
 * messages render below the intro in the current-message slot, newest
 * replacing the previous one; the turn ends with the agent's final text
 * message (the summary) landing there.
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
  /** Reports each working turn's section height — once the content outgrows
   *  the viewport, MessageList follows the output like a normal message
   *  (the pin stays armed but the viewport rides the growing content). */
  onOutputGrowth?: (height: number) => void;
  /** The collapse animation grows the pin's spacer back by exactly the
   *  folded-away height each frame (see the fold below) — state-driven, so
   *  the spacer row re-renders with the fold and the list bottom never
   *  rises into the viewport. */
  onCollapseFill?: (paddingPx: number) => void;
  /** The current height of the pin's spacer row (MessageList state) — the
   *  collapse fold needs the starting value to compensate the fold. */
  topPaddingPx: number;
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
  onOutputGrowth,
  onCollapseFill,
  topPaddingPx,
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
          onOutputGrowth={onOutputGrowth}
          onCollapseFill={onCollapseFill}
          topPaddingPx={topPaddingPx}
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

// =============================================================================
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
  onOutputGrowth,
  onCollapseFill,
  topPaddingPx,
  scrollContainerRef,
}: {
  turn: MinimalTurn;
  analysis: MinimalTurnAnalysis;
  onExpandDetails: (isActive: boolean) => void;
  onTurnEnd?: (turnId: string) => void;
  onCollapseDetails?: (isActive: boolean) => void;
  onCollapseChange?: (isCollapsing: boolean) => void;
  /** See MinimalViewProps.onOutputGrowth. */
  onOutputGrowth?: (height: number) => void;
  onCollapseFill?: (paddingPx: number) => void;
  topPaddingPx: number;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [detailsPhase, setDetailsPhase] = useState<'expanded' | 'collapsing' | 'collapsed'>(
    'collapsed',
  );
  const [wasActive, setWasActive] = useState(() => analysis.isActive);
  const [justEnded, setJustEnded] = useState(false);
  // Set during render (adjust-state pattern): the ended turn's very first
  // render already shows the finished state (Worked timer, summary in the
  // current-message slot — it streamed in live before the turn ended), so
  // no reveal window exists: the layout restore fires immediately.
  if (wasActive && !analysis.isActive) {
    setWasActive(false);
    setJustEnded(true);
  }
  // The turn ended: MessageList restores the layout right away (glide the
  // pinned view to the content bottom, drop the spacer). The summary was
  // already streaming live in the current-message slot, so there is nothing
  // to pace or wait for.
  useEffect(() => {
    if (!justEnded) return;
    onTurnEnd?.(turn.id);
  }, [justEnded, onTurnEnd, turn.id]);

  // While the turn is active, the section's height tracks the content
  // streaming in below the pinned working area. Once it outgrows the
  // viewport, MessageList follows the output like a normal message (the pin
  // stays armed, so nothing jumps when the turn ends).
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!analysis.isActive) return;
    const sectionEl = sectionRef.current;
    if (!sectionEl) return;
    const observer = new ResizeObserver(() => {
      onOutputGrowth?.(sectionEl.getBoundingClientRect().height);
    });
    observer.observe(sectionEl);
    return () => observer.disconnect();
  }, [analysis.isActive, onOutputGrowth]);

  // Details collapse is a single instant swap (no animation): the layout
  // changes in one commit and the viewport jumps to its rest position —
  // see the collapsing effect below.
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
  const onCollapseFillRef = useRef(onCollapseFill);
  const topPaddingPxRef = useRef(topPaddingPx);
  // The collapsed layout's height, measured while it is still on screen
  // (i.e. at expand time). The finished-turn collapse swaps the details
  // (startHeight) for this layout; the difference is compensated with the
  // spacer so the total height — and the viewport — never moves.
  const collapsedHeightRef = useRef(0);
  useEffect(() => {
    activeRef.current = analysis.isActive;
    onCollapseDetailsRef.current = onCollapseDetails;
    onCollapseChangeRef.current = onCollapseChange;
    onCollapseFillRef.current = onCollapseFill;
    topPaddingPxRef.current = topPaddingPx;
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
      // Clicking mid-collapse cancels it: the expand request wins — the
      // pending swap commit is cleared by the collapse effect's cleanup,
      // and the details stay fully visible.
      setDetailsPhase('expanded');
      return;
    }
    if (expanding) {
      // Cache the collapsed layout's height before it leaves the DOM — the
      // next collapse compensates the details→collapsed swap with exactly
      // this difference (see the collapse effect).
      const collapsedEl = sectionRef.current?.querySelector('[data-testid=minimal-collapsed]');
      if (collapsedEl) {
        collapsedHeightRef.current = collapsedEl.getBoundingClientRect().height;
      }
    }
    setDetailsPhase(expanding ? 'expanded' : 'collapsing');
  }, [detailsPhase, onExpandDetails]);

  // The collapse is a single instant swap — no animation. The layout
  // changes in one commit: the collapsed content (the summary) renders
  // complete immediately, and the spacer compensates the height difference
  // so the total height — and the viewport — never move. Then the viewport
  // jumps straight to its rest position. Render first, scroll once: no
  // fold, no expand-in, no mid-motion clamp drift.
  //
  // The rest target depends on where the header was:
  //  - pinned at the top: the list rests where the header sits exactly at
  //    the top edge (its document-flow position), or at the list bottom if
  //    there is not enough content below to pin it there — the header
  //    settles at its natural place instead of being yanked.
  //  - not pinned: no scroll at all — the turn folds in place, unless the
  //    current scroll would clamp when the details content leaves
  //    scrollHeight, in which case it lands on the post-removal bottom.
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
      let holdTimer: ReturnType<typeof setTimeout> | undefined;
      if (isActive) {
        // Working turn: the collapse restores the pin, so the viewport's
        // final position is the pinned one — the turn's top edge glued to
        // the container top. The padding grows by exactly the details
        // height (the swap would otherwise pull the list bottom up into
        // the viewport and clamp the scroll): the total content height
        // stays constant by construction, so the viewport never moves.
        const section = inner.closest('section');
        const sectionTop = section ? section.getBoundingClientRect().top : containerTop;
        const pinScrollTop = startScrollTop + (sectionTop - containerTop);
        // The spacer's current height (MessageList state, read through the
        // ref so the effect does not re-run mid-animation).
        const fillTarget = topPaddingPxRef.current + startHeight;
        // The swap commit runs outside this effect (a synchronous setState
        // here trips the cascading-render lint). Tracked so a mid-collapse
        // expand (which re-runs this effect) cancels it instead of
        // collapsing again. The fill lands before the re-pin call: when
        // the re-pin has nothing to restore (no pinned turn recorded), the
        // fill is the only compensation keeping the scroll range open.
        holdTimer = setTimeout(() => {
          setDetailsPhase('collapsed');
          onCollapseFillRef.current?.(Math.round(fillTarget));
          // Collapsing while the turn is still running: the working area
          // goes back to being pinned (padding included) — the pin was
          // only dropped so the expanded details could be read. By now the
          // viewport is already at the pinned position, so the re-pin is a
          // zero delta.
          onCollapseDetailsRef.current?.(activeRef.current);
          // Let the ResizeObserver resume next frame (after the collapsed
          // layout has committed, so its mount cannot fight the swap).
          onCollapseChangeRef.current?.(false);
          // Untracked rAF: the effect cleanup (this commit re-runs the
          // effect) must not cancel the viewport jump.
          requestAnimationFrame(() => {
            container.scrollTop = pinScrollTop;
          });
        }, 0);
        return () => {
          if (holdTimer !== undefined) clearTimeout(holdTimer);
          onCollapseChangeRef.current?.(false);
        };
      }
      // A finished turn's details collapse INSTANTLY: the layout swaps in
      // one commit — the collapsed content (summary) renders complete
      // immediately, the spacer compensating the details→collapsed height
      // difference keeps the total height (and viewport) still — and then
      // the viewport jumps straight to its rest position. Render first,
      // scroll once: no CLS, no mid-fold clamp drift.
      // The swap compensation: the details (startHeight) leave the layout
      // and the collapsed layout (measured at expand time) takes their
      // place — the spacer makes up the difference so the total height,
      // and the viewport, never move during the swap.
      const compensation = Math.max(0, startHeight - collapsedHeightRef.current);
      holdTimer = setTimeout(() => {
        setDetailsPhase('collapsed');
        onCollapseFillRef.current?.(Math.round(compensation));
        // Untracked rAF: the effect cleanup (this commit re-runs the
        // effect) must not cancel the viewport jump. By now the new layout
        // is fully committed — the summary rendered, the spacer in place.
        requestAnimationFrame(() => {
          // The rest target is the bottom AFTER the spacer is dropped (the
          // true list bottom): the viewport lands there while the spacer
          // still holds the scroll range open, so dropping it later cannot
          // clamp anything.
          const finalBottom = Math.max(
            0,
            container.scrollHeight - compensation - container.clientHeight,
          );
          // The viewport rests where it was before the collapse — the
          // header stays glued to the top edge when the user had scrolled
          // it there, the bottom of the list when the viewport was at the
          // details bottom (its position now exceeds the shorter list and
          // clamps to the new bottom — nothing left to scroll down to).
          // Whatever the case, dropping the compensation spacer later
          // cannot clamp anything: restTarget is at most the post-drop
          // maxScroll.
          const restTarget = Math.min(startScrollTop, finalBottom);
          container.scrollTop = restTarget;
          // Drop the swap compensation: the viewport already rests at the
          // post-compensation bottom, so removing the spacer shrinks
          // scrollHeight to exactly the viewport position — zero jump.
          onCollapseFillRef.current?.(0);
          onCollapseDetailsRef.current?.(activeRef.current);
          // Let the ResizeObserver resume next frame (after the collapsed
          // layout has committed, so its mount cannot fight the swap).
          onCollapseChangeRef.current?.(false);
        });
      }, 0);
      return () => {
        if (holdTimer !== undefined) clearTimeout(holdTimer);
        onCollapseChangeRef.current?.(false);
      };
    }
    const timer = setTimeout(() => {
      setDetailsPhase('collapsed');
      onCollapseDetailsRef.current?.(activeRef.current);
      onCollapseChangeRef.current?.(false);
    }, 0);
    return () => {
      clearTimeout(timer);
      onCollapseChangeRef.current?.(false);
    };
  }, [detailsPhase, scrollContainerRef]);

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

  // The current assistant message: the newest text-bearing message after the
  // intro (intro excluded — it has its own fixed slot above). Each new
  // message replaces the previous one, so the slot always shows what the
  // agent is writing right now; the turn's final text (the summary) lands
  // here too and simply stays. Streaming text grows in place via the
  // transcript. Thinking-only messages have no text and do not occupy the
  // slot (they pass through the activity feed as thinking rows).
  const currentMsg = useMemo(() => {
    let last: AssistantNode | null = null;
    for (const node of turn.entries) {
      if (node.role === 'assistant' && node.text.length > 0 && node !== analysis.intro) {
        last = node;
      }
    }
    return last;
  }, [turn.entries, analysis.intro]);

  // Activity feed: the turn's current activity — at most MAX_ACTIVITY_ROWS
  // rows, each guaranteed MIN_ACTIVITY_VISIBLE_MS of visibility. Rows
  // render from the transcript by key, so in-place updates (streaming text,
  // running -> finished) pass through instantly — only row swaps are
  // paced. Only LIVE activities enter the feed: a running tool, or a
  // text-empty assistant message (the agent thinking). The moment an
  // activity ends — a thinking message starts writing text (it moves to the
  // current-message slot), or a tool finishes — its row is removed right
  // away instead of waiting for the next arrival to push it out (a final
  // tool followed by the summary must not hang around either). Errors and
  // system markers are not activities: they render as pinned rows above the
  // feed.
  const activityKeys = turn.entries
    .filter(
      (node) =>
        (node.role === 'tool' && node.status === 'running') ||
        (node.role === 'assistant' && node.errorMessage === undefined && node.text.length === 0),
    )
    .map((node) => node.id);
  const activityKeysJoined = activityKeys.join('|');

  const [feed, setFeed] = useState<Array<{ key: string; shownAt: number }>>([]);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const pendingKeyRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!analysis.isActive) return;
    const activeKeys = new Set(activityKeysJoined.split('|').filter((key) => key.length > 0));
    // A row whose activity ended still gets its MIN_ACTIVITY_VISIBLE_MS of
    // screen time (no fast flicker on quick back-to-back activities), but it
    // must not hang around either: once fully shown it is removed
    // immediately, without waiting for the next arrival to push it out (a
    // final tool followed by the summary would otherwise hang until the
    // turn ended).
    const staleRows = feed.filter((row) => !activeKeys.has(row.key));
    if (staleRows.length > 0) {
      const now = Date.now();
      const waitMs =
        Math.min(...staleRows.map((row) => row.shownAt)) + MIN_ACTIVITY_VISIBLE_MS - now;
      // Deferred (rAF / timer) so the update is not a synchronous setState
      // inside the effect (cascading-render lint) — a single frame of
      // latency is invisible, and the re-run converges immediately.
      const removeStale = (): void =>
        setFeed((current) => current.filter((row) => activeKeys.has(row.key)));
      if (waitMs <= 0) {
        const frame = requestAnimationFrame(removeStale);
        return () => cancelAnimationFrame(frame);
      }
      const timer = setTimeout(removeStale, waitMs);
      return () => clearTimeout(timer);
    }
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
    return undefined;
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
      // Text-bearing messages render in the current-message slot (newest
      // replaces the previous), never as feed rows; a text-empty assistant
      // message is the agent thinking — the live indicator row.
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

  return (
    <section
      ref={sectionRef}
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
           tool call as a card, thinking blocks, narration text and the
           final summary. Collapsing is an instant swap: the details
           unmount and the collapsed layout takes its place in the same
           commit (the spacer compensates the height difference), so no
           transition styling is needed here. */
        <div className="mt-3" data-testid="minimal-details-wrapper">
          <div ref={detailsRef} className="overflow-hidden" data-testid="minimal-details">
            <div className="flex flex-col gap-2 pb-1">
              {turn.entries.map((node) => (
                <DetailItem key={node.id} node={node} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        /* Collapsed: the intro (first text) sits above the activity area;
           below it the current assistant message (newest replaces the
           previous one — the turn's final summary lands here too), then
           pinned rows (errors, system markers), then the feed in its
           fixed-height slot — the current thinking or tool shows what the
           agent is doing. Mounts fully rendered: the collapse is an
           instant swap, so the summary is complete from the first commit. */
        <CollapsedContent
          showIntro={showIntro}
          intro={analysis.intro}
          currentMsg={currentMsg}
          pinnedRows={pinnedRows}
          feedRows={feedRows}
          isActive={analysis.isActive}
        />
      )}
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

/** The collapsed turn layout (intro, current message, pinned rows,
 *  activity feed) in its fixed feed slot. Mounts fully rendered — the
 *  collapse is an instant swap, so the summary is complete from the first
 *  commit (no expand-in animation). */
function CollapsedContent({
  showIntro,
  intro,
  currentMsg,
  pinnedRows,
  feedRows,
  isActive,
}: {
  showIntro: boolean;
  intro: AssistantNode | null;
  currentMsg: AssistantNode | null;
  pinnedRows: React.ReactNode[];
  feedRows: React.ReactNode[];
  isActive: boolean;
}): React.JSX.Element {
  return (
    <div className="mt-2" data-testid="minimal-collapsed">
      <div className="overflow-hidden">
        <div className="flex flex-col gap-1">
          {showIntro && <AssistantText node={intro!} testId="minimal-intro" />}
          {currentMsg && (
            <div
              className="mt-2 w-full min-w-0 text-[15px] text-foreground"
              style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
              data-testid="minimal-current-msg"
            >
              <MarkdownMessage text={currentMsg.text} />
            </div>
          )}
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
