import {
  type AgentStatus,
  type AssistantNode,
  type SystemNode,
  type ToolNode,
  type TranscriptNode,
  type UserNode,
} from '../state/transcriptController';

/**
 * Minimal view: transcript nodes are grouped into turns, one per user message.
 * Within a turn, the first text-bearing assistant message is the "intro" (rendered
 * above the working timer), the last one is the "summary" (rendered at the bottom).
 * Thinking-only assistant messages are skipped entirely.
 */

export interface MinimalTurn {
  id: string;
  /** Null only for a leading run of nodes without a preceding user message. */
  userNode: UserNode | null;
  /** Index of the user node in the displayNodes array (-1 when userNode is null).
   *  Used by the user-message minimap to locate this turn in the DOM. */
  userIndex: number;
  entries: TranscriptNode[];
}

export type MinimalTurnItem =
  | { kind: 'tool'; node: ToolNode }
  | { kind: 'text'; node: AssistantNode }
  | { kind: 'system'; node: SystemNode };

export interface MinimalTurnAnalysis {
  intro: AssistantNode | null;
  summary: AssistantNode | null;
  items: MinimalTurnItem[];
  /** When the agent started working on this turn (first agent node timestamp). */
  startAt: number | undefined;
  /** When the turn finished (last agent node end timestamp). */
  endAt: number | undefined;
  hasTools: boolean;
  isActive: boolean;
  /** The assistant node still in its pre-text phase (thinking or the gap
   *  between thinking and the first text delta), if any. */
  thinkingNode: AssistantNode | null;
  /** Whether the "Thinking..." indicator is visible: thinking lingers after
   *  its stream ends until a tool starts. */
  showThinking: boolean;
  /** True once the final summary text starts streaming (work is done). */
  summaryStarted: boolean;
  /** The turn's most recent tool, shown while the activity area would
   *  otherwise be empty: a finished command lingers until the next activity
   *  (thinking indicator, next tool, narration, summary) replaces it. */
  fallbackTool: ToolNode | null;
}

/** Split a flat node list into per-user-message turns. */
export function buildTurns(nodes: TranscriptNode[]): MinimalTurn[] {
  const turns: MinimalTurn[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.role === 'user') {
      turns.push({ id: node.id, userNode: node, userIndex: index, entries: [] });
    } else if (turns.length === 0) {
      turns.push({ id: `pre-${node.id}`, userNode: null, userIndex: -1, entries: [node] });
    } else {
      turns[turns.length - 1].entries.push(node);
    }
  }
  return turns;
}

function getAssistantStart(node: AssistantNode): number | undefined {
  return node.messageStartedAt ?? node.thinkingStartedAt ?? node.messageEndedAt;
}

function getAssistantEnd(node: AssistantNode): number | undefined {
  // No fallback to the start timestamp: a live message that has not ended yet
  // (no message_end, no thinking end) must yield undefined so the timer keeps
  // ticking instead of freezing at zero.
  return node.messageEndedAt ?? node.thinkingEndedAt;
}

function getToolStart(node: ToolNode): number | undefined {
  return node.startedAt;
}

function getToolEnd(node: ToolNode): number | undefined {
  if (node.startedAt === undefined || node.durationMs === undefined) return undefined;
  return node.startedAt + node.durationMs;
}

/** Analyze a single turn for rendering. isLastTurn gates the live "active" flag. */
export function analyzeTurn(
  turn: MinimalTurn,
  sessionStatus: AgentStatus,
  isLastTurn: boolean,
): MinimalTurnAnalysis {
  const textEntries: Array<{ node: AssistantNode; index: number }> = [];
  const items: MinimalTurnItem[] = [];
  let startAt: number | undefined;
  let endAt: number | undefined;
  let hasTools = false;
  let firstToolIndex = -1;
  let lastAgentNodeActive = false;
  let lastThinkingNode: AssistantNode | null = null;
  let lastToolNode: ToolNode | null = null;

  // First pass: collect text positions and timing info.
  for (let index = 0; index < turn.entries.length; index++) {
    const node = turn.entries[index];
    if (node.role === 'assistant') {
      if (node.text.length > 0) {
        textEntries.push({ node, index });
      }
      if (node.isStreaming && node.text.length === 0) {
        lastThinkingNode = node;
      }
      startAt ??= getAssistantStart(node);
      endAt = getAssistantEnd(node);
      if (node.isStreaming) {
        lastAgentNodeActive = true;
      }
    } else if (node.role === 'tool') {
      hasTools = true;
      lastToolNode = node;
      if (firstToolIndex === -1) firstToolIndex = index;
      startAt ??= getToolStart(node);
      endAt = getToolEnd(node);
      if (node.status === 'running') {
        lastAgentNodeActive = true;
      }
    }
  }

  // The intro is only the agent's pre-work narration: the first text message
  // that appears BEFORE the first tool call. Text after the first tool call is
  // the turn's conclusion (or middle narration), never an intro.
  const introEntry = textEntries.find(
    (entry) => firstToolIndex !== -1 && entry.index < firstToolIndex,
  );
  const intro = introEntry?.node ?? null;
  const summary = textEntries.length > 0 ? textEntries[textEntries.length - 1].node : null;

  // Second pass: build the activity stream in transcript order — running tools
  // (completed ones disappear), middle-of-turn narration, and system markers.
  for (const node of turn.entries) {
    if (node.role === 'assistant') {
      if (node === intro || node === summary) continue;
      if (node.text.length > 0 || node.errorMessage) {
        items.push({ kind: 'text', node });
      }
    } else if (node.role === 'tool') {
      if (node.status === 'running') {
        items.push({ kind: 'tool', node });
      }
    } else if (node.role === 'system') {
      items.push({ kind: 'system', node });
    }
  }

  // A turn with no agent nodes yet (user message just sent, agent_start pending)
  // counts as active while the session is streaming so the timer appears early.
  const isActive =
    isLastTurn && (lastAgentNodeActive || turn.entries.length === 0 || sessionStatus !== 'idle');

  const showThinking =
    lastThinkingNode !== null &&
    (lastThinkingNode.thinkingEndedAt === undefined || !items.some((item) => item.kind === 'tool'));
  const summaryStarted = summary !== null && summary.text.length > 0;

  // Between consecutive tools (or between the last tool and the summary) the
  // stream has a quiet gap: the finished command vanished but the next
  // activity has not arrived yet. Keep the last tool on screen during that
  // gap; it is replaced as soon as anything else shows up.
  const fallbackTool =
    isActive &&
    !showThinking &&
    !summaryStarted &&
    !items.some((item) => item.kind === 'tool' || item.kind === 'text')
      ? lastToolNode
      : null;

  return {
    intro,
    summary,
    items,
    startAt: startAt ?? turn.userNode?.sentAt,
    endAt,
    hasTools,
    isActive,
    thinkingNode: lastThinkingNode,
    showThinking,
    summaryStarted,
    fallbackTool,
  };
}

/** Whether the working timer + divider should be shown for a turn. */
export function shouldShowTimer(analysis: MinimalTurnAnalysis): boolean {
  if (analysis.isActive) return true;
  if (analysis.hasTools) return true;
  return (
    analysis.startAt !== undefined &&
    analysis.endAt !== undefined &&
    analysis.endAt > analysis.startAt
  );
}

/** Format elapsed milliseconds as "1m 20s" (whole seconds, floor). */
export function formatWorkingDuration(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
