import { IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { useRef } from 'react';
import { type ToolNode, getToolArgs } from '../state/transcriptController';
import { MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import ToolBlock from './ToolBlock';
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

interface CollapsedReadGroupProps {
  nodes: ToolNode[];
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

/** Wraps a single tool node with its own highlight scope, so occurrence
 *  indices are scoped per-node and match the search-target results. */
function HighlightedToolNode({
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
    <div ref={containerRef} data-tool-node-id={node.id} className="group">
      <ToolBlock node={node} />
    </div>
  );
}

export default function CollapsedReadGroup({
  nodes,
  isActive,
  open,
  onOpenChange,
  searchQuery,
  activeToolNodeId,
  activeOccurrenceIndex,
}: CollapsedReadGroupProps): React.JSX.Element {
  const count = nodes.length;
  const noun = count === 1 ? 'file' : 'files';
  const label = isActive ? `Looking into ${count} ${noun}` : `Looked into ${count} ${noun}`;

  const latestNodeId = isActive ? nodes[nodes.length - 1].id : null;

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
            {nodes.map((node) => (
              <div
                key={node.id}
                className={`relative truncate font-mono text-[14px] overflow-hidden ${
                  node.id === latestNodeId ? 'text-foreground' : 'text-foreground/70'
                }`}
              >
                {getCommandLabel(node)}
                {node.id === latestNodeId && (
                  <span
                    className="absolute inset-0 animate-[shimmer_2.5s_linear_infinite]"
                    style={{
                      background:
                        'linear-gradient(90deg, transparent 0%, transparent 30%, rgba(255,255,255,0.95) 50%, transparent 70%, transparent 100%)',
                      backgroundSize: '200% 100%',
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        <CollapsibleContent
          className="flex flex-col px-3 pb-1.5"
          style={{ gap: `${MESSAGE_ROW_GAP * 3}px`, marginTop: `${MESSAGE_ROW_GAP * 3}px` }}
        >
          {nodes.map((node) => (
            <HighlightedToolNode
              key={node.id}
              node={node}
              searchQuery={searchQuery}
              activeOccurrenceIndex={node.id === activeToolNodeId ? activeOccurrenceIndex : null}
            />
          ))}
        </CollapsibleContent>
      </div>
    </Collapsible>
  );
}
