import React, { useEffect, useMemo, useState } from 'react';
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
import ShimmerOverlay from './shimmerOverlay';
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
 * The activity stream below shows only the currently running tool as a plain
 * text line with a shimmer sweep; a finished command lingers (static) during
 * quiet gaps until the next activity replaces it. The turn ends with the
 * agent's final text message (summary), rendered without its thinking.
 */

interface MinimalViewProps {
  nodes: TranscriptNode[];
  sessionStatus: AgentStatus;
}

export default function MinimalView({ nodes, sessionStatus }: MinimalViewProps): React.JSX.Element {
  const turns = useMemo(() => buildTurns(nodes), [nodes]);
  const analyses = useMemo(
    () => turns.map((turn, index) => analyzeTurn(turn, sessionStatus, index === turns.length - 1)),
    [turns, sessionStatus],
  );

  return (
    <div data-testid="minimal-view">
      {turns.map((turn, index) => (
        <TurnSection key={turn.id} turn={turn} analysis={analyses[index]} />
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
}: {
  turn: MinimalTurn;
  analysis: MinimalTurnAnalysis;
}): React.JSX.Element {
  const [detailsExpanded, setDetailsExpanded] = useState(false);
  const showTimer = shouldShowTimer(analysis);
  // The turn is done working as soon as the final summary starts streaming.
  const summaryStarted = analysis.summaryStarted;
  // The intro doubles as the conclusion when it is the turn's only text;
  // in that case it is rendered in the conclusion slot, not the activity area.
  const introIsOnlyText = analysis.intro !== null && analysis.intro === analysis.summary;

  return (
    <section className="mt-8 first:mt-0" data-testid="minimal-turn">
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
            onClick={() => setDetailsExpanded((value) => !value)}
            className="flex w-full items-center gap-1.5 pt-3 pb-1 text-left"
            data-testid="minimal-timer-row"
          >
            {/* The turn stops counting as "working" the moment the final
                summary message starts streaming — the work is done. */}
            <WorkingTimer
              startAt={analysis.startAt}
              endAt={analysis.endAt}
              active={analysis.isActive && !summaryStarted}
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
        /* Collapsed: live activity below the working timer — intro narration
            and running tool lines disappear when the turn ends. */
        <div className="mt-2 flex flex-col gap-1">
          {analysis.isActive && analysis.showThinking && (
            <div
              className="relative w-fit overflow-hidden text-[15px] text-muted-foreground"
              data-testid="minimal-thinking"
            >
              Thinking...
              <ShimmerOverlay />
            </div>
          )}
          {analysis.intro && !introIsOnlyText && analysis.isActive && (
            <AssistantText node={analysis.intro} testId="minimal-intro" shimmer />
          )}
          {analysis.items
            .filter((item) => item.kind === 'system' || analysis.isActive)
            .map((item) => (
              <TurnItemRenderer key={item.node.id} item={item} />
            ))}
          {analysis.fallbackTool && <ToolLine node={analysis.fallbackTool} live={false} />}
        </div>
      )}

      {analysis.summary && (
        <AssistantText node={analysis.summary} className="mt-4" testId="minimal-summary" />
      )}
    </section>
  );
});

function AssistantText({
  node,
  className,
  testId,
  shimmer = false,
}: {
  node: AssistantNode;
  className?: string;
  testId?: string;
  /** Live activity (intro / middle narration) sweeps a shimmer to mark it as
   *  transient; the final summary never shimmers. */
  shimmer?: boolean;
}): React.JSX.Element {
  // Minimal view never renders thinking: the intro/summary text is shown as-is,
  // the node's thinking field is intentionally ignored (separated from text).
  return (
    <div
      className={cn(
        'w-full min-w-0 text-[15px] text-foreground',
        shimmer && 'relative overflow-hidden',
        className,
      )}
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid={testId}
    >
      {node.text.length > 0 && <MarkdownMessage text={node.text} />}
      {node.errorMessage && (
        <div className="mt-3 w-fit rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
          {node.errorMessage}
        </div>
      )}
      {shimmer && <ShimmerOverlay />}
    </div>
  );
}

function TurnItemRenderer({ item }: { item: MinimalTurnItem }): React.JSX.Element {
  switch (item.kind) {
    case 'tool':
      return <ToolLine node={item.node} live />;
    case 'text':
      return <AssistantText node={item.node} shimmer />;
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

  return (
    <div
      className="relative overflow-hidden py-0.5 font-mono text-[15px] text-muted-foreground"
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid={live ? 'minimal-running-tool' : 'minimal-finished-tool'}
    >
      <span className="flex items-baseline gap-1">
        <span className="shrink-0 text-foreground/80">{prefix}</span>
        <span className="min-w-0 truncate">{body}</span>
      </span>
      {live && <ShimmerOverlay />}
    </div>
  );
}
