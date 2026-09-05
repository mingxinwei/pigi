import type { MessageSearchTarget } from './MessageSearch';
import type { RenderItem } from '../lib/readGrouping';
import { type ToolNode, type TranscriptNode } from '../state/transcriptController';
import { getToolCommandParts, getToolSearchText } from '../lib/toolDisplay';

/** Extract a search-friendly command string for a tool node, matching the text rendered in the tool label. */
function getToolSearchMeta(node: ToolNode): string {
  const { prefix, body } = getToolCommandParts(node);
  return `${prefix}${body}`;
}

export function buildSearchTargets(items: RenderItem[]): MessageSearchTarget[] {
  const targets: MessageSearchTarget[] = [];
  for (let renderIndex = 0; renderIndex < items.length; renderIndex++) {
    const item = items[renderIndex];
    if (item.type === 'readGroup') {
      for (const entry of item.entries) {
        if (entry.kind === 'tool') {
          targets.push({
            renderIndex,
            itemId: item.id,
            groupId: item.id,
            toolNodeId: entry.node.id,
            role: 'tool',
            text: getToolSearchText(entry.node),
            meta: getToolSearchMeta(entry.node),
            preview: entry.node.output || getToolSearchMeta(entry.node),
          });
        } else {
          targets.push({
            renderIndex,
            itemId: item.id,
            groupId: item.id,
            toolNodeId: entry.node.id,
            role: 'assistant',
            text: entry.node.thinking,
            meta: '',
            preview: entry.node.thinking,
          });
        }
      }
    } else {
      const node: TranscriptNode = item.node;
      switch (node.role) {
        case 'user':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'user',
            text: node.text,
            meta: '',
            preview: node.text,
          });
          break;
        case 'assistant':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'assistant',
            text: node.text,
            meta: node.thinking,
            preview: node.text || node.thinking,
          });
          break;
        case 'tool':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'tool',
            text: getToolSearchText(node),
            meta: getToolSearchMeta(node),
            preview: node.output || getToolSearchMeta(node),
          });
          break;
        case 'system':
          targets.push({
            renderIndex,
            itemId: item.id,
            role: 'system',
            text: node.text,
            meta: '',
            preview: node.text,
          });
          break;
      }
    }
  }
  return targets;
}
