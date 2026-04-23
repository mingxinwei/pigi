/**
 * Pi SDK integration for Electron main process.
 * Uses AgentSessionRuntime for full session lifecycle (new, switch, fork).
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
import { BrowserWindow, ipcMain } from 'electron'

let runtime: AgentSessionRuntime | null = null
let unsubscribe: (() => void) | null = null

// --- Helpers ---

function getMainWindow(): BrowserWindow | null {
  const wins = BrowserWindow.getAllWindows()
  return wins.length > 0 ? wins[0] : null
}

function sendToRenderer(channel: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

// --- Session event subscription ---

function subscribeToSession(): void {
  unsubscribe?.()
  if (!runtime) return

  const session = runtime.session
  unsubscribe = session.subscribe((event: AgentSessionEvent) => {
    sendToRenderer('pi:event', event)
  })
}

// --- Runtime factory ---

const createRuntimeFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent
}) => {
  const services = await createAgentSessionServices({ cwd })
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent
    })),
    services,
    diagnostics: services.diagnostics
  }
}

// --- Public API ---

export async function initPiSdk(cwd: string): Promise<void> {
  console.log(`[pi-sdk] Initializing with cwd=${cwd}`)

  runtime = await createAgentSessionRuntime(createRuntimeFactory, {
    cwd,
    agentDir: getAgentDir(),
    sessionManager: SessionManager.create(cwd)
  })

  subscribeToSession()

  const session = runtime.session
  console.log(`[pi-sdk] Ready. model=${session.model?.name ?? 'none'}, sessionId=${session.sessionId}`)
}

export async function disposePiSdk(): Promise<void> {
  unsubscribe?.()
  unsubscribe = null
  if (runtime) {
    await runtime.dispose()
    runtime = null
  }
}

// --- IPC Handlers ---

export function registerPiIpcHandlers(): void {
  // Send a prompt
  ipcMain.handle('pi:prompt', async (_event, message: string) => {
    if (!runtime) return { success: false, error: 'not initialized' }
    try {
      // prompt() resolves when the agent finishes (not just accepted)
      // We don't await it here — events stream via subscribe
      runtime.session.prompt(message).catch((err) => {
        console.error('[pi-sdk] prompt error:', err.message)
        sendToRenderer('pi:error', { error: err.message })
      })
      return { success: true }
    } catch (err) {
      return { success: false, error: String(err) }
    }
  })

  // Abort
  ipcMain.handle('pi:abort', async () => {
    if (!runtime) return { success: false }
    await runtime.session.abort()
    return { success: true }
  })

  // Get state
  ipcMain.handle('pi:getState', () => {
    if (!runtime) return null
    const s = runtime.session
    return {
      model: s.model ? { name: s.model.name, provider: s.model.provider, id: s.model.id } : null,
      thinkingLevel: s.thinkingLevel,
      isStreaming: s.isStreaming,
      sessionFile: s.sessionFile,
      sessionId: s.sessionId,
      messageCount: s.messages.length
    }
  })

  // Get messages
  ipcMain.handle('pi:getMessages', () => {
    if (!runtime) return []
    return runtime.session.messages
  })

  // New session
  ipcMain.handle('pi:newSession', async () => {
    if (!runtime) return { success: false }
    await runtime.newSession()
    subscribeToSession()
    return { success: true, sessionId: runtime.session.sessionId }
  })

  // Switch session
  ipcMain.handle('pi:switchSession', async (_event, sessionPath: string) => {
    if (!runtime) return { success: false }
    await runtime.switchSession(sessionPath)
    subscribeToSession()
    return { success: true, sessionId: runtime.session.sessionId }
  })

  // List sessions
  ipcMain.handle('pi:listSessions', async (_event, cwd?: string) => {
    const sessions = cwd
      ? await SessionManager.list(cwd)
      : await SessionManager.listAll()
    return sessions
  })

  // Set model
  ipcMain.handle('pi:cycleModel', async () => {
    if (!runtime) return null
    const result = await runtime.session.cycleModel()
    return result
  })

  // Set thinking level
  ipcMain.handle('pi:cycleThinkingLevel', () => {
    if (!runtime) return null
    return runtime.session.cycleThinkingLevel()
  })
}
