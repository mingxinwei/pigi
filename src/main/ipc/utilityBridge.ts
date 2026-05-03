/**
 * Utility bridge - establishes communication between renderer and pi-agent.
 *
 * Responsibilities:
 * 1. Create MessageChannel and distribute ports (renderer ↔ pi-agent direct streaming)
 * 2. Forward low-frequency control commands (renderer → main → pi-agent)
 * 3. Forward lifecycle events (pi-agent → main → renderer)
 *
 * After port distribution, streaming data flows directly renderer ↔ pi-agent.
 * Main never sees streaming tokens.
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
    case 'runtime_ready':
      sendToRenderer('pi:runtime_ready', {
        sessionId: msg.sessionId,
        model: msg.model,
        thinkingLevel: msg.thinkingLevel,
      })
      break
    case 'runtime_error':
      sendToRenderer('pi:runtime_error', { error: msg.error })
      break
    case 'event':
      sendToRenderer('pi:event', msg.event)
      break
    case 'error':
      sendToRenderer('pi:error', { error: msg.error })
      break
  }
}

/** Start pi-agent and wire up the MessagePort streaming channel */
export function startPiAgent(): void {
  piAgent = createPiAgentProcess()

  piAgent.on('message', handlePiAgentMessage)

  piAgent.on('exit', (code) => {
    console.error(`[main] pi-agent exited with code ${code}`)
    piAgent = null
    sendToRenderer('pi:runtime_error', { error: `pi-agent exited unexpectedly (code ${code})` })
  })

  // Initialize runtime
  piAgent.postMessage({ type: 'init', cwd: process.cwd() })

  // Create MessageChannel: port1 → pi-agent, port2 → renderer
  const { port1, port2 } = new MessageChannelMain()
  piAgent.postMessage({ type: 'stream_port' }, [port1])

  // Renderer requests port when ready (also handles page refresh/HMR reload)
  ipcMain.on('pi:request_stream_port', (event) => {
    event.sender.postMessage('pi:stream_port', null, [port2])
  })
}

/** Kill pi-agent process */
export function stopPiAgent(): void {
  if (piAgent) {
    piAgent.kill()
    piAgent = null
  }
}

/** Register IPC handlers for low-frequency commands */
export function registerPiIpcHandlers(): void {
  ipcMain.handle('pi:prompt', async (_e, message: string) => {
    if (!message || typeof message !== 'string' || message.trim().length === 0) {
      return { success: false, error: 'prompt must be a non-empty string' }
    }
    return sendCommand({ type: 'prompt', message })
  })

  ipcMain.handle('pi:abort', () => sendCommand({ type: 'abort' }))
  ipcMain.handle('pi:getState', () => sendCommand({ type: 'getState' }))
  ipcMain.handle('pi:getMessages', () => sendCommand({ type: 'getMessages' }))
  ipcMain.handle('pi:newSession', () => sendCommand({ type: 'newSession' }))

  ipcMain.handle('pi:switchSession', async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string' || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionPath must be a non-empty string' }
    }
    return sendCommand({ type: 'switchSession', sessionPath })
  })

  ipcMain.handle('pi:listSessions', (_e, cwd?: string) => sendCommand({ type: 'listSessions', cwd }))
  ipcMain.handle('pi:cycleModel', () => sendCommand({ type: 'cycleModel' }))
  ipcMain.handle('pi:cycleThinkingLevel', () => sendCommand({ type: 'cycleThinkingLevel' }))
}
