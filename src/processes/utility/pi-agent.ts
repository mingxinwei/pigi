/**
 * Pi Agent - utility process that runs the pi SDK runtime.
 *
 * Communication:
 * 1. parentPort: control commands in, lifecycle events + results out (via main)
 * 2. StreamPort (received via MessagePort transfer): high-frequency batched deltas
 *    sent directly to renderer, bypassing main
 *
 * Lifecycle:
 * - Receives 'stream_port' message with transferred port (one-time setup)
 * - Receives 'init' command to start runtime
 * - Then handles commands and emits events
 */
import {
  type AgentSessionEvent,
  type CreateAgentSessionRuntimeFactory,
  type AgentSessionRuntime,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
} from '@mariozechner/pi-coding-agent'
import type { PiCommand, PiResponse, StreamBatch } from '../../shared/protocol'

// --- StreamBatcher ---
// Collects high-frequency deltas and flushes every 16ms via MessagePort.

interface StreamPort {
  postMessage(message: unknown): void
  start(): void
}

class StreamBatcher {
  private batch: StreamBatch = { type: 'stream_batch' }
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null
  private port: StreamPort | null = null

  start(port: StreamPort): void {
    this.port = port
    port.start()
    this.timer = setInterval(() => this.flush(), 16)
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer)
      this.timer = null
    }
    this.flush()
  }

  appendText(id: string, delta: string): void {
    if (!this.batch.text) this.batch.text = {}
    this.batch.text[id] = (this.batch.text[id] || '') + delta
    this.dirty = true
  }

  appendThinking(id: string, delta: string): void {
    if (!this.batch.thinking) this.batch.thinking = {}
    this.batch.thinking[id] = (this.batch.thinking[id] || '') + delta
    this.dirty = true
  }

  appendToolOutput(id: string, delta: string): void {
    if (!this.batch.toolOutput) this.batch.toolOutput = {}
    this.batch.toolOutput[id] = (this.batch.toolOutput[id] || '') + delta
    this.dirty = true
  }

  private flush(): void {
    if (!this.dirty || !this.port) return
    this.port.postMessage(this.batch)
    this.batch = { type: 'stream_batch' }
    this.dirty = false
  }
}

// --- State ---

let runtime: AgentSessionRuntime | null = null
let unsubscribe: (() => void) | null = null
const batcher = new StreamBatcher()

// --- Helpers ---

function send(msg: PiResponse): void {
  process.parentPort?.postMessage(msg)
}

function cleanupSubscription(): void {
  if (unsubscribe) {
    unsubscribe()
    unsubscribe = null
  }
}

// --- Session Subscription ---
// Routes events to the appropriate channel:
// - text_delta/thinking_delta/tool_output → StreamBatcher → MessagePort (high-freq)
// - Everything else → parentPort → main → renderer (low-freq)

function subscribeToSession(): void {
  cleanupSubscription()
  if (!runtime) return

  const session = runtime.session
  let currentAssistantId: string | null = null

  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case 'message_start': {
        const msg = (event as { message?: { role?: string; id?: string } }).message
        if (msg?.role === 'assistant') {
          currentAssistantId = msg.id || null
        }
        send({ type: 'event', event })
        break
      }

      case 'message_update': {
        const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
        if (ame && currentAssistantId) {
          if (ame.type === 'text_delta' && ame.delta) {
            batcher.appendText(currentAssistantId, ame.delta)
            return
          }
          if (ame.type === 'thinking_delta' && ame.delta) {
            batcher.appendThinking(currentAssistantId, ame.delta)
            return
          }
        }
        send({ type: 'event', event })
        break
      }

      case 'message_end':
        currentAssistantId = null
        send({ type: 'event', event })
        break

      case 'tool_execution_update': {
        const toolEvent = event as { toolCallId?: string; partialResult?: { content?: Array<{ text?: string }> } }
        const text = toolEvent.partialResult?.content?.[0]?.text
        if (text && toolEvent.toolCallId) {
          batcher.appendToolOutput(toolEvent.toolCallId, text)
          return
        }
        send({ type: 'event', event })
        break
      }

      default:
        send({ type: 'event', event })
        break
    }
  })
}

// --- Runtime Factory ---

const createRuntimeFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await createAgentSessionServices({ cwd })
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  }
}

// --- Command Handlers ---

async function handleInit(cwd: string): Promise<void> {
  try {
    runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd),
    })

    subscribeToSession()
    await runtime.session.bindExtensions({})

    const session = runtime.session
    send({
      type: 'runtime_ready',
      sessionId: session.sessionId,
      model: session.model
        ? { name: session.model.name, provider: session.model.provider, id: session.model.id }
        : null,
      thinkingLevel: session.thinkingLevel,
    })
  } catch (err) {
    send({ type: 'runtime_error', error: err instanceof Error ? err.message : String(err) })
  }
}

async function handleCommand(cmd: PiCommand): Promise<unknown> {
  switch (cmd.type) {
    case 'init':
      await handleInit(cmd.cwd)
      return undefined

    case 'prompt': {
      if (!runtime) return { success: false, error: 'not initialized' }
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'prompt must be a non-empty string' }
      }
      runtime.session.prompt(cmd.message).catch((err) => {
        send({ type: 'error', error: err instanceof Error ? err.message : String(err) })
      })
      return { success: true }
    }

    case 'abort': {
      if (!runtime) return { success: false }
      await runtime.session.abort()
      return { success: true }
    }

    case 'getState': {
      if (!runtime) return null
      const s = runtime.session
      return {
        model: s.model
          ? { name: s.model.name, provider: s.model.provider, id: s.model.id }
          : null,
        thinkingLevel: s.thinkingLevel,
        isStreaming: s.isStreaming,
        sessionFile: s.sessionFile,
        sessionId: s.sessionId,
        messageCount: s.messages.length,
      }
    }

    case 'getMessages':
      if (!runtime) return []
      return runtime.session.messages

    case 'newSession': {
      if (!runtime) return { success: false }
      await runtime.newSession()
      subscribeToSession()
      await runtime.session.bindExtensions({})
      return { success: true, sessionId: runtime.session.sessionId }
    }

    case 'switchSession': {
      if (!runtime) return { success: false }
      if (!cmd.sessionPath || cmd.sessionPath.trim().length === 0) {
        return { success: false, error: 'sessionPath must be a non-empty string' }
      }
      await runtime.switchSession(cmd.sessionPath)
      subscribeToSession()
      await runtime.session.bindExtensions({})
      return { success: true, sessionId: runtime.session.sessionId }
    }

    case 'listSessions': {
      const sessions = cmd.cwd
        ? await SessionManager.list(cmd.cwd)
        : await SessionManager.listAll()
      return sessions
    }

    case 'cycleModel': {
      if (!runtime) return null
      return await runtime.session.cycleModel()
    }

    case 'cycleThinkingLevel': {
      if (!runtime) return null
      return runtime.session.cycleThinkingLevel()
    }
  }
}

// --- Message Listener ---

process.parentPort?.on('message', async (messageEvent) => {
  const { data, ports } = messageEvent

  // One-time: receive the stream port from main
  if (data?.type === 'stream_port' && ports.length > 0) {
    batcher.start(ports[0])
    return
  }

  // Handle commands
  const id = (data as { id?: string }).id
  try {
    const result = await handleCommand(data as PiCommand)
    if (id) {
      send({ type: 'result', id, data: result })
    }
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    if (id) {
      send({ type: 'result', id, data: { success: false, error } })
    } else {
      send({ type: 'error', error })
    }
  }
})
