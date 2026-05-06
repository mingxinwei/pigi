/**
 * TranscriptController - manages transcript state for a single session.
 *
 * Responsibilities:
 * - Converts SDK lifecycle events into UI state (TranscriptNode[])
 * - Applies stream batches to active streaming nodes
 * - Normalizes session.messages during startup/switch (hydration)
 * - Tracks agent status (idle/streaming/tool_running/error)
 * - Notifies subscribers on state changes (for React re-render)
 *
 * Stream batches are already throttled by the utility process. Notifying React per batch keeps
 * the rendered layout measurable without rendering on every token event.
 */

// =============================================================================
// Node types
// =============================================================================

export interface UserNode {
  id: string
  role: 'user'
  text: string
  sentAt: number
}

export interface AssistantNode {
  id: string
  role: 'assistant'
  text: string
  thinking: string
  model?: string
  provider?: string
  stopReason?: string
  errorMessage?: string
  isStreaming: boolean
}

export interface ToolNode {
  id: string
  role: 'tool'
  toolCallId: string
  name: string
  args: unknown
  status: 'running' | 'success' | 'error' | 'cancelled'
  output: string
  isError: boolean
  startedAt?: number
  durationMs?: number
}

export interface SystemNode {
  id: string
  role: 'system'
  text: string
}

export type TranscriptNode = UserNode | AssistantNode | ToolNode | SystemNode

export type AgentStatus = 'idle' | 'streaming' | 'tool_running' | 'error'

// =============================================================================
// State
// =============================================================================

export interface TranscriptState {
  nodes: TranscriptNode[]
  status: AgentStatus
  activeAssistantId: string | null
  activeToolCallId: string | null
}

// =============================================================================
// SDK event shapes (what arrives over the port as PiPush { type: 'event', event })
// =============================================================================

// SDK event shapes (only types actually used in casts are kept)
interface SdkMessageStart {
  type: 'message_start'
  message: { id?: string; role?: string; content?: unknown[]; timestamp?: number | string }
}
interface SdkMessageUpdate {
  type: 'message_update'
  message: { id?: string; role?: string; timestamp?: number | string }
  assistantMessageEvent: {
    type: string
    delta?: string
    contentIndex?: number
    content?: string
    toolCall?: { id?: string; name?: string }
    partial?: unknown
    reason?: string
    message?: unknown
    error?: unknown
  }
}
interface SdkMessageEnd {
  type: 'message_end'
  message: {
    id?: string
    role?: string
    content?: unknown[]
    stopReason?: string
    errorMessage?: string
    model?: { name?: string; provider?: string }
  }
}
interface SdkToolExecStart {
  type: 'tool_execution_start'
  toolCallId: string
  toolName: string
  args: unknown
}
interface SdkToolExecUpdate {
  type: 'tool_execution_update'
  toolCallId: string
  toolName: string
  args: unknown
  partialResult: unknown
}
interface SdkToolExecEnd {
  type: 'tool_execution_end'
  toolCallId: string
  toolName: string
  result: unknown
  isError: boolean
}

// =============================================================================
// Controller
// =============================================================================

type Listener = () => void

let nodeIdCounter = 0
function nextNodeId(): string {
  return `node-${++nodeIdCounter}`
}

export class TranscriptController {
  private _state: TranscriptState = {
    nodes: [],
    status: 'idle',
    activeAssistantId: null,
    activeToolCallId: null,
  }

  private listeners = new Set<Listener>()

