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
  type MinimalSystemItem,
  type MinimalTurnAnalysis,
} from '../lib/minimalTurns';
import MarkdownMessage from './markdownMessage';
import ToolBlock from './ToolBlock';
import ThinkingBlock from './thinkingBlock';
import { MessageToolbar, SystemBubble, UserBubble } from './messageBubbles';
import { getToolCommandParts } from '../lib/toolDisplay';
import ShimmerOverlay, {
  SHIMMER_BAND_WIDTH_PX,
  SHIMMER_SPEED_PX_PER_SECOND,
} from './shimmerOverlay';
import { cn } from '../lib/utils';

/**
 * MinimalView - minimal/codex-style activity view.
 *
 * Each user message starts a turn: the agent's first text message (intro) is
 * rendered at the top, followed by a "Working for Xm Ys" timer and a divider.
 * Below them sits the activity feed: the turn's current activity (a running
 * tool, or a thinking placeholder). The feed is event-driven and never
 * queues — during a burst faster than the eye can follow, only the latest
 * pending arrival survives (middle ones drop). Text-bearing messages render
 * in the current-message slot, newest replacing the previous one; the turn
 * ends with the agent's final text message (the summary) landing there.
 */

interface MinimalViewProps {
  nodes: TranscriptNode[];
  sessionStatus: AgentStatus;
  /** Called when the user expands a turn's details — MessageList preserves
   *  active output-follow state or releases a finished turn's pin. */
  onExpandDetails: (isActive: boolean) => void;
  /** Called when a turn finishes — MessageList releases the top pin. */
  onTurnEnd?: (turnId: string) => void;
  /** Called when expanded details collapse — MessageList re-pins the
   *  working area (the pin was only dropped so the details could be read). */
  onCollapseDetails?: (isActive: boolean) => void;
  /** Called with true when a collapse starts and false when it ends —
   *  MessageList stands the auto-scroll ResizeObserver down for the
   *  duration. */
  onCollapseChange?: (isCollapsing: boolean) => void;
  /** Reports each working turn's section height for output-follow. */
  onOutputGrowth?: (height: number) => void;
  /** The message list scroll container ref. */
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
          scrollContainerRef={scrollContainerRef}
        />
      ))}
    </div>
  );
}

/** Each feed row stays visible at least this long before being replaced. */
const MIN_ACTIVITY_VISIBLE_MS = 1000;

/** Scroll a DOM element to a position. Extracted so the react-compiler does
 *  not flag prop-derived element mutation inside layout effects. */
function scrollTo(element: HTMLElement, position: number): void {
  element.scrollTop = position;
}

// =============================================================================
// Turn
// =============================================================================

/** Geometry captured at collapse-click time, consumed by useLayoutEffect. */
interface CollapseSnapshot {
  startScrollTop: number;
  sectionTop: number;
  containerTop: number;
  headerWasPinned: boolean;
  isActive: boolean;
}

