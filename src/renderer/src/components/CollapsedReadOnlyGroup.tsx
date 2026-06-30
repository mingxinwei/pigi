import { IconChevronRight, IconChevronDown } from '@tabler/icons-react';
import { type ToolNode, getToolArgs } from '../state/transcriptController';
import { MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import ToolBlock from './ToolBlock';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from './ui/collapsible';

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

interface CollapsedReadOnlyGroupProps {
  nodes: ToolNode[];
  /** True when this group is still potentially growing (last group + agent active) */
  isActive: boolean;
}

export default function CollapsedReadOnlyGroup({
  nodes,
  isActive,
}: CollapsedReadOnlyGroupProps): React.JSX.Element {
  const count = nodes.length;
  const noun = count === 1 ? 'file' : 'files';
  const label = isActive ? `Looking into ${count} ${noun}` : `Looked into ${count} ${noun}`;

  const latestNodeId = isActive ? nodes[nodes.length - 1].id : null;

  return (
    <Collapsible className="mb-2">
      <div>
        <CollapsibleTrigger className="inline-flex items-center gap-1 text-[15px] leading-6 text-muted-foreground hover:text-foreground cursor-pointer transition-colors [&[data-state=open]>svg.chevron-right]:hidden [&[data-state=closed]>svg.chevron-down]:hidden">
          <span>{label}</span>
          <IconChevronRight className="chevron-right size-3.5 shrink-0" />
          <IconChevronDown className="chevron-down size-3.5 shrink-0" />
        </CollapsibleTrigger>
        <div className="mt-0.5 flex flex-col">
          {nodes.map((node) => (
            <div
              key={node.id}
              className={`relative truncate font-mono text-xs overflow-hidden ${
                node.id === latestNodeId ? 'text-muted-foreground/70' : 'text-muted-foreground/50'
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
        className="flex flex-col"
        style={{ gap: `${MESSAGE_ROW_GAP * 3}px`, marginTop: `${MESSAGE_ROW_GAP * 3}px` }}
      >
        {nodes.map((node) => (
          <div key={node.id} className="group">
            <ToolBlock node={node} />
          </div>
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}