  get state(): TranscriptState {
    return this._state
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  private notify(): void {
    for (const listener of this.listeners) {
      listener()
    }
  }

  private setState(partial: Partial<TranscriptState>): void {
    this._state = { ...this._state, ...partial }
    this.notify()
  }

  setStatus(status: AgentStatus): void {
    if (this._state.status === status) {
      return
    }
    this.setState({ status })
  }

  private findNode<T extends TranscriptNode>(id: string): T | undefined {
    return this._state.nodes.find((n) => n.id === id) as T | undefined
  }

  private getActiveAssistant(): AssistantNode | undefined {
    if (!this._state.activeAssistantId) return undefined
    return this.findNode<AssistantNode>(this._state.activeAssistantId)
  }

  // ===========================================================================
  // Hydration (from getMessages on session_ready or switch)
  // ===========================================================================

  hydrate(messages: unknown[]): void {
    const nodes = this.createNodesFromMessages(messages)

    this._state = {
      nodes,
      status: 'idle',
      activeAssistantId: null,
      activeToolCallId: null,
    }
    this.notify()
  }

  mergeHydratedMessages(messages: unknown[]): void {
    const hydratedNodes = this.createNodesFromMessages(messages)
    const currentNodes = this._state.nodes
    const missingHistoricalNodes = hydratedNodes.filter(
      (node) => !currentNodes.some((currentNode) => areDuplicateNodes(currentNode, node)),
    )

    if (missingHistoricalNodes.length === 0) {
      return
    }

    this.setState({ nodes: [...missingHistoricalNodes, ...currentNodes] })
  }

  private createNodesFromMessages(messages: unknown[]): TranscriptNode[] {
    const nodes: TranscriptNode[] = []
    const toolCalls = new Map<string, { name: string; args: unknown; startedAt?: number }>()

    for (const msg of messages) {
      const m = msg as {
        id?: string
        role?: string
        content?: unknown[]
        model?: { name?: string; provider?: string }
        timestamp?: number | string
        stopReason?: string
        errorMessage?: string
      }
      if (!m.role) continue

      switch (m.role) {
        case 'user': {
          const text = extractText(m.content)
          nodes.push({
            id: m.id || nextNodeId(),
            role: 'user',
            text,
            sentAt: normalizeTimestamp(m.timestamp),
          })
          break
        }
        case 'assistant': {
          const {
            text,
            thinking,
            toolCalls: assistantToolCalls,
            errorMessage: contentError,
          } = extractAssistantContent(m.content)
          const assistantError = m.errorMessage || contentError
          const assistantTimestamp = tryNormalizeTimestamp(m.timestamp)
          for (const toolCall of assistantToolCalls) {
            toolCalls.set(toolCall.id, {
              name: toolCall.name,
              args: toolCall.args,
              startedAt: assistantTimestamp,
            })
          }
          if (text || thinking || assistantError) {
            nodes.push({
              id: m.id || nextNodeId(),
              role: 'assistant',
              text,
              thinking,
              model: m.model?.name,
              provider: m.model?.provider,
              stopReason: m.stopReason,
              errorMessage: assistantError,
              isStreaming: false,
            })
          }
          break
        }
        case 'toolResult': {
          const toolMsg = msg as {
            id?: string
            toolCallId?: string
            toolName?: string
            content?: unknown[]
            isError?: boolean
            timestamp?: number | string
          }
          const call = toolMsg.toolCallId ? toolCalls.get(toolMsg.toolCallId) : undefined
          const completedAt = tryNormalizeTimestamp(toolMsg.timestamp)
          const output = extractText(toolMsg.content)
          nodes.push({
            id: toolMsg.id || nextNodeId(),
            role: 'tool',
            toolCallId: toolMsg.toolCallId || '',
            name: toolMsg.toolName || call?.name || 'unknown',
            args: call?.args,
            status: toolMsg.isError ? 'error' : 'success',
            output,
            isError: toolMsg.isError || false,
            startedAt: call?.startedAt,
            durationMs: getElapsedMs(call?.startedAt, completedAt),
          })
          break
        }
      }
    }

    return nodes
  }

  // ===========================================================================
  // Reset (session switch, destroy)
  // ===========================================================================

  reset(): void {
    this._state = {
      nodes: [],
      status: 'idle',
      activeAssistantId: null,
      activeToolCallId: null,
    }
    this.notify()
  }

  // ===========================================================================
  // Optimistic user message (shown immediately before SDK echo)
  // ===========================================================================

  addUserMessage(text: string): void {
    const node: UserNode = { id: nextNodeId(), role: 'user', text, sentAt: Date.now() }
    this.setState({ nodes: [...this._state.nodes, node] })
  }

  // ===========================================================================
  // SDK event processing
  // ===========================================================================

  processEvent(raw: unknown): void {
    const event = raw as Record<string, unknown>
    const type = event.type as string
    switch (type) {
      case 'agent_start':
        this.setState({ status: 'streaming' })
        break

      case 'agent_end':
        this.finalizeCurrent()
        this.setState({ status: 'idle', activeAssistantId: null, activeToolCallId: null })
        break

      case 'turn_start':
        this.setState({ status: 'streaming' })
        break

      case 'message_start': {
        const msg = (raw as unknown as SdkMessageStart).message
        // Skip user messages — we add them optimistically via addUserMessage()
        if (msg?.role === 'assistant' && !this._state.activeAssistantId) {
          this.createAssistantNode(msg.id)
        }
        break
      }

      case 'message_update':
        this.handleMessageUpdate(raw as unknown as SdkMessageUpdate)
        break

      case 'message_end':
        this.handleMessageEnd(raw as unknown as SdkMessageEnd)
        break

      case 'tool_execution_start':
        this.handleToolStart(raw as unknown as SdkToolExecStart)
        break

      case 'tool_execution_update':
        this.handleToolUpdate(raw as unknown as SdkToolExecUpdate)
        break

      case 'tool_execution_end':
        this.handleToolEnd(raw as unknown as SdkToolExecEnd)
        break

      default:
        break
    }
  }

  // ===========================================================================
  // Stream batch processing
  // ===========================================================================

  /**
   * Apply a stream batch. The utility process flushes at animation-frame cadence, so
   * each batch can update React state and let the virtualizer measure real heights.
   */
  applyStreamBatch(batch: {
    text?: Record<string, string>
    thinking?: Record<string, string>
    toolOutput?: Record<string, string>
  }): void {
    let changed = false

    if (batch.text) {
      for (const [messageId, delta] of Object.entries(batch.text)) {
        const assistant = this.getOrCreateAssistantForStream(messageId)
        if (assistant && delta) {
          assistant.text += delta
          changed = true
        }
      }
    }

    if (batch.thinking) {
      for (const [messageId, delta] of Object.entries(batch.thinking)) {
        const assistant = this.getOrCreateAssistantForStream(messageId)
        if (assistant && delta) {
          assistant.thinking += delta
          changed = true
        }
      }
    }

    if (batch.toolOutput) {
      for (const [toolCallId, output] of Object.entries(batch.toolOutput)) {
        const tool = this._state.nodes.find(
          (n) => n.role === 'tool' && (n as ToolNode).toolCallId === toolCallId,
        ) as ToolNode | undefined
        if (tool) {
          tool.output = output
          changed = true
        }
      }
    }

    if (changed) {
      this.setState({ nodes: [...this._state.nodes] })
    }
  }

  // ===========================================================================
  // Internal event handlers
  // ===========================================================================

  private createAssistantNode(id?: string): void {
    const nodeId = id || nextNodeId()
    const node: AssistantNode = {
      id: nodeId,
      role: 'assistant',
      text: '',
      thinking: '',
      isStreaming: true,
    }
    this.setState({
      nodes: [...this._state.nodes, node],
      activeAssistantId: nodeId,
      status: 'streaming',
    })
  }

  private getOrCreateAssistantForStream(messageId: string): AssistantNode | undefined {
    const byMessageId = this.findNode<AssistantNode>(messageId)
    if (byMessageId) {
      return byMessageId
    }

    const activeAssistant = this.getActiveAssistant()
    if (activeAssistant) {
      return activeAssistant
    }

    this.createAssistantNode(messageId)
    return this.getActiveAssistant()
  }

  private handleMessageUpdate(event: SdkMessageUpdate): void {
    const ame = event.assistantMessageEvent
    if (!ame) return

    // Non-streaming events that we handle structurally (toolcall_end creates tool association)
    if (ame.type === 'toolcall_end' && ame.toolCall) {
      // Tool call finalized — tool_execution_start will follow
      return
    }

    // text_delta and thinking_delta are handled via StreamBatcher (not here)
    // But if they arrive here (e.g., non-batched path), accumulate them
    if (ame.type === 'text_delta' && ame.delta) {
      const assistant = this.getOrCreateAssistantForStream(event.message.id ?? nextNodeId())
      if (assistant) {
        assistant.text += ame.delta
        this.setState({ nodes: [...this._state.nodes] })
      }
      return
    }

    if (ame.type === 'thinking_delta' && ame.delta) {
      const assistant = this.getOrCreateAssistantForStream(event.message.id ?? nextNodeId())
      if (assistant) {
        assistant.thinking += ame.delta
        this.setState({ nodes: [...this._state.nodes] })
      }
      return
    }
  }

  private handleMessageEnd(event: SdkMessageEnd): void {
    const msg = event.message
    if (msg?.role !== 'assistant') return

    const assistant = this.getActiveAssistant()
    if (!assistant) return

    // Finalize the assistant node
    assistant.isStreaming = false
    assistant.stopReason = msg.stopReason
    assistant.errorMessage = msg.errorMessage
    assistant.model = msg.model?.name
    assistant.provider = msg.model?.provider

    // Extract final text from message content if available (more accurate than accumulated deltas)
    if (msg.content) {
      const { text, thinking } = extractAssistantContent(msg.content)
      if (text) assistant.text = text
      if (thinking) assistant.thinking = thinking
    }

    this.setState({
      nodes: [...this._state.nodes],
      activeAssistantId: null,
    })
  }

  private handleToolStart(event: SdkToolExecStart): void {
    const node: ToolNode = {
      id: nextNodeId(),
      role: 'tool',
      toolCallId: event.toolCallId,
      name: event.toolName,
      args: event.args,
      status: 'running',
      output: '',
      isError: false,
      startedAt: Date.now(),
    }
    this.setState({
      nodes: [...this._state.nodes, node],
      activeToolCallId: event.toolCallId,
      status: 'tool_running',
    })
  }

  private handleToolUpdate(event: SdkToolExecUpdate): void {
    // Tool output is handled via StreamBatcher (toolOutput field)
    // But handle here as fallback
    const tool = this._state.nodes.find(
      (n) => n.role === 'tool' && (n as ToolNode).toolCallId === event.toolCallId,
    ) as ToolNode | undefined
    if (tool && event.partialResult) {
      const text = extractToolResultText(event.partialResult)
      if (text) {
        tool.output = text
        this.setState({ nodes: [...this._state.nodes] })
      }
    }
  }

  private handleToolEnd(event: SdkToolExecEnd): void {
    const endedAt = Date.now()
    const tool = this._state.nodes.find(
      (n) => n.role === 'tool' && (n as ToolNode).toolCallId === event.toolCallId,
    ) as ToolNode | undefined

    if (tool) {
      tool.status = event.isError ? 'error' : 'success'
      tool.isError = event.isError
      const text = extractToolResultText(event.result)
      if (text) tool.output = text
      tool.durationMs = getElapsedMs(tool.startedAt, endedAt)
    }

    this.setState({
      nodes: [...this._state.nodes],
      activeToolCallId: null,
      status: 'streaming',
    })
  }

  private finalizeCurrent(): void {
    const assistant = this.getActiveAssistant()
    if (assistant && assistant.isStreaming) {
      assistant.isStreaming = false
    }
  }
}

// =============================================================================
// Helpers
// =============================================================================

function areDuplicateNodes(left: TranscriptNode, right: TranscriptNode): boolean {
  if (left.id === right.id) {
    return true
  }

  if (left.role !== right.role) {
    return false
  }

  switch (left.role) {
    case 'user':
      return left.text === (right as UserNode).text
    case 'assistant': {
      const assistant = right as AssistantNode
      return (
        Boolean(left.text || left.thinking) &&
        left.text === assistant.text &&
        left.thinking === assistant.thinking
      )
    }
    case 'tool':
      return left.toolCallId === (right as ToolNode).toolCallId
    case 'system':
      return left.text === (right as SystemNode).text
  }
}

function extractText(content: unknown[] | undefined): string {
  if (!content || !Array.isArray(content)) return ''
  const parts: string[] = []
  for (const block of content) {
    const b = block as { type?: string; text?: string }
    if (b.type === 'text' && b.text) {
      parts.push(b.text)
    }
  }
  return parts.join('\n')
}

function extractAssistantContent(content: unknown[] | undefined): {
  text: string
  thinking: string
  toolCalls: Array<{ id: string; name: string; args: unknown }>
  errorMessage: string | undefined
} {
  if (!content || !Array.isArray(content)) return { text: '', thinking: '', toolCalls: [], errorMessage: undefined }
  const textParts: string[] = []
  const thinkingParts: string[] = []
  const toolCalls: Array<{ id: string; name: string; args: unknown }> = []
  let errorMessage: string | undefined
  for (const block of content) {
    const b = block as {
      type?: string
      text?: string
      thinking?: string
      id?: string
      name?: string
      arguments?: unknown
      error?: string
    }
    if (b.type === 'text' && b.text) {
      textParts.push(b.text)
    } else if (b.type === 'thinking' && b.thinking) {
      thinkingParts.push(b.thinking)
    } else if (b.type === 'toolCall' && b.id && b.name) {
      toolCalls.push({ id: b.id, name: b.name, args: b.arguments })
    } else if (b.type === 'error' && b.error) {
      errorMessage = b.error
    }
  }
  return { text: textParts.join('\n'), thinking: thinkingParts.join('\n'), toolCalls, errorMessage }
}

function extractToolResultText(result: unknown): string {
  if (!result) return ''
  const r = result as { content?: Array<{ type?: string; text?: string }> }
  if (r.content && Array.isArray(r.content)) {
    return r.content
      .filter((c) => c.type === 'text' && c.text)
      .map((c) => c.text)
      .join('\n')
  }
  return ''
}

function getElapsedMs(
  startedAt: number | undefined,
  endedAt: number | undefined,
): number | undefined {
  if (startedAt === undefined || endedAt === undefined || endedAt < startedAt) {
    return undefined
  }

  return endedAt - startedAt
}

function normalizeTimestamp(timestamp: number | string | undefined): number {
  return tryNormalizeTimestamp(timestamp) ?? Date.now()
}

function tryNormalizeTimestamp(timestamp: number | string | undefined): number | undefined {
  if (typeof timestamp === 'number' && Number.isFinite(timestamp)) {
    return timestamp
  }

  if (typeof timestamp === 'string') {
    const parsed = Date.parse(timestamp)
    if (Number.isFinite(parsed)) {
      return parsed
    }
  }

  return undefined
}