const TurnSection = React.memo(function TurnSection({
  turn,
  analysis,
  onExpandDetails,
  onTurnEnd,
  onCollapseDetails,
  onCollapseChange,
  onOutputGrowth,
  scrollContainerRef,
}: {
  turn: MinimalTurn;
  analysis: MinimalTurnAnalysis;
  onExpandDetails: (isActive: boolean) => void;
  onTurnEnd?: (turnId: string) => void;
  onCollapseDetails?: (isActive: boolean) => void;
  onCollapseChange?: (isCollapsing: boolean) => void;
  onOutputGrowth?: (height: number) => void;
  scrollContainerRef?: React.RefObject<HTMLDivElement | null>;
}): React.JSX.Element {
  const [detailsOpen, setDetailsOpen] = useState(false);
  const previousIsActiveRef = useRef(analysis.isActive);

  useEffect(() => {
    const wasActive = previousIsActiveRef.current;
    previousIsActiveRef.current = analysis.isActive;
    if (wasActive && !analysis.isActive) {
      onTurnEnd?.(turn.id);
    }
  }, [analysis.isActive, onTurnEnd, turn.id]);

  // Track section height for output-follow while the turn is active.
  const sectionRef = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!analysis.isActive) return;
    const sectionElement = sectionRef.current;
    if (!sectionElement) return;
    const observer = new ResizeObserver(() => {
      onOutputGrowth?.(sectionElement.getBoundingClientRect().height);
    });
    observer.observe(sectionElement);
    return () => observer.disconnect();
  }, [analysis.isActive, onOutputGrowth]);

  // Snapshot captured at collapse-click, consumed once by the layout effect.
  const collapseSnapshotRef = useRef<CollapseSnapshot | null>(null);

  const handleToggleDetails = useCallback(() => {
    if (!detailsOpen) {
      // Expanding: preserve active output-follow or release a finished pin.
      onExpandDetails(analysis.isActive);
      setDetailsOpen(true);
      return;
    }
    // Collapsing: capture geometry before the DOM changes.
    const container = scrollContainerRef?.current;
    const section = sectionRef.current;
    if (container && section) {
      const containerTop = container.getBoundingClientRect().top;
      const sectionTop = section.getBoundingClientRect().top;
      collapseSnapshotRef.current = {
        startScrollTop: container.scrollTop,
        sectionTop,
        containerTop,
        headerWasPinned: sectionTop < containerTop,
        isActive: analysis.isActive,
      };
    }
    // Suppress ResizeObserver during the transition.
    onCollapseChange?.(true);
    setDetailsOpen(false);
  }, [detailsOpen, analysis.isActive, onExpandDetails, onCollapseChange, scrollContainerRef]);

  // Scroll correction: runs after React commits the collapsed layout,
  // before the browser paints — no visual glitch, no compensation spacer.
  useLayoutEffect(() => {
    const snapshot = collapseSnapshotRef.current;
    if (!snapshot) return;
    collapseSnapshotRef.current = null;

    const scrollElement = scrollContainerRef?.current;
    if (!scrollElement) {
      onCollapseChange?.(false);
      return;
    }

    if (snapshot.isActive) {
      // Active turn: re-pin. onCollapseDetails sets the padding and scrolls
      // to the section top; the parent setState commits in the NEXT render
      // so observers resume after that.
      onCollapseDetails?.(snapshot.isActive);
      requestAnimationFrame(() => {
        onCollapseChange?.(false);
      });
      return;
    }

    // Finished turn: scroll to the correct rest position.
    const maxScroll = scrollElement.scrollHeight - scrollElement.clientHeight;
    const target = snapshot.headerWasPinned
      ? snapshot.startScrollTop + (snapshot.sectionTop - snapshot.containerTop)
      : snapshot.startScrollTop;
    scrollTo(scrollElement, Math.min(target, maxScroll));
    onCollapseDetails?.(snapshot.isActive);
    onCollapseChange?.(false);
  });

  const showTimer = shouldShowTimer(analysis);
  const showIntro =
    analysis.intro !== null &&
    (analysis.isActive || (!analysis.hasTools && analysis.intro === analysis.summary));
  const isPureSystemTurn =
    turn.userNode === null &&
    turn.entries.length > 0 &&
    turn.entries.every((node) => node.role === 'system');

  // The current assistant message: newest text-bearing message after the
  // intro. Each new message replaces the previous; the summary lands here.
  const currentMsg = useMemo(() => {
    let last: AssistantNode | null = null;
    for (const node of turn.entries) {
      if (
        node.role === 'assistant' &&
        (node.text.length > 0 || node.errorMessage !== undefined) &&
        node !== analysis.intro
      ) {
        last = node;
      }
    }
    return last;
  }, [turn.entries, analysis.intro]);

  // Activity feed: at most one row, paced so each stays visible at least
  // MIN_ACTIVITY_VISIBLE_MS. The last activity remains until its replacement
  // arrives, avoiding a blank row between a finished tool and the next event.
  const activeKeys = useMemo(
    () =>
      new Set(
        turn.entries
          .filter(
            (node) =>
              (node.role === 'tool' && node.status === 'running') ||
              (node.role === 'assistant' &&
                node.errorMessage === undefined &&
                node.text.length === 0),
          )
          .map((node) => node.id),
      ),
    [turn.entries],
  );

  const [feed, setFeed] = useState<{ key: string; shownAt: number } | null>(null);
  const seenKeysRef = useRef<Set<string>>(new Set());
  const pendingKeyRef = useRef<string | null>(null);
  const flushTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (!analysis.isActive) return;
    // New activities: show immediately if the slot is free, otherwise defer.
    const newKeys = [...activeKeys].filter((key) => !seenKeysRef.current.has(key));
    if (newKeys.length === 0) return;
    for (const key of newKeys) seenKeysRef.current.add(key);

    const now = Date.now();
    if (feed === null) {
      setFeed({ key: newKeys[newKeys.length - 1], shownAt: now });
      return;
    }

    const waitMs = MIN_ACTIVITY_VISIBLE_MS - (now - feed.shownAt);
    const latestKey = newKeys[newKeys.length - 1];
    if (waitMs <= 0) {
      setFeed({ key: latestKey, shownAt: now });
    } else {
      // Current row is still young: park the latest arrival and flush later.
      pendingKeyRef.current = latestKey;
      if (flushTimerRef.current) clearTimeout(flushTimerRef.current);
      flushTimerRef.current = setTimeout(() => {
        flushTimerRef.current = null;
        const pending = pendingKeyRef.current;
        pendingKeyRef.current = null;
        if (pending !== null) {
          setFeed({ key: pending, shownAt: Date.now() });
        }
      }, waitMs);
    }
    return undefined;
  }, [activeKeys, analysis.isActive, feed]);

  // Cancel pending flush when the turn ends.
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

  const nodeById = useMemo(
    () => new Map(turn.entries.map((node) => [node.id, node])),
    [turn.entries],
  );
  const nodeIndexById = useMemo(
    () => new Map(turn.entries.map((node, index) => [node.id, index])),
    [turn.entries],
  );
  const introIndex = analysis.intro ? nodeIndexById.get(analysis.intro.id) : undefined;
  const currentMessageIndex = currentMsg ? nodeIndexById.get(currentMsg.id) : undefined;
  const pinnedRowsBeforeIntro: React.ReactNode[] = [];
  const pinnedRowsBeforeCurrent: React.ReactNode[] = [];
  const pinnedRowsAfterCurrent: React.ReactNode[] = [];
  for (const item of analysis.items) {
    const row = <TurnItemRenderer key={item.node.id} item={item} />;
    if (introIndex !== undefined && item.index < introIndex) {
      pinnedRowsBeforeIntro.push(row);
    } else if (currentMessageIndex !== undefined && item.index < currentMessageIndex) {
      pinnedRowsBeforeCurrent.push(row);
    } else {
      pinnedRowsAfterCurrent.push(row);
    }
  }
  const feedNodeIndex = feed ? nodeIndexById.get(feed.key) : undefined;
  const feedNode = feed ? nodeById.get(feed.key) : undefined;
  // Assistant output hides an older activity row (especially when the summary
  // starts), but a later tool/thinking event may replace it and show again.
  // A single SDK assistant message can transition from thinking into text;
  // once it has text, that same node is output rather than feed activity.
  const isFeedActivity =
    feedNode?.role === 'tool' ||
    (feedNode?.role === 'assistant' &&
      feedNode.errorMessage === undefined &&
      feedNode.text.length === 0);
  const showFeed =
    analysis.isActive &&
    isFeedActivity &&
    feedNodeIndex !== undefined &&
    (currentMessageIndex === undefined || feedNodeIndex > currentMessageIndex);
  let feedRow: React.ReactNode = null;
  if (showFeed && feedNode?.role === 'tool') {
    feedRow = <ToolLine key={feedNode.id} node={feedNode} />;
  } else if (showFeed && feedNode?.role === 'assistant') {
    feedRow = (
      <div
        key={feedNode.id}
        className="relative w-fit overflow-hidden text-[15px] text-muted-foreground"
        data-testid="minimal-thinking"
      >
        Thinking...
        <ShimmerOverlay />
      </div>
    );
  }

  return (
    <section
      ref={sectionRef}
      className={cn('mt-8 first:mt-0', isPureSystemTurn && 'mt-2')}
      data-testid="minimal-turn"
      data-turn-id={turn.id}
    >
      {turn.userNode && (
        <div data-display-index={turn.userIndex}>
          <UserBubble node={turn.userNode} searchQuery="" activeOccurrenceIndex={null} />
        </div>
      )}

      {showTimer && (
        <div className={cn('flex flex-col', detailsOpen && 'sticky top-0 z-20 bg-background')}>
          <button
            type="button"
            onClick={handleToggleDetails}
            aria-expanded={detailsOpen}
            className="flex w-full items-center gap-1.5 pt-3 pb-1 text-left"
            data-testid="minimal-timer-row"
          >
            <WorkingTimer
              startAt={analysis.startAt}
              endAt={analysis.endAt}
              active={analysis.isActive}
            />
            <IconChevronRight
              className={cn(
                'size-4 shrink-0 text-muted-foreground/50 transition-transform',
                detailsOpen && 'rotate-90',
              )}
            />
          </button>
          <div className="h-px bg-border/60" data-testid="minimal-divider" />
        </div>
      )}

      {detailsOpen ? (
        <div className="mt-2" data-testid="minimal-details-wrapper">
          <div className="overflow-hidden" data-testid="minimal-details">
            <div className="flex flex-col gap-2 pb-1">
              {turn.entries.map((node) => (
                <DetailItem key={node.id} node={node} />
              ))}
            </div>
          </div>
        </div>
      ) : (
        <CollapsedContent
          showIntro={showIntro}
          intro={analysis.intro}
          currentMsg={currentMsg}
          summary={analysis.summary}
          pinnedRowsBeforeIntro={pinnedRowsBeforeIntro}
          pinnedRowsBeforeCurrent={pinnedRowsBeforeCurrent}
          pinnedRowsAfterCurrent={pinnedRowsAfterCurrent}
          feedRow={feedRow}
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

function TurnItemRenderer({ item }: { item: MinimalSystemItem }): React.JSX.Element {
  return (
    <SystemBubble
      text={item.node.text}
      isLoading={item.node.isLoading}
      searchQuery=""
      activeOccurrenceIndex={null}
    />
  );
}

function CollapsedContent({
  showIntro,
  intro,
  currentMsg,
  summary,
  pinnedRowsBeforeIntro,
  pinnedRowsBeforeCurrent,
  pinnedRowsAfterCurrent,
  feedRow,
}: {
  showIntro: boolean;
  intro: AssistantNode | null;
  currentMsg: AssistantNode | null;
  summary: AssistantNode | null;
  pinnedRowsBeforeIntro: React.ReactNode[];
  pinnedRowsBeforeCurrent: React.ReactNode[];
  pinnedRowsAfterCurrent: React.ReactNode[];
  feedRow: React.ReactNode;
}): React.JSX.Element {
  return (
    <div className="mt-2" data-testid="minimal-collapsed">
      <div className="overflow-hidden">
        <div className="flex flex-col gap-1">
          {pinnedRowsBeforeIntro}
          {showIntro && (
            <div className="group" data-testid="minimal-intro">
              <AssistantText node={intro!} />
              {intro === summary && (
                <MessageToolbar text={intro!.text || intro!.errorMessage || ''} />
              )}
            </div>
          )}
          {pinnedRowsBeforeCurrent}
          {currentMsg && (
            <div className={cn('group', showIntro && 'mt-2')} data-testid="minimal-current-msg">
              <AssistantText node={currentMsg} />
              {currentMsg === summary && (
                <MessageToolbar text={currentMsg.text || currentMsg.errorMessage || ''} />
              )}
            </div>
          )}
          {pinnedRowsAfterCurrent}
          {feedRow && (
            <div className="flex h-[27px] items-center overflow-hidden" data-testid="minimal-feed">
              {feedRow}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailItem({ node }: { node: TranscriptNode }): React.JSX.Element | null {
  if (node.role === 'tool') {
    return (
      <div className="group">
        <ToolBlock node={node} />
        <MessageToolbar text={node.output} />
      </div>
    );
  }
  if (node.role === 'assistant') {
    return (
      <div className="group">
        {node.thinking.length > 0 && (
          <ThinkingBlock
            text={node.thinking}
            startedAt={node.thinkingStartedAt}
            endedAt={node.thinkingEndedAt}
            isStreaming={node.isStreaming}
          />
        )}
        {(node.text.length > 0 || node.errorMessage) && <AssistantText node={node} />}
        <MessageToolbar text={node.text || node.thinking} />
      </div>
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

const COMMAND_TAIL_CHARS = 20;

function ToolLine({ node }: { node: ToolNode }): React.JSX.Element {
  const { prefix, body } = getToolCommandParts(node);
  const bodyRef = useRef<HTMLSpanElement>(null);
  const showTail = body.length > COMMAND_TAIL_CHARS;

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
    <div
      className="relative w-fit max-w-full overflow-hidden py-0.5 font-mono text-[15px] text-muted-foreground"
      style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      data-testid="minimal-running-tool"
    >
      <span className="flex items-baseline gap-1">
        <span className="shrink-0 text-foreground/80">{prefix}</span>
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
