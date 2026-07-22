import {
  type AssistantNode,
  type ToolNode,
  type TranscriptNode,
  getToolArgs,
} from '../state/transcriptController';
import { isReadOnlyBashCommand } from './readOnlyCommand';

/** A read group entry is either a read-only tool call or an absorbed thinking-only assistant message */
export type ReadGroupEntry =
  | { kind: 'tool'; node: ToolNode }
  | { kind: 'thinking'; node: AssistantNode };

/** A render item is either a single transcript node or a collapsed group of read-only entries */
export type RenderItem =
  | { type: 'node'; node: TranscriptNode; id: string }
  | { type: 'readGroup'; entries: ReadGroupEntry[]; id: string };

function isReadToolNode(node: TranscriptNode): boolean {
  if (node.role !== 'tool') return false;
  if (node.name === 'read') return true;
  if (node.name === 'bash') {
    const args = getToolArgs(node);
    const command = typeof args?.command === 'string' ? args.command : '';
    return isReadOnlyBashCommand(command);
  }
  return false;
}

function isThinkingOnlyNode(node: TranscriptNode): node is AssistantNode {
  return (
    node.role === 'assistant' &&
    node.thinking.length > 0 &&
    node.text.length === 0 &&
    !node.errorMessage
  );
}

/**
 * Absorbs any remaining thinking-only assistant messages that follow a
 * read group (edge case: thinking arrives after group flush).
 */
function absorbThinkingIntoReadGroups(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  for (const item of items) {
    const previous = result[result.length - 1];
    if (item.type === 'node' && isThinkingOnlyNode(item.node) && previous?.type === 'readGroup') {
      previous.entries.push({ kind: 'thinking', node: item.node });
      continue;
    }
    result.push(item);
  }
  return result;
}

/**
 * Groups consecutive read-only tool nodes into collapsed groups.
 * Thinking-only assistant messages between reads are absorbed directly
 * into the group (transparent to grouping). Non-read, non-thinking nodes
 * break the consecutive sequence.
 */
export function buildRenderItems(nodes: TranscriptNode[], compact: boolean): RenderItem[] {
  if (!compact) {
    return nodes.map((node) => ({ type: 'node', node, id: node.id }));
  }

  const items: RenderItem[] = [];
  let currentGroup: ReadGroupEntry[] = [];

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      const first = currentGroup[0];
      const firstNode = first.kind === 'tool' ? first.node : first.node;
      items.push({
        type: 'readGroup',
        entries: currentGroup,
        id: `group-${firstNode.id}`,
      });
      currentGroup = [];
    }
  }

  for (const node of nodes) {
    if (node.role === 'tool' && isReadToolNode(node)) {
      currentGroup.push({ kind: 'tool', node });
    } else if (isThinkingOnlyNode(node) && currentGroup.length > 0) {
      // Thinking-only messages are transparent to grouping —
      // absorb them directly into the current read group.
      currentGroup.push({ kind: 'thinking', node });
    } else {
      flushGroup();
      items.push({ type: 'node', node, id: node.id });
    }
  }
  flushGroup();

  return absorbThinkingIntoReadGroups(items);
}
