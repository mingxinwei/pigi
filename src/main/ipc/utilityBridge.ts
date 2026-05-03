/**
 * Utility bridge - manages pi-agent process and per-session MessagePort channels.
 *
 * Key design:
 * - pi-agent process is spawned once (lightweight, holds no sessions initially)
 * - Sessions are created on-demand via 'create_session' command
 * - Each session gets its own MessageChannel (port1 → pi-agent, port2 → renderer)
 * - Renderer requests a port by sessionId; main creates the channel and distributes
 *
 * Flow for new session:
 * 1. renderer calls createSession(cwd) via IPC
 * 2. main generates sessionId, sends 'create_session' to pi-agent
 * 3. pi-agent creates runtime, responds with session_ready
 * 4. renderer calls requestStreamPort(sessionId)
 * 5. main creates MessageChannel, sends port1 to pi-agent, port2 to renderer
 * 6. Streaming flows directly pi-agent ↔ renderer via ports
 */
import { ipcMain, MessageChannelMain } from 'electron'
import { getMainWindow } from '../windows/createMainWindow'
import { createPiAgentProcess } from '../processes/createPiAgentProcess'
import type { PiResponse } from '../../shared/protocol'

let piAgent: Electron.UtilityProcess | null = null
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let requestIdCounter = 0

function sendToRenderer(channel: string, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

function sendCommand(cmd: Record<string, unknown>): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const id = `req-${++requestIdCounter}`
    pendingRequests.set(id, { resolve, reject })
    piAgent?.postMessage({ ...cmd, id })
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('pi-agent command timed out'))
      }
    }, 60000)
  })
}

function handlePiAgentMessage(msg: PiResponse): void {
  switch (msg.type) {
    case 'result': {
      const pending = pendingRequests.get(msg.id)
      if (pending) {
        pendingRequests.delete(msg.id)
        pending.resolve(msg.data)
      }
      break
    }
    case 'session_ready':
      sendToRenderer('pi:session_ready', {
        sessionId: msg.sessionId,
        model: msg.model,
        thinkingLevel: msg.thinkingLevel,
      })
      break
    case 'session_error':
      sendToRenderer('pi:session_error', { sessionId: msg.sessionId, error: msg.error })
      break
    case 'event':
      sendToRenderer('pi:event', { sessionId: msg.sessionId, event: msg.event })
      break
    case 'error':
      sendToRenderer('pi:error', { sessionId: msg.sessionId, error: msg.error })
      break
  }
}

/** Spawn pi-agent utility process (no sessions yet) */
export function startPiAgent(): void {
  piAgent = createPiAgentProcess()
  piAgent.on('message', handlePiAgentMessage)
  piAgent.on('exit', (code) => {
    console.error(`[main] pi-agent exited with code ${code}`)
    piAgent = null
    sendToRenderer('pi:agent_process_exit', { code })
  })
}

/** Kill pi-agent process */
export function stopPiAgent(): void {
  if (piAgent) {
    piAgent.kill()
    piAgent = null
  }
}

/** Register IPC handlers */
export function registerPiIpcHandlers(): void {
  // Create a new session
  ipcMain.handle('pi:createSession', async (_e, cwd: string) => {
    if (!piAgent) return { success: false, error: 'pi-agent not running' }
    if (!cwd || typeof cwd !== 'string') {
      return { success: false, error: 'cwd must be a non-empty string' }
    }
    // pi-agent creates the runtime and returns the real pi sessionId
    const result = await sendCommand({ type: 'create_session', cwd }) as { success: boolean; sessionId?: string; error?: string }
    return result
  })

  // Destroy a session
  ipcMain.handle('pi:destroySession', async (_e, sessionId: string) => {
    if (!piAgent) return { success: false }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    return sendCommand({ type: 'destroy_session', sessionId })
  })

  // Request a stream port for a session (renderer calls this after session_ready)
  ipcMain.on('pi:request_stream_port', (event, sessionId: string) => {
    if (!piAgent || !sessionId) return

    const { port1, port2 } = new MessageChannelMain()

    // port1 → pi-agent (tagged with sessionId so it knows which batcher to attach)
    piAgent.postMessage({ type: 'attach_stream_port', sessionId }, [port1])

    // port2 → renderer
    event.sender.postMessage('pi:stream_port', { sessionId }, [port2])
  })

  // Prompt
  ipcMain.handle('pi:prompt', async (_e, sessionId: string, message: string) => {
    if (!piAgent) return { success: false, error: 'pi-agent not running' }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, error: 'prompt must be a non-empty string' }
    }
    return sendCommand({ type: 'prompt', sessionId, message })
  })

  // Abort
  ipcMain.handle('pi:abort', async (_e, sessionId: string) => {
    if (!piAgent) return { success: false }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    return sendCommand({ type: 'abort', sessionId })
  })

  // Get state
  ipcMain.handle('pi:getState', async (_e, sessionId: string) => {
    if (!piAgent) return null
    if (!sessionId) return null
    return sendCommand({ type: 'getState', sessionId })
  })

  // Get messages
  ipcMain.handle('pi:getMessages', async (_e, sessionId: string) => {
    if (!piAgent) return []
    if (!sessionId) return []
    return sendCommand({ type: 'getMessages', sessionId })
  })

  // Switch session file within an existing runtime
  ipcMain.handle('pi:switchSession', async (_e, sessionId: string, sessionPath: string) => {
    if (!piAgent) return { success: false }
    if (!sessionId || !sessionPath || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionId and sessionPath required' }
    }
    return sendCommand({ type: 'switchSession', sessionId, sessionPath })
  })

  // List sessions
  ipcMain.handle('pi:listSessions', async (_e, cwd?: string) => {
    if (!piAgent) return []
    return sendCommand({ type: 'listSessions', cwd })
  })

  // Cycle model
  ipcMain.handle('pi:cycleModel', async (_e, sessionId: string) => {
    if (!piAgent) return null
    if (!sessionId) return null
    return sendCommand({ type: 'cycleModel', sessionId })
  })

  // Cycle thinking level
  ipcMain.handle('pi:cycleThinkingLevel', async (_e, sessionId: string) => {
    if (!piAgent) return null
    if (!sessionId) return null
    return sendCommand({ type: 'cycleThinkingLevel', sessionId })
  })
}
