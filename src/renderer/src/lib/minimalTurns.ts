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
  /** The turn's most recent activity (thinking or tool call). While the turn
   *  is active it lingers in the activity area until the next activity
   *  arrives — the area must never be empty between activities (network gaps
   *  between thinking end and tool start can take a second). */
  lastActivity: AssistantNode | ToolNode | null;
}

/** Split a flat node list into per-user-message turns. System markers
 *  (context compaction, compaction progress) get their own user-less turn so
 *  they render as standalone rows between turns instead of being folded into
 *  a turn's activity area. */
export function buildTurns(nodes: TranscriptNode[]): MinimalTurn[] {
  const turns: MinimalTurn[] = [];
  for (let index = 0; index < nodes.length; index++) {
    const node = nodes[index];
    if (node.role === 'user') {
      turns.push({ id: node.id, userNode: node, userIndex: index, entries: [] });
    } else if (node.role === 'system') {
      turns.push({ id: `pre-${node.id}`, userNode: null, userIndex: -1, entries: [node] });
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
  let lastActivity: AssistantNode | ToolNode | null = null;

  // First pass: collect text positions and timing info.
  for (let index = 0; index < turn.entries.length; index++) {
    const node = turn.entries[index];
    if (node.role === 'assistant') {
      if (node.text.length > 0) {
        textEntries.push({ node, index });
      }
      // A node that streams thinking (or is still pre-text) counts as
      // activity — including after thinking ended, when its text may have
      // started streaming (the node is no longer "thinking" by the old
      // text-free test, but the thinking indicator must linger until the
      // next activity arrives).
      if (node.thinkingStartedAt !== undefined || (node.isStreaming && node.text.length === 0)) {
        lastActivity = node;
      }
      startAt ??= getAssistantStart(node);
      // Keep the last defined end: a live final message has no end timestamp
      // yet, and overwriting with undefined would make the frozen timer jump
      // forward when message_end lands.
      endAt = getAssistantEnd(node) ?? endAt;
      if (node.isStreaming) {
        lastAgentNodeActive = true;
      }
    } else if (node.role === 'tool') {
      hasTools = true;
      lastActivity = node;
      if (firstToolIndex === -1) firstToolIndex = index;
      startAt ??= getToolStart(node);
      endAt = getToolEnd(node) ?? endAt;
      if (node.status === 'running') {
        lastAgentNodeActive = true;
      }
    }
  }

  // The intro is the turn's first text message, shown above the activity
  // area. When tools exist it must be their preamble (text before the first
  // tool); without tools the first text still occupies the intro slot (it
  // doubles as the summary when it is the turn's only text).
  const intro =
    firstToolIndex === -1 || (textEntries.length > 0 && textEntries[0].index < firstToolIndex)
      ? (textEntries[0]?.node ?? null)
      : null;
  // A user-less system-marker turn has no work to time — it must never count
  // as active (the streaming session would otherwise show it a working timer).
  const isPureSystemTurn =
    turn.entries.length > 0 && turn.entries.every((node) => node.role === 'system');

  // A turn with no agent nodes yet (user message just sent, agent_start pending)
  // counts as active while the session is streaming so the timer appears early.
  // 'error' is a sticky terminal status — it must not keep a dead turn active
  // (the timer would tick forever on a failed session).
  const isActive =
    !isPureSystemTurn &&
    isLastTurn &&
    (lastAgentNodeActive ||
      turn.entries.length === 0 ||
      sessionStatus === 'streaming' ||
      sessionStatus === 'tool_running');

  const lastTextEntry = textEntries[textEntries.length - 1];
  // Only the turn's FINAL text may occupy the summary slot, and it is only
  // known once the turn has ended (a streaming message may still turn out to
  // be middle narration — there is no earlier signal). A message whose
  // stopReason is 'toolUse' ended because a tool call followed — middle
  // narration by definition, never the summary.
  const summary =
    !isActive && lastTextEntry !== undefined && lastTextEntry.node.stopReason !== 'toolUse'
      ? lastTextEntry.node
      : null;

  // Second pass: build the activity stream in transcript order — running tools
  // (completed ones disappear), and system markers. Middle narration is
  // deliberately not collected here: only the intro and the current last text
  // render as text in minimal view. Error messages stay (they are the turn's
  // outcome, not narration).
  for (const node of turn.entries) {
    if (node.role === 'assistant') {
      if (node === intro || node === summary) continue;
      if (node.errorMessage) {
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

  return {
    intro,
    summary,
    items,
    // Anchor the timer to when the user sent the message, not to when the
    // agent first started: agent_start may arrive seconds later (queueing,
    // session creation) and would otherwise reset the timer to 0s — most
    // visible when the run errors out immediately after starting. The agent
    // timestamps only serve as fallback for user-less turns.
    startAt: turn.userNode?.sentAt ?? startAt,
    endAt,
    hasTools,
    isActive,
    lastActivity,
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

/** Format elapsed milliseconds as "1m 20s" / "2h 5m" (whole seconds, floor). */
export function formatWorkingDuration(elapsedMs: number): string {
  const totalSeconds = Math.floor(Math.max(0, elapsedMs) / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  const hours = Math.floor(minutes / 60);
  if (hours > 0) {
    return `${hours}h ${minutes % 60}m`;
  }
  if (minutes > 0) {
    return `${minutes}m ${seconds}s`;
  }
  return `${seconds}s`;
}
