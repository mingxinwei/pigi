import React, { useRef } from 'react';
import type { RenderItem } from '../lib/readGrouping';
import {
  type TranscriptNode,
  type ToolNode,
  type AssistantNode,
} from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH, MESSAGE_ROW_GAP } from '../lib/layoutConstants';
import ToolBlock from './ToolBlock';
import MarkdownMessage from './markdownMessage';
import { useHighlightTextNodes } from '../lib/highlightMatches';
import ThinkingBlock from './thinkingBlock';
import { MessageToolbar, UserBubble, SystemBubble } from './messageBubbles';
import CollapsedReadGroup from './CollapsedReadGroup';

// Memoized so that virtualizer-driven re-renders (e.g. while the bottom terminal
// panel animates open/close and the scroll container resizes every frame) skip
// re-rendering rows whose props are unchanged, instead of reconciling every
// visible markdown/tool tree on each frame.
export const RenderItemRenderer = React.memo(function RenderItemRenderer({
  item,
  isLast,
  sessionActive,
  searchQuery,
  expanded,
  onToggleExpand,
  activeOccurrenceItemId,
  activeOccurrenceToolNodeId,
  activeOccurrenceIndex,
}: {
  item: RenderItem;
  isLast: boolean;
  sessionActive: boolean;
  searchQuery: string;
  expanded?: boolean;
  /** Stable group-toggle callback (takes the group id) so React.memo comparisons hold. */
  onToggleExpand?: (groupId: string) => void;
  activeOccurrenceItemId: string | null;
  activeOccurrenceToolNodeId: string | null;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  const activeIndex = item.id === activeOccurrenceItemId ? activeOccurrenceIndex : null;
  const activeToolNodeId = item.id === activeOccurrenceItemId ? activeOccurrenceToolNodeId : null;
  if (item.type === 'readGroup') {
    return (
      <CollapsedReadGroup
        entries={item.entries}
        isActive={isLast && sessionActive}
        open={expanded ?? false}
        onOpenChange={onToggleExpand ? () => onToggleExpand(item.id) : () => {}}
        searchQuery={searchQuery}
        activeToolNodeId={activeToolNodeId}
        activeOccurrenceIndex={activeIndex}
      />
    );
  }
  return (
    <NodeRenderer node={item.node} searchQuery={searchQuery} activeOccurrenceIndex={activeIndex} />
  );
});

function NodeRenderer({
  node,
  searchQuery,
  activeOccurrenceIndex,
}: {
  node: TranscriptNode;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return (
        <UserBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'assistant':
      return (
        <AssistantBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'tool':
      return (
        <ToolBubble
          node={node}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
    case 'system':
      return (
        <SystemBubble
          text={node.text}
          isLoading={node.isLoading}
          searchQuery={searchQuery}
          activeOccurrenceIndex={activeOccurrenceIndex}
        />
      );
  }
}

function ToolBubble({
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
    <div ref={containerRef} className="group">
      <ToolBlock node={node} />
      <MessageToolbar text={node.output} />
    </div>
  );
}

function AssistantBubble({
  node,
  searchQuery,
  activeOccurrenceIndex,
}: {
  node: AssistantNode;
  searchQuery: string;
  activeOccurrenceIndex: number | null;
}): React.JSX.Element {
  const showThinking = node.thinking.length > 0;
  const showText = node.text.length > 0;
  const contentRef = useRef<HTMLDivElement>(null);

  useHighlightTextNodes(contentRef, searchQuery, activeOccurrenceIndex);

  return (
    <div className="group flex justify-start" data-testid="assistant-message">
      <div
        ref={contentRef}
        className="w-full min-w-0 text-[15px] text-foreground"
        style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      >
        {showThinking && (
          <ThinkingBlock
            text={node.thinking}
            startedAt={node.thinkingStartedAt}
            endedAt={node.thinkingEndedAt}
            isStreaming={node.isStreaming}
          />
        )}

        {showText && (
          <div style={{ marginTop: showThinking ? `${MESSAGE_ROW_GAP}px` : undefined }}>
            <MarkdownMessage text={node.text} />
          </div>
        )}

        {node.errorMessage && (
          <div className="mt-3 w-fit rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
            {node.errorMessage}
          </div>
        )}

        <MessageToolbar text={node.text || node.thinking} />
      </div>
    </div>
  );
}
