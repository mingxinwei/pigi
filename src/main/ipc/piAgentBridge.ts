/**
 * Pi Agent Bridge - connects renderer (IPC) to the pi-agent utility process (postMessage).
 *
 * Responsibilities:
 * 1. Register IPC handlers for renderer requests
 * 2. Lazily spawn the utility process on first session creation
 * 3. Forward utility process responses back to renderer
 * 4. Manage per-session MessagePort handshake
 */
import { ipcMain, MessageChannelMain } from 'electron'
import { getMainWindow } from '../windows/createMainWindow'
import { createPiAgentProcess } from '../processes/createPiAgentProcess'
import { PiIpcInvoke, PiIpcSend } from '../../shared/ipcChannels'
import type { PiResponse, UtilityMessage } from '../../shared/protocol'

let utilityProcess: Electron.UtilityProcess | null = null
const pendingRequests = new Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>()
let requestIdCounter = 0

function sendToRenderer(channel: PiIpcSend, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

function handleUtilityMessage(msg: PiResponse): void {
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
      sendToRenderer(PiIpcSend.SessionReady, {
        sessionId: msg.sessionId,
        model: msg.model,
        thinkingLevel: msg.thinkingLevel,
      })
      break
    case 'session_error':
      sendToRenderer(PiIpcSend.SessionError, { sessionId: msg.sessionId, error: msg.error })
      break
    case 'event':
      sendToRenderer(PiIpcSend.Event, { sessionId: msg.sessionId, event: msg.event })
      break
    case 'error':
      sendToRenderer(PiIpcSend.Error, { sessionId: msg.sessionId, error: msg.error })
      break
  }
}

/** Lazily spawn the utility process. Returns the running process. */
function ensureUtilityProcess(): Electron.UtilityProcess {
  if (utilityProcess) return utilityProcess

  utilityProcess = createPiAgentProcess()
  utilityProcess.on('message', handleUtilityMessage)
  utilityProcess.on('exit', (code) => {
    console.error(`[main] utility process exited with code ${code}`)
    utilityProcess = null
    sendToRenderer(PiIpcSend.ProcessExit, { code })
  })
  return utilityProcess
}

/** Kill the utility process */
export function stopUtilityProcess(): void {
  if (utilityProcess) {
    utilityProcess.kill()
    utilityProcess = null
  }
}

function sendCommand(cmd: Record<string, unknown>): Promise<unknown> {
  const proc = ensureUtilityProcess()
  return new Promise((resolve, reject) => {
    const id = `req-${++requestIdCounter}`
    pendingRequests.set(id, { resolve, reject })
    proc.postMessage({ ...cmd, id })
    setTimeout(() => {
      if (pendingRequests.has(id)) {
        pendingRequests.delete(id)
        reject(new Error('utility process command timed out'))
      }
    }, 60000)
  })
}

/** Register all IPC handlers */
export function registerIpcHandlers(): void {
  ipcMain.handle(PiIpcInvoke.CreateSession, async (_e, cwd: string) => {
    if (!cwd || typeof cwd !== 'string') {
      return { success: false, error: 'cwd must be a non-empty string' }
    }
    return sendCommand({ type: 'create_session', cwd })
  })

  ipcMain.handle(PiIpcInvoke.DestroySession, async (_e, sessionId: string) => {
    if (!utilityProcess) return { success: false }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    return sendCommand({ type: 'destroy_session', sessionId })
  })

  ipcMain.handle(PiIpcInvoke.ResumeSession, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string' || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionPath must be a non-empty string' }
    }
    return sendCommand({ type: 'resume_session', sessionPath })
  })

  ipcMain.on(PiIpcSend.RequestStreamPort, (event, sessionId: string) => {
    if (!utilityProcess || !sessionId) return

    const { port1, port2 } = new MessageChannelMain()

    const msg: UtilityMessage = { type: 'attach_stream_port', sessionId }
    utilityProcess.postMessage(msg, [port1])

    event.sender.postMessage(PiIpcSend.StreamPort, { sessionId }, [port2])
  })

  ipcMain.handle(PiIpcInvoke.Prompt, async (_e, sessionId: string, message: string) => {
    if (!utilityProcess) return { success: false, error: 'no active session' }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, error: 'prompt must be a non-empty string' }
    }
    return sendCommand({ type: 'prompt', sessionId, message })
  })

  ipcMain.handle(PiIpcInvoke.Abort, async (_e, sessionId: string) => {
    if (!utilityProcess) return { success: false }
    if (!sessionId) return { success: false, error: 'sessionId required' }
    return sendCommand({ type: 'abort', sessionId })
  })

  ipcMain.handle(PiIpcInvoke.GetState, async (_e, sessionId: string) => {
    if (!utilityProcess || !sessionId) return null
    return sendCommand({ type: 'getState', sessionId })
  })

  ipcMain.handle(PiIpcInvoke.GetMessages, async (_e, sessionId: string) => {
    if (!utilityProcess || !sessionId) return []
    return sendCommand({ type: 'getMessages', sessionId })
  })

  ipcMain.handle(PiIpcInvoke.SwitchSession, async (_e, sessionId: string, sessionPath: string) => {
    if (!utilityProcess) return { success: false }
    if (!sessionId || !sessionPath || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionId and sessionPath required' }
    }
    return sendCommand({ type: 'switchSession', sessionId, sessionPath })
  })

  ipcMain.handle(PiIpcInvoke.ListSessions, async (_e, cwd?: string) => {
    if (!utilityProcess) return []
    return sendCommand({ type: 'listSessions', cwd })
  })

  ipcMain.handle(PiIpcInvoke.CycleModel, async (_e, sessionId: string) => {
    if (!utilityProcess || !sessionId) return null
    return sendCommand({ type: 'cycleModel', sessionId })
  })

  ipcMain.handle(PiIpcInvoke.CycleThinkingLevel, async (_e, sessionId: string) => {
    if (!utilityProcess || !sessionId) return null
    return sendCommand({ type: 'cycleThinkingLevel', sessionId })
  })
}
