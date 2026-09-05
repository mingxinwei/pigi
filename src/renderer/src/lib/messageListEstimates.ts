import {
  type TranscriptNode,
  type AssistantNode,
  type ToolNode,
  getToolArgs,
} from '../state/transcriptController';
import type { RenderItem } from './readGrouping';
import { BLOCK_CONTENT_MAX_HEIGHT, READ_GROUP_MAX_COLLAPSED_ENTRIES } from './layoutConstants';
import { parseSkillBlock } from './skillBlock';

const TOOL_BLOCK_ESTIMATE_BUFFER = 24;
const TOOL_STATUS_LINE_ESTIMATE_HEIGHT = 24;
const USER_MESSAGE_TOOLBAR_HEIGHT = 24;
const USER_MESSAGE_LEADING_PADDING = 24;
const USER_MESSAGE_TRAILING_PADDING = 8;
const USER_MESSAGE_WRAP_ESTIMATE_WIDTH = 72;
/** Conservative estimate cap for the user bubble's reduced viewport clamp. */
const USER_MESSAGE_MAX_ESTIMATE_HEIGHT = 200;

/** Height estimates for collapsed read-only group */
const COLLAPSED_GROUP_TRIGGER_HEIGHT = 28;
const COLLAPSED_GROUP_COMMAND_LINE_HEIGHT = 16;
/** The "Show more" / "Show less" toggle row present when entries are hidden. */
const COLLAPSED_GROUP_SHOW_MORE_HEIGHT = 20;

export function estimateRenderItemHeight(item: RenderItem | undefined): number {
  if (!item) return 96;
  if (item.type === 'readGroup') {
    // The collapsed preview shows at most READ_GROUP_MAX_COLLAPSED_ENTRIES
    // command lines, plus the "Show more" row when entries were hidden.
    const visibleLines = Math.min(item.entries.length, READ_GROUP_MAX_COLLAPSED_ENTRIES);
    const showMoreRow =
      item.entries.length > READ_GROUP_MAX_COLLAPSED_ENTRIES ? COLLAPSED_GROUP_SHOW_MORE_HEIGHT : 0;
    return (
      COLLAPSED_GROUP_TRIGGER_HEIGHT +
      visibleLines * COLLAPSED_GROUP_COMMAND_LINE_HEIGHT +
      showMoreRow
    );
  }
  return estimateNodeHeight(item.node);
}

function estimateNodeHeight(node: TranscriptNode | undefined): number {
  if (!node) {
    return 96;
  }
  switch (node.role) {
    case 'user':
      return estimateUserHeight(node.text);
    case 'assistant':
      return estimateAssistantHeight(node);
    case 'tool':
      return estimateToolHeight(node);
    case 'system':
      return 56;
  }
}

function estimateUserHeight(text: string): number {
  if (parseSkillBlock(text)) {
    return 88;
  }
  const visibleLineCount = countLines(text);
  const characterLineCount = Math.ceil(text.length / USER_MESSAGE_WRAP_ESTIMATE_WIDTH);
  const estimatedLineCount = Math.max(visibleLineCount, characterLineCount);
  const rawHeight =
    estimatedLineCount * 24 +
    20 +
    USER_MESSAGE_TOOLBAR_HEIGHT +
    USER_MESSAGE_LEADING_PADDING +
    USER_MESSAGE_TRAILING_PADDING;
  return Math.max(56, Math.min(rawHeight, USER_MESSAGE_MAX_ESTIMATE_HEIGHT));
}

function estimateAssistantHeight(node: AssistantNode): number {
  const thinkingLineCap = Math.ceil(BLOCK_CONTENT_MAX_HEIGHT / 20) + 4; // lines + header slack
  const thinkingLineCount = Math.min(countLines(node.thinking), thinkingLineCap);
  const textLength = node.text.length + Math.min(node.thinking.length, thinkingLineCap * 84);
  const lineCount = countLines(node.text) + thinkingLineCount;
  return Math.max(80, Math.max(Math.ceil(textLength / 84), lineCount) * 24 + 56);
}

function estimateToolHeight(node: ToolNode): number {
  const outputLineCount = node.output ? node.output.split('\n').length : 0;
  const commandLineCount = estimateToolCommandLineCount(node);
  const contentHeight = outputLineCount * 20;
  const cappedContentHeight = Math.min(contentHeight, BLOCK_CONTENT_MAX_HEIGHT);

  return Math.max(
    96,
    commandLineCount * 24 +
      cappedContentHeight +
      TOOL_STATUS_LINE_ESTIMATE_HEIGHT +
      TOOL_BLOCK_ESTIMATE_BUFFER,
  );
}

function countLines(text: string): number {
  if (!text) {
    return 0;
  }
  return text.split('\n').length;
}

function estimateToolCommandLineCount(node: ToolNode): number {
  const args = getToolArgs(node);
  const command =
    node.name === 'bash'
      ? `$ ${String(args?.command ?? '')}`
      : node.name === 'read' || node.name === 'write' || node.name === 'edit'
        ? `${node.name} ${String(args?.path ?? '')}`
        : String(JSON.stringify(args ?? {}) ?? '');

  return Math.min(2, Math.max(1, Math.ceil(command.length / 80)));
}
