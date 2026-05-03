/**
 * Pi Agent - utility process managing multiple pi SDK sessions.
 *
 * Each session has:
 * - Its own AgentSessionRuntime
 * - Its own StreamBatcher + MessagePort (for direct streaming to renderer)
 * - Its own event subscription
 *
 * Communication:
 * 1. parentPort: control commands in, lifecycle events + results out
 * 2. Per-session MessagePort: high-frequency batched deltas direct to renderer
 *
 * Sessions are created on-demand, not at process startup.
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
import type { PiCommand, PiResponse, StreamBatch, UtilityMessage } from '../../shared/protocol'

// --- StreamBatcher (one per session) ---

interface StreamPort {
  postMessage(message: unknown): void
  start(): void
}

class StreamBatcher {
  private batch: StreamBatch
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null
  private port: StreamPort | null = null

  constructor(private sessionId: string) {
    this.batch = { type: 'stream_batch', sessionId }
  }

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
    this.batch = { type: 'stream_batch', sessionId: this.sessionId }
    this.dirty = false
  }
}

// --- Session State ---

interface SessionEntry {
  runtime: AgentSessionRuntime
  batcher: StreamBatcher
  unsubscribe: () => void
}

const sessions = new Map<string, SessionEntry>()

// --- Helpers ---

function send(msg: PiResponse): void {
  process.parentPort?.postMessage(msg)
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

// --- Session Subscription ---

function subscribeToSession(sessionId: string, runtime: AgentSessionRuntime, batcher: StreamBatcher): () => void {
  const session = runtime.session
  let currentAssistantId: string | null = null

  return session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case 'message_start': {
        const msg = (event as { message?: { role?: string; id?: string } }).message
        if (msg?.role === 'assistant') {
          currentAssistantId = msg.id || null
        }
        send({ type: 'event', sessionId, event })
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
        send({ type: 'event', sessionId, event })
        break
      }

      case 'message_end':
        currentAssistantId = null
        send({ type: 'event', sessionId, event })
        break

      case 'tool_execution_update': {
        const toolEvent = event as { toolCallId?: string; partialResult?: { content?: Array<{ text?: string }> } }
        const text = toolEvent.partialResult?.content?.[0]?.text
        if (text && toolEvent.toolCallId) {
          batcher.appendToolOutput(toolEvent.toolCallId, text)
          return
        }
        send({ type: 'event', sessionId, event })
        break
      }

      default:
        send({ type: 'event', sessionId, event })
        break
    }
  })
}

// --- Command Handlers ---

/** Register a runtime into the sessions map, bind extensions, emit session_ready */
async function registerRuntime(runtime: AgentSessionRuntime): Promise<{ success: boolean; sessionId: string; error?: string }> {
  const sessionId = runtime.session.sessionId

  if (sessions.has(sessionId)) {
    await runtime.dispose()
    return { success: false, sessionId, error: 'session already active' }
  }

  const batcher = new StreamBatcher(sessionId)
  const unsubscribe = subscribeToSession(sessionId, runtime, batcher)
  sessions.set(sessionId, { runtime, batcher, unsubscribe })

  await runtime.session.bindExtensions({})

  const session = runtime.session
  send({
    type: 'session_ready',
    sessionId,
    model: session.model
      ? { name: session.model.name, provider: session.model.provider, id: session.model.id }
      : null,
    thinkingLevel: session.thinkingLevel,
  })

  return { success: true, sessionId }
}

async function createSession(cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    const runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd),
    })
    return registerRuntime(runtime)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send({ type: 'session_error', sessionId: '', error })
    return { success: false, error }
  }
}

async function resumeSession(sessionPath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  try {
    // SessionManager.open reads cwd from session header automatically
    const sessionManager = SessionManager.open(sessionPath)
    const cwd = sessionManager.getCwd()
    const runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    })
    return registerRuntime(runtime)
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err)
    send({ type: 'session_error', sessionId: '', error })
    return { success: false, error }
  }
}

async function destroySession(sessionId: string): Promise<void> {
  const entry = sessions.get(sessionId)
  if (!entry) return

  entry.unsubscribe()
  entry.batcher.stop()
  await entry.runtime.dispose()
  sessions.delete(sessionId)
}

async function handleCommand(cmd: PiCommand): Promise<unknown> {
  switch (cmd.type) {
    case 'create_session':
      return await createSession(cmd.cwd)

    case 'resume_session':
      return await resumeSession(cmd.sessionPath)

    case 'destroy_session':
      await destroySession(cmd.sessionId)
      return { success: true }

    case 'prompt': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return { success: false, error: 'session not found' }
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'prompt must be a non-empty string' }
      }
      entry.runtime.session.prompt(cmd.message).catch((err) => {
        send({ type: 'error', sessionId: cmd.sessionId, error: err instanceof Error ? err.message : String(err) })
      })
      return { success: true }
    }

    case 'abort': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return { success: false, error: 'session not found' }
      await entry.runtime.session.abort()
      return { success: true }
    }

    case 'getState': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return null
      const s = entry.runtime.session
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

    case 'getMessages': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return []
      return entry.runtime.session.messages
    }

    case 'switchSession': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return { success: false, error: 'session not found' }
      if (!cmd.sessionPath || cmd.sessionPath.trim().length === 0) {
        return { success: false, error: 'sessionPath must be a non-empty string' }
      }
      // Resubscribe after switch
      entry.unsubscribe()
      await entry.runtime.switchSession(cmd.sessionPath)
      const newUnsub = subscribeToSession(cmd.sessionId, entry.runtime, entry.batcher)
      entry.unsubscribe = newUnsub
      await entry.runtime.session.bindExtensions({})
      return { success: true, sessionId: entry.runtime.session.sessionId }
    }

    case 'listSessions': {
      const sessionList = cmd.cwd
        ? await SessionManager.list(cmd.cwd)
        : await SessionManager.listAll()
      return sessionList
    }

    case 'cycleModel': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return null
      return await entry.runtime.session.cycleModel()
    }

    case 'cycleThinkingLevel': {
      const entry = sessions.get(cmd.sessionId)
      if (!entry) return null
      return entry.runtime.session.cycleThinkingLevel()
    }
  }
}

// --- Message Listener ---

process.parentPort?.on('message', async (messageEvent) => {
  const { data, ports } = messageEvent

  // Receive a stream port for a specific session
  const msg = data as UtilityMessage | PiCommand
  if (msg.type === 'attach_stream_port' && ports.length > 0) {
    const sessionId = msg.sessionId
    const entry = sessions.get(sessionId)
    if (entry) {
      entry.batcher.start(ports[0])
    }
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
      send({ type: 'error', sessionId: (data as { sessionId?: string }).sessionId || '', error })
    }
  }
})
