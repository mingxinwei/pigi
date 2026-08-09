import React, { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
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
   *  uses it to release the auto-scroll pin so the viewport stays put. */
  onExpandDetails: () => void;
}

export default function MinimalView({
  nodes,
  sessionStatus,
  onExpandDetails,
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
}: {
  turn: MinimalTurn;
  analysis: MinimalTurnAnalysis;
  onExpandDetails: () => void;
}): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
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
      feedRows.push(<ToolLine key={key} node={node} live={node.status === 'running'} />);
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
    >
      {turn.userNode && (
        /* data-display-index lets the minimap locate user messages in the DOM
           (no virtualizer measurements exist in this mode). */
        <div data-display-index={turn.userIndex}>
          <UserBubble node={turn.userNode} searchQuery="" activeOccurrenceIndex={null} />
        </div>
      )}

      {showTimer && (
        <>
          <button
            type="button"
            onClick={() => {
              // Expanding grows the content; release the bottom pin first so
              // the viewport isn't yanked away from the turn being opened.
              onExpandDetails();
              setDetailsExpanded((value) => !value);
            }}
            aria-expanded={detailsExpanded}
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
                detailsExpanded && 'rotate-90',
              )}
            />
          </button>
          <div className="h-px bg-border/60" data-testid="minimal-divider" />
        </>
      )}

      {detailsExpanded ? (
        /* Expanded: the turn's full activity — every tool call as a card,
            thinking blocks, and narration text (conclusion excluded). */
        <div className="mt-3 flex flex-col gap-2">
          {turn.entries.map((node) => {
            if (node === analysis.summary) return null;
            return <DetailItem key={node.id} node={node} />;
          })}
        </div>
      ) : (
        /* Collapsed: the intro (first text) sits above the activity area;
            below it, pinned rows (errors, system markers), then the feed in
            its fixed-height slot — the single current activity (thinking,
            narration or tool) shows what the agent is doing. */
        <div className="mt-2 flex flex-col gap-1">
          {showIntro && <AssistantText node={analysis.intro!} testId="minimal-intro" />}
          {pinnedRows}
          {analysis.isActive && (
            <div className="flex h-[27px] items-center overflow-hidden">{feedRows}</div>
          )}
        </div>
      )}

      {analysis.summary && analysis.summary !== analysis.intro && (
        <AssistantText node={analysis.summary} className="mt-4" testId="minimal-summary" />
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

/** A narration message (middle narration or the final summary message) as a
 *  single truncated line in the activity stream. */
function NarrationLine({ node }: { node: AssistantNode }): React.JSX.Element {
  return (
    <div className="line-clamp-1 text-[15px] text-muted-foreground" data-testid="minimal-narration">
      <MarkdownMessage text={node.text} />
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
    >
      {active ? 'Working for ' : 'Worked for '}
      {formatWorkingDuration(elapsedMs)}
    </span>
  );
}

// =============================================================================
// Running tool line
// =============================================================================

/**
 * A tool call as a plain text line. While the tool is running it sweeps a
 * shimmer; the finished variant stays on screen (without shimmer) during
 * quiet gaps until the next activity replaces it.
 */
function ToolLine({ node, live }: { node: ToolNode; live: boolean }): React.JSX.Element {
  const { prefix, body } = getToolCommandParts(node);
  const bodyRef = useRef<HTMLSpanElement>(null);

  // Constant-speed-ish shimmer: the band travels its own width plus the text
  // width per cycle (enter + sweep + exit), so a fixed duration would make
  // wide (long-command) lines sweep faster. Scale the duration with the
  // measured text width, clamped to feel like the Thinking placeholder
  // (2.5s) for short commands and never slower than 5s for long ones.
  const [shimmerDurationMs, setShimmerDurationMs] = useState<number | undefined>(undefined);
  useLayoutEffect(() => {
    if (!live) return;
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
  }, [live]);

  return (
    /* w-fit keeps the shimmer sweep tight around the text itself — a full-width
       box would stretch the same gradient across mostly empty space. */
    <div
      className="relative w-fit max-w-full overflow-hidden py-0.5 font-mono text-[15px] text-muted-foreground"
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid={live ? 'minimal-running-tool' : 'minimal-finished-tool'}
    >
      <span className="flex items-baseline gap-1">
        <span className="shrink-0 text-foreground/80">{prefix}</span>
        {/* The shimmer band lives inside the text span (relative), so it
            sweeps only the visible text — a truncated long command does not
            waste the sweep on its hidden tail. */}
        <span ref={bodyRef} className="relative min-w-0 truncate">
          {body}
          {live && <ShimmerOverlay durationMs={shimmerDurationMs} />}
        </span>
      </span>
    </div>
  );
}
