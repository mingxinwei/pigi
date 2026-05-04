/**
 * Preload script - exposes piApi to renderer via contextBridge.
 *
 * After session creation, communication goes directly over MessagePort.
 * Main process is only involved for lifecycle (create/resume/destroy session).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { PiChannel, type PiCommand, type PiPush, type PiRequest, type PiResult, type PortMessage, type StreamBatch } from '../shared/ipcContract'

// =============================================================================
// Per-session port management
// =============================================================================

interface SessionPort {
  port: MessagePort
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  pushHandler: ((msg: PiPush) => void) | null
  streamHandler: ((batch: StreamBatch) => void) | null
  requestId: number
}

const sessionPorts = new Map<string, SessionPort>()

function getSessionPort(sessionId: string): SessionPort {
  const sp = sessionPorts.get(sessionId)
  if (!sp) throw new Error(`no port for session ${sessionId}`)
  return sp
}

function setupPort(sessionId: string, port: MessagePort): void {
  const sp: SessionPort = {
    port,
    pending: new Map(),
    pushHandler: null,
    streamHandler: null,
    requestId: 0,
  }

  port.onmessage = (event) => {
    const data = event.data as PortMessage

    // Response to a command
    if ('id' in data && 'result' in data) {
      const res = data as PiResult
      const pending = sp.pending.get(res.id)
      if (pending) {
        sp.pending.delete(res.id)
        pending.resolve(res.result)
      }
      return
    }

    // Stream batch
    if ('type' in data && data.type === 'stream_batch') {
      sp.streamHandler?.(data as StreamBatch)
      return
    }

    // Push event
    if ('type' in data) {
      sp.pushHandler?.(data as PiPush)
    }
  }

  port.start()
  sessionPorts.set(sessionId, sp)
}

// Receive session port from main
ipcRenderer.on(PiChannel.SessionPort, (event, data: { sessionId: string }) => {
  const [port] = event.ports
  if (!port || !data?.sessionId) return
  setupPort(data.sessionId, port)
})

// =============================================================================
// API
// =============================================================================

const piApi = {
  /** Create a new session. Returns sessionId. Port arrives async via SessionPort channel. */
  createSession: (cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke(PiChannel.CreateSession, cwd),

  /** Resume an existing session by file path. */
  resumeSession: (sessionPath: string): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke(PiChannel.ResumeSession, sessionPath),

  /** Destroy a session. */
  destroySession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PiChannel.DestroySession, sessionId),

  /** Send a command to a session (via MessagePort). Returns result. */
  send: (sessionId: string, cmd: PiCommand): Promise<unknown> => {
    const sp = getSessionPort(sessionId)
    const id = `req-${++sp.requestId}`
    return new Promise((resolve, reject) => {
      sp.pending.set(id, { resolve, reject })
      const req: PiRequest = { id, cmd }
      sp.port.postMessage(req)
      setTimeout(() => {
        if (sp.pending.has(id)) {
          sp.pending.delete(id)
          reject(new Error('command timed out'))
        }
      }, 60000)
    })
  },

  /** Subscribe to push events for a session (session_ready, event, error). */
  onPush: (sessionId: string, callback: (msg: PiPush) => void): (() => void) => {
    const sp = sessionPorts.get(sessionId)
    if (sp) sp.pushHandler = callback
    return () => {
      const s = sessionPorts.get(sessionId)
      if (s) s.pushHandler = null
    }
  },

  /** Subscribe to stream batches for a session. */
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void): (() => void) => {
    const sp = sessionPorts.get(sessionId)
    if (sp) sp.streamHandler = callback
    return () => {
      const s = sessionPorts.get(sessionId)
      if (s) s.streamHandler = null
    }
  },

  /** Listen for process exit (main → renderer). */
  onProcessExit: (callback: (data: { code: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { code: number }): void => callback(data)
    ipcRenderer.on(PiChannel.ProcessExit, handler)
    return () => ipcRenderer.removeListener(PiChannel.ProcessExit, handler)
  },

  /** Check if a session port is connected. */
  hasPort: (sessionId: string): boolean => sessionPorts.has(sessionId),
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('piApi', piApi)
