import {
  IconChevronRight,
  IconChevronDown,
  IconChevronUp,
  IconCheck,
  IconX,
  IconMinus,
  IconLoader2,
  IconBrain,
} from '@tabler/icons-react';

const MAX_COLLAPSED_ENTRIES = 3;
import { useRef, useState, useMemo } from 'react';
import { type ToolNode, type AssistantNode, getToolArgs } from '../state/transcriptController';
import { collapseCommandNewlines } from '../lib/toolDisplay';
import { MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import type { ReadGroupEntry } from '../lib/readGrouping';
import { extractEffectiveCommand, isReadOnlyGitCommand } from '../lib/readOnlyCommand';
import ToolBlock from './ToolBlock';
import ThinkingBlock, { ThinkingDuration } from './thinkingBlock';

import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';
import { useHighlightTextNodes } from '../lib/highlightMatches';

function getCommandLabel(node: ToolNode): string {
  const args = getToolArgs(node);
  if (node.name === 'read') {
    const path = String(args?.path ?? '');
    const offset = typeof args?.offset === 'number' ? args.offset : undefined;
    const limit = typeof args?.limit === 'number' ? args.limit : undefined;
    if (offset != null || limit != null) {
      const from = offset ?? 1;
      const to = limit != null ? from + limit - 1 : undefined;
      const range = to != null ? `:${from}-${to}` : `:${from}`;
      return `read ${path}${range}`;
    }
    return `read ${path}`;
  }
  if (node.name === 'bash') {
    return collapseCommandNewlines(String(args?.command ?? ''));
  }
  return node.name;
}

/** Characters kept at the end of an over-long command label. The head shrinks
 *  with an ellipsis and this tail stays visible, so the label ellipsizes in the
 *  middle rather than the end — the end of a path/command is usually the useful
 *  part (filename, line range, final args). */
const COMMAND_LABEL_TAIL_CHARS = 20;

/** A command label that ellipsizes in the middle instead of the end. Splits the
 *  text into a shrinking head (end-truncated) and a fixed tail that always shows.
 *  As the row widens, more of the head becomes visible; when it fits, head + tail
 *  reconstruct the original string seamlessly. */
function MiddleTruncatedLabel({ text }: { text: string }): React.JSX.Element {
  if (text.length <= COMMAND_LABEL_TAIL_CHARS) {
    return <span className="truncate font-mono text-[14px]">{text}</span>;
  }
  const splitAt = text.length - COMMAND_LABEL_TAIL_CHARS;
  return (
    <span className="flex min-w-0 flex-1 font-mono text-[14px]">
      <span className="truncate">{text.slice(0, splitAt)}</span>
      <span className="shrink-0 whitespace-pre">{text.slice(splitAt)}</span>
    </span>
  );
}

const ENTRY_STATUS_ICON = {
  success: { Icon: IconCheck, className: 'text-[#166534]' },
  error: { Icon: IconX, className: 'text-[#991b1b]' },
  cancelled: { Icon: IconMinus, className: 'text-[#3f3f46]' },
} as const;

interface CollapsedReadGroupProps {
  entries: ReadGroupEntry[];
  /** True when this group is still potentially growing (last group + agent active) */
  isActive: boolean;
  /** Controlled open state */
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** Current search query for text highlighting */
  searchQuery: string;
  /** ID of the tool node that should receive the active highlight (inside this group) */
  activeToolNodeId: string | null;
  /** Occurrence index for the active tool node */
  activeOccurrenceIndex: number | null;
}

/** Wraps an entry with its own highlight scope, so occurrence
 *  indices are scoped per-node and match the search-target results. */
function HighlightedEntry({
  nodeId,
  searchQuery,
  activeOccurrenceIndex,
  children,
}: {
  nodeId: string;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
  children: React.ReactNode;
}): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  useHighlightTextNodes(containerRef, searchQuery, activeOccurrenceIndex);

  return (
    <div ref={containerRef} data-tool-node-id={nodeId} className="group">
      {children}
    </div>
  );
}

/** A thinking row inside a collapsed read group. Shows a header with
 *  duration and chevron. Clicking expands/collapses the full thinking block inline. */
function ThinkingGroupRow({ node }: { node: AssistantNode }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const thinkingInProgress = node.isStreaming && node.thinkingEndedAt === undefined;

  return (
    <div className="flex flex-col">
      <button
        type="button"
        className="flex w-full items-center gap-1.5 text-left"
        onClick={() => setExpanded(!expanded)}
      >
        {thinkingInProgress ? (
          <IconLoader2 className="size-3.5 shrink-0 animate-[spin_1.8s_linear_infinite] text-muted-foreground [stroke-width:2]" />
        ) : (
          <IconBrain className="size-3.5 shrink-0 text-muted-foreground [stroke-width:2]" />
        )}
        <span
          className={`text-[14px] ${thinkingInProgress ? 'text-foreground' : 'text-foreground/70'}`}
        >
          Thinking
        </span>
        <ThinkingDuration
          startedAt={node.thinkingStartedAt}
          endedAt={node.thinkingEndedAt}
          isStreaming={node.isStreaming}
          className="ml-0.5 shrink-0 text-xs text-muted-foreground"
        />
        <IconChevronRight
          className={`-ml-1 size-3.5 shrink-0 text-muted-foreground transition-transform ${expanded ? 'rotate-90' : ''}`}
        />
      </button>
      {expanded && (
        <div className="mt-1 ml-5">
          <ThinkingBlock
            text={node.thinking}
            startedAt={node.thinkingStartedAt}
            endedAt={node.thinkingEndedAt}
            isStreaming={node.isStreaming}
          />
        </div>
      )}
    </div>
  );
}

