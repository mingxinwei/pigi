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

/**
 * Wrapper identity cache. renderItems is rebuilt on every transcript commit
 * (each streaming delta); reusing the same wrapper object for an unchanged
 * node keeps React.memo bailouts working for every visible row except the
 * one actually streaming.
 *
 * Keyed weakly by node reference, with the node's mutation revision for
 * assistant nodes: the transcript controller mutates streaming assistant
 * nodes in place (object identity is stable across deltas), so reference
 * equality alone cannot detect content changes — the revision must match
 * too. Tool nodes are replaced immutably on update (fresh reference = miss),
 * user/system nodes never mutate, and dropped sessions release their
 * entries via the WeakMap.
 */
const nodeItemCache = new WeakMap<TranscriptNode, { revision: number; item: RenderItem }>();

function nodeRevision(node: TranscriptNode): number {
  return node.role === 'assistant' ? (node.revision ?? 0) : 0;
}

function getNodeItem(node: TranscriptNode): RenderItem {
  const revision = nodeRevision(node);
  const cached = nodeItemCache.get(node);
  if (cached && cached.revision === revision) {
    return cached.item;
  }
  const item: RenderItem = { type: 'node', node, id: node.id };
  nodeItemCache.set(node, { revision, item });
  return item;
}

/** Same node sequence → same cached group item, so unchanged groups keep
 *  their identity across rebuilds. A group that grew (streaming reads or
 *  absorbed thinking) gets a fresh item — exactly the invalidation we want. */
const readGroupItemCache = new WeakMap<TranscriptNode, RenderItem>();

function canonicalizeGroupItem(item: RenderItem): RenderItem {
  if (item.type !== 'readGroup') return item;
  const cacheKey = item.entries[0].node;
  const cached = readGroupItemCache.get(cacheKey);
  if (cached && cached.type === 'readGroup' && entriesReferenceEqual(cached, item)) {
    return cached;
  }
  readGroupItemCache.set(cacheKey, item);
  return item;
}

function entriesReferenceEqual(
  a: Extract<RenderItem, { type: 'readGroup' }>,
  b: Extract<RenderItem, { type: 'readGroup' }>,
): boolean {
  if (a.entries.length !== b.entries.length) return false;
  for (let index = 0; index < a.entries.length; index++) {
    // kind is derivable from the node's role, but comparing it makes the
    // "same entries sequence" invariant self-evident.
    const entryA = a.entries[index];
    const entryB = b.entries[index];
    if (entryA.kind !== entryB.kind || entryA.node !== entryB.node) return false;
  }
  return true;
}

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
      // Copy-on-absorb: replace the group instead of pushing into its entries,
      // so nothing here ever mutates an array that may already be shared
      // (e.g. a group cached by a previous canonicalize pass).
      result[result.length - 1] = {
        ...previous,
        entries: [...previous.entries, { kind: 'thinking', node: item.node }],
      };
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
    return nodes.map(getNodeItem);
  }

  const items: RenderItem[] = [];
  let currentGroup: ReadGroupEntry[] = [];

  function flushGroup(): void {
    if (currentGroup.length > 0) {
      const first = currentGroup[0];
      const firstNode = first.node;
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
      items.push(getNodeItem(node));
    }
  }
  flushGroup();

  // Canonicalize after absorb so cached wrappers reflect the final entries;
  // absorb itself is non-mutating.
  return absorbThinkingIntoReadGroups(items).map(canonicalizeGroupItem);
}
