import {
  IconChevronRight,
  IconChevronDown,
  IconCheck,
  IconX,
  IconMinus,
  IconLoader2,
} from '@tabler/icons-react';
import { useRef } from 'react';
import { type ToolNode, getToolArgs } from '../state/transcriptController';
import { MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import type { ReadGroupEntry } from '../lib/readGrouping';
import ToolBlock from './ToolBlock';
import ThinkingBlock, { ThinkingDuration } from './thinkingBlock';
import ShimmerOverlay from './shimmerOverlay';
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
    return String(args?.command ?? '');
  }
  return node.name;
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

export default function CollapsedReadGroup({
  entries,
  isActive,
  open,
  onOpenChange,
  searchQuery,
  activeToolNodeId,
  activeOccurrenceIndex,
}: CollapsedReadGroupProps): React.JSX.Element {
  const toolCount = entries.reduce(
    (count, entry) => (entry.kind === 'tool' ? count + 1 : count),
    0,
  );
  const noun = toolCount === 1 ? 'file' : 'files';
  const label = isActive ? `Looking into ${toolCount} ${noun}` : `Looked into ${toolCount} ${noun}`;

  return (
    <Collapsible className="group/collapsible mb-2" open={open} onOpenChange={onOpenChange}>
      <div className="rounded-md border border-border/65 bg-muted/25">
        <div className="rounded-t-md px-3 py-1.5">
          <CollapsibleTrigger className="inline-flex items-center gap-1 text-[15px] leading-6 text-foreground hover:text-foreground cursor-pointer transition-colors [&[data-state=open]>svg.chevron-right]:hidden [&[data-state=closed]>svg.chevron-down]:hidden">
            <span>{label}</span>
            <IconChevronRight className="chevron-right size-3.5 shrink-0" />
            <IconChevronDown className="chevron-down size-3.5 shrink-0" />
          </CollapsibleTrigger>
          <div className="mt-0.5 flex flex-col group-data-[state=open]/collapsible:hidden">
            {entries.map((entry) => {
              if (entry.kind === 'thinking') {
                const thinkingNode = entry.node;
                const snippet = thinkingNode.thinking.trim().split('\n', 1)[0];
                const thinkingInProgress =
                  thinkingNode.isStreaming && thinkingNode.thinkingEndedAt === undefined;
                return (
                  <div
                    key={thinkingNode.id}
                    className={`flex items-center gap-1.5 ${thinkingInProgress ? 'text-foreground' : 'text-foreground/70'}`}
                    data-search-ignore
                  >
                    {thinkingInProgress ? (
                      <IconLoader2 className="size-3.5 shrink-0 animate-[spin_1.8s_linear_infinite] text-muted-foreground" />
                    ) : (
                      <IconCheck className="size-3.5 shrink-0 text-[#166534]" />
                    )}
                    <span className="truncate font-mono text-[14px]">thinking {snippet}</span>
                    <ThinkingDuration
                      startedAt={thinkingNode.thinkingStartedAt}
                      endedAt={thinkingNode.thinkingEndedAt}
                      isStreaming={thinkingNode.isStreaming}
                      className="ml-auto shrink-0 pl-2 text-xs text-muted-foreground"
                    />
                  </div>
                );
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
                      <Icon className={`size-3.5 shrink-0 ${statusConfig?.className ?? ''}`} />
                    )
                  )}
                  <span className="truncate font-mono text-[14px]">{getCommandLabel(node)}</span>
                </div>
              );
            })}
          </div>
          {isActive && (
            <div className="mt-0.5 flex items-center" data-search-ignore>
              <span className="relative overflow-hidden text-[13px] text-muted-foreground">
                Working...
                <ShimmerOverlay />
              </span>
            </div>
          )}
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
