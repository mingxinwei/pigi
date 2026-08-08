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
 * The activity stream below shimmers only on live indicators (the Thinking
 * placeholder, the running tool line); text content always renders static.
 * A finished command lingers (static) during quiet gaps until the next
 * activity replaces it. The turn ends with the agent's final text message
 * (summary), rendered without its thinking.
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

  // Activity rows: running tools, errors and system markers; when the area
  // would otherwise be empty, the last activity (thinking, narration or
  // tool) lingers until the next one arrives — the area must never be empty
  // between activities, and every activity is transient: replaced by the
  // next one, gone when the turn ends. Rows are keyed by node id so React
  // reuses the element when the same tool goes running -> finished.
  const visibleItems = analysis.items.filter(
    (item) =>
      item.kind === 'system' ||
      // Errors are the turn's outcome, not transient activity — they must
      // stay visible after the turn ends.
      (item.kind === 'text' && item.node.errorMessage !== undefined) ||
      analysis.isActive,
  );
  const lingering = analysis.isActive && visibleItems.length === 0 ? analysis.lastActivity : null;
  const rows: React.ReactNode[] = visibleItems.map((item) => (
    <TurnItemRenderer key={item.node.id} item={item} />
  ));
  if (lingering) {
    rows.push(
      lingering.role === 'assistant' ? (
        lingering.text.length > 0 ? (
          <NarrationLine key={lingering.id} node={lingering} />
        ) : (
          <div
            key={lingering.id}
            className="relative w-fit overflow-hidden text-[15px] text-muted-foreground"
            data-testid="minimal-thinking"
          >
            Thinking...
            <ShimmerOverlay />
          </div>
        )
      ) : (
        <ToolLine key={lingering.id} node={lingering} live={false} />
      ),
    );
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
            below it, the single current activity (thinking, narration or
            tool) shows what the agent is doing. */
        <div className="mt-2 flex flex-col gap-1">
          {showIntro && <AssistantText node={analysis.intro!} testId="minimal-intro" />}
          {rows}
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
    case 'tool':
      return <ToolLine node={item.node} live />;
    case 'text':
      // Only errors land here — narration goes through the single activity
      // slot (lastActivity). Errors are the turn's outcome, full block.
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
