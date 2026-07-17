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
 * Folds thinking-only assistant messages sandwiched between two read groups
 * into the surrounding group, so the collapsed view renders the thought as a
 * single row ("thinking ...") instead of a separate block. Group identity is
 * preserved (first group's id) so expanded state survives the merge.
 */
function absorbThinkingIntoReadGroups(items: RenderItem[]): RenderItem[] {
  const result: RenderItem[] = [];
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const previous = result[result.length - 1];
    const next = items[index + 1];
    if (
      item.type === 'node' &&
      isThinkingOnlyNode(item.node) &&
      previous?.type === 'readGroup' &&
      next?.type === 'readGroup'
    ) {
      previous.entries.push({ kind: 'thinking', node: item.node }, ...next.entries);
      index++; // skip the merged-away group
      continue;
    }
    result.push(item);
  }
  return result;
}

/**
 * Groups consecutive read-only tool nodes into collapsed groups.
 * Non-read-only nodes break the consecutive sequence. Thinking-only
 * assistant messages between two groups are absorbed into the group.
 */
export function buildRenderItems(nodes: TranscriptNode[], compact: boolean): RenderItem[] {
  if (!compact) {
    return nodes.map((node) => ({ type: 'node', node, id: node.id }));
  }

  const items: RenderItem[] = [];
  let currentGroup: ToolNode[] = [];

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      items.push({
        type: 'readGroup',
        entries: currentGroup.map((node) => ({ kind: 'tool', node })),
        id: `group-${currentGroup[0].id}`,
      });
      currentGroup = [];
    }
  }

  for (const node of nodes) {
    if (node.role === 'tool' && isReadToolNode(node)) {
      currentGroup.push(node);
    } else {
      flushGroup();
      items.push({ type: 'node', node, id: node.id });
    }
  }
  flushGroup();

  return absorbThinkingIntoReadGroups(items);
}