function isGitReadCommand(command: string): boolean {
  const effective = extractEffectiveCommand(command);
  return /^git\s/.test(effective) && isReadOnlyGitCommand(effective);
}

function buildGroupLabel(
  isActive: boolean,
  fileCount: number,
  gitCount: number,
  thinkingCount: number,
): string {
  const parts: string[] = [];

  if (fileCount > 0) {
    const noun = fileCount === 1 ? 'file' : 'files';
    parts.push(isActive ? `Exploring ${fileCount} ${noun}` : `Explored ${fileCount} ${noun}`);
  }
  if (gitCount > 0) {
    const noun = gitCount === 1 ? 'time' : 'times';
    parts.push(isActive ? `Checking git ${gitCount} ${noun}` : `Checked git ${gitCount} ${noun}`);
  }
  if (thinkingCount > 0) {
    const noun = thinkingCount === 1 ? 'time' : 'times';
    parts.push(isActive ? `Thinking ${thinkingCount} ${noun}` : `Thought ${thinkingCount} ${noun}`);
  }

  if (parts.length === 0) {
    return isActive ? 'Working...' : 'Done';
  }

  // First part keeps its capital; subsequent parts are lowercased for natural sentence flow
  const tail = parts.slice(1).map((p) => p[0].toLowerCase() + p.slice(1));
  return parts[0] + (tail.length > 0 ? ', ' + tail.join(', ') : '');
}

export default function CollapsedReadGroup({
  entries,
  isActive,
  open,
  onOpenChange,
  searchQuery,
  activeToolNodeId,
  activeOccurrenceIndex,
}: CollapsedReadGroupProps): React.JSX.Element {
  let fileCount = 0;
  let gitCount = 0;
  let thinkingCount = 0;
  for (const entry of entries) {
    if (entry.kind === 'thinking') {
      thinkingCount++;
    } else {
      const node = entry.node;
      const args = getToolArgs(node);
      const command = node.name === 'bash' && typeof args?.command === 'string' ? args.command : '';
      if (isGitReadCommand(command)) {
        gitCount++;
      } else {
        fileCount++;
      }
    }
  }
  const label = buildGroupLabel(isActive, fileCount, gitCount, thinkingCount);

  const [showAllEntries, setShowAllEntries] = useState(false);
  const hasOverflow = entries.length > MAX_COLLAPSED_ENTRIES;
  const visibleEntries = useMemo(
    () =>
      showAllEntries || !hasOverflow
        ? entries
        : entries.slice(entries.length - MAX_COLLAPSED_ENTRIES),
    [entries, showAllEntries, hasOverflow],
  );

  return (
    <Collapsible className="group/collapsible mb-[22px]" open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border border-border/65 bg-muted/25">
        <div className="rounded-t-md px-3 py-1.5">
          <CollapsibleTrigger className="inline-flex items-center gap-1 text-[15px] leading-6 text-foreground hover:text-foreground cursor-pointer transition-colors [&[data-state=open]>svg.chevron-right]:hidden [&[data-state=closed]>svg.chevron-down]:hidden">
            <span>{label}</span>
            <IconChevronRight className="chevron-right size-3.5 shrink-0" />
            <IconChevronDown className="chevron-down size-3.5 shrink-0" />
          </CollapsibleTrigger>
          <div className="mt-0.5 flex flex-col group-data-[state=open]/collapsible:hidden">
            {hasOverflow && (
              <button
                type="button"
                className="flex w-fit items-center gap-1 text-[14px] text-muted-foreground transition-colors hover:text-foreground"
                onClick={(event) => {
                  event.stopPropagation();
                  setShowAllEntries((prev) => !prev);
                }}
              >
                {showAllEntries ? (
                  <>
                    Show less
                    <IconChevronDown className="size-3.5" />
                  </>
                ) : (
                  <>
                    Show more
                    <IconChevronUp className="size-3.5" />
                  </>
                )}
              </button>
            )}
            {visibleEntries.map((entry) => {
              if (entry.kind === 'thinking') {
                return <ThinkingGroupRow key={entry.node.id} node={entry.node} />;
              }
              const node = entry.node;
              const statusConfig =
                node.status === 'running' ? null : ENTRY_STATUS_ICON[node.status];
              const Icon = statusConfig?.Icon;
              return (
                <div
                  key={node.id}
                  className={`flex items-center gap-1.5 ${node.status === 'running' ? 'text-foreground' : 'text-foreground/70'}`}
                >
                  {node.status === 'running' ? (
                    <IconLoader2 className="size-3.5 shrink-0 animate-[spin_1.8s_linear_infinite] text-muted-foreground" />
                  ) : (
                    Icon && (
                      <Icon
                        className={`size-3.5 shrink-0 [stroke-width:2] ${statusConfig?.className ?? ''}`}
                      />
                    )
                  )}
                  <MiddleTruncatedLabel text={getCommandLabel(node)} />
                </div>
              );
            })}
          </div>
        </div>
        <CollapsibleContent
          className="flex flex-col px-3 pb-1.5"
          style={{ gap: `${MESSAGE_ROW_GAP * 3}px`, marginTop: `${MESSAGE_ROW_GAP * 3}px` }}
        >
          {entries.map((entry) => (
            <HighlightedEntry
              key={entry.node.id}
              nodeId={entry.node.id}
              searchQuery={searchQuery}
              activeOccurrenceIndex={
                entry.node.id === activeToolNodeId ? activeOccurrenceIndex : null
              }
            >
              {entry.kind === 'tool' ? (
                <ToolBlock node={entry.node} />
              ) : (
                <ThinkingBlock
                  text={entry.node.thinking}
                  startedAt={entry.node.thinkingStartedAt}
                  endedAt={entry.node.thinkingEndedAt}
                  isStreaming={entry.node.isStreaming}
                />
              )}
            </HighlightedEntry>
          ))}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
