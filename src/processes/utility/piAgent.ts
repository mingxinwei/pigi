/**
 * Pi Agent - utility process managing exactly ONE pi SDK session.
 *
 * Lifecycle:
 * 1. Receives create_session/resume_session from main via parentPort
 * 2. Creates session, reports back real sessionId
 * 3. Receives attach_port from main with a MessagePort
 * 4. All subsequent communication flows over that port
 *
 * One process per session. Process exits when session is destroyed.
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
import type {
  PiCommand,
  PiPush,
  PiRequest,
  PiResult,
  PortMessage,
  StreamBatch,
  UtilityCommand,
  UtilityResponse,
} from '../../shared/ipcContract'

// =============================================================================
// Port interface (compatible with Electron's MessagePortMain)
// =============================================================================

interface Port {
  postMessage(message: unknown): void
  start(): void
  close(): void
  on(event: 'message', listener: (messageEvent: { data: unknown }) => void): unknown
}

// =============================================================================
// StreamBatcher
// =============================================================================

class StreamBatcher {
  private batch: StreamBatch = { type: 'stream_batch' }
  private dirty = false
  private timer: ReturnType<typeof setInterval> | null = null
  private port: Port | null = null

  start(port: Port): void {
    this.port = port
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

// =============================================================================
// Session state (single session per process)
// =============================================================================

let runtime: AgentSessionRuntime | null = null
let batcher: StreamBatcher | null = null
let sessionPort: Port | null = null
let unsubscribeEvents: (() => void) | null = null

// =============================================================================
// Runtime factory
// =============================================================================

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

// =============================================================================
// Event subscription
// =============================================================================

function subscribeToSession(rt: AgentSessionRuntime, port: Port, batch: StreamBatcher): () => void {
  const session = rt.session
  let currentAssistantId: string | null = null

  function push(msg: PiPush): void {
    port.postMessage(msg)
  }

  return session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case 'message_start': {
        const msg = (event as { message?: { role?: string; id?: string } }).message
        if (msg?.role === 'assistant') {
          currentAssistantId = msg.id || null
        }
        push({ type: 'event', event })
        break
      }

      case 'message_update': {
        const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } }).assistantMessageEvent
        if (ame && currentAssistantId) {
          if (ame.type === 'text_delta' && ame.delta) {
            batch.appendText(currentAssistantId, ame.delta)
            return
          }
          if (ame.type === 'thinking_delta' && ame.delta) {
            batch.appendThinking(currentAssistantId, ame.delta)
            return
          }
        }
        push({ type: 'event', event })
        break
      }

      case 'message_end':
        currentAssistantId = null
        push({ type: 'event', event })
        break

      case 'tool_execution_update': {
        const toolEvent = event as { toolCallId?: string; partialResult?: { content?: Array<{ text?: string }> } }
        const text = toolEvent.partialResult?.content?.[0]?.text
        if (text && toolEvent.toolCallId) {
          batch.appendToolOutput(toolEvent.toolCallId, text)
          return
        }
        push({ type: 'event', event })
        break
      }

      default:
        push({ type: 'event', event })
        break
    }
  })
}

// =============================================================================
// Command handling (via MessagePort from renderer)
// =============================================================================

async function handleCommand(cmd: PiCommand): Promise<unknown> {
  if (!runtime) return { success: false, error: 'session not initialized' }

  switch (cmd.type) {
    case 'prompt': {
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'prompt must be a non-empty string' }
      }
      runtime.session.prompt(cmd.message).catch((err) => {
        if (sessionPort) {
          const msg: PiPush = { type: 'error', error: err instanceof Error ? err.message : String(err) }
          sessionPort.postMessage(msg)
        }
      })
      return { success: true }
    }

    case 'abort':
      await runtime.session.abort()
      return { success: true }

    case 'get_state': {
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

    case 'get_messages':
      return runtime.session.messages

    case 'list_sessions': {
      return cmd.cwd
        ? await SessionManager.list(cmd.cwd)
        : await SessionManager.listAll()
    }

    case 'cycle_model':
      return await runtime.session.cycleModel()

    case 'cycle_thinking_level':
      return runtime.session.cycleThinkingLevel()
  }
}

function setupPortListener(port: Port): void {
  port.on('message', async (event: { data: unknown }) => {
    const data = event.data as PortMessage
    if ('id' in data && 'cmd' in data) {
      const req = data as PiRequest
      try {
        const result = await handleCommand(req.cmd)
        const response: PiResult = { id: req.id, result }
        port.postMessage(response)
      } catch (err) {
        const response: PiResult = { id: req.id, result: { success: false, error: err instanceof Error ? err.message : String(err) } }
        port.postMessage(response)
      }
    }
  })
  port.start()
}

// =============================================================================
// Session creation
// =============================================================================

function sendToMain(msg: UtilityResponse): void {
  process.parentPort?.postMessage(msg)
}

async function createSession(cwd: string): Promise<void> {
  try {
    runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd),
    })
    await runtime.session.bindExtensions({})
    sendToMain({ type: 'session_created', sessionId: runtime.session.sessionId })
  } catch (err) {
    sendToMain({ type: 'session_error', error: err instanceof Error ? err.message : String(err) })
  }
}

async function resumeSession(sessionPath: string): Promise<void> {
  try {
    const sessionManager = SessionManager.open(sessionPath)
    const cwd = sessionManager.getCwd()
    runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    })
    await runtime.session.bindExtensions({})
    sendToMain({ type: 'session_created', sessionId: runtime.session.sessionId })
  } catch (err) {
    sendToMain({ type: 'session_error', error: err instanceof Error ? err.message : String(err) })
  }
}

function attachPort(port: Port): void {
  if (!runtime) return

  sessionPort = port
  batcher = new StreamBatcher()
  batcher.start(port)
  unsubscribeEvents = subscribeToSession(runtime, port, batcher)
  setupPortListener(port)

  // Send session_ready as first push on the port
  const session = runtime.session
  const push: PiPush = {
    type: 'session_ready',
    model: session.model
      ? { name: session.model.name, provider: session.model.provider, id: session.model.id }
      : null,
    thinkingLevel: session.thinkingLevel,
  }
  port.postMessage(push)
}

// =============================================================================
// Cleanup
// =============================================================================

function cleanup(): void {
  unsubscribeEvents?.()
  batcher?.stop()
  sessionPort?.close()
  runtime?.dispose()
}

process.on('exit', cleanup)
process.on('SIGTERM', () => {
  cleanup()
  process.exit(0)
})

// =============================================================================
// Main listener (parentPort — lifecycle commands only)
// =============================================================================

process.parentPort?.on('message', async (messageEvent) => {
  const { data, ports } = messageEvent
  const cmd = data as UtilityCommand

  switch (cmd.type) {
    case 'create_session':
      await createSession(cmd.cwd)
      break
    case 'resume_session':
      await resumeSession(cmd.sessionPath)
      break
    case 'attach_port':
      if (ports.length > 0) {
        attachPort(ports[0])
      }
      break
  }
})
