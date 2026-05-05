/**
 * Preload script - exposes piApi to renderer via contextBridge.
 *
 * After session creation, communication goes directly over MessagePort.
 * Main process is only involved for lifecycle (create/resume/destroy session).
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import {
  PiChannel,
  type PiCommand,
  type PiPush,
  type PiRequest,
  type PiResult,
  type PortMessage,
  type ProjectSessionsChunk,
  type ProjectStateResult,
  type SessionListResult,
  type StreamBatch,
} from '../shared/ipcContract'

// =============================================================================
// Per-session port management
// =============================================================================

interface SessionPort {
  port: MessagePort
  pending: Map<string, { resolve: (v: unknown) => void; reject: (e: Error) => void }>
  pushHandlers: Set<(msg: PiPush) => void>
  streamHandlers: Set<(batch: StreamBatch) => void>
  requestId: number
}

const sessionPorts = new Map<string, SessionPort>()
const SESSION_PORT_CLOSED_ERROR = 'session process exited'

/** Handlers registered before port arrives */
const pendingPushHandlers = new Map<string, Set<(msg: PiPush) => void>>()
const pendingStreamHandlers = new Map<string, Set<(batch: StreamBatch) => void>>()

function cleanupSessionPort(sessionId: string): void {
  const sp = sessionPorts.get(sessionId)
  if (sp) {
    for (const pending of sp.pending.values()) {
      pending.reject(new Error(SESSION_PORT_CLOSED_ERROR))
    }
    sp.pending.clear()
    sp.pushHandlers.clear()
    sp.streamHandlers.clear()
    sp.port.close()
    sessionPorts.delete(sessionId)
  }
  pendingPushHandlers.delete(sessionId)
  pendingStreamHandlers.delete(sessionId)
}

function setupPort(sessionId: string, port: MessagePort): void {
  cleanupSessionPort(sessionId)

  const sp: SessionPort = {
    port,
    pending: new Map(),
    pushHandlers: new Set(),
    streamHandlers: new Set(),
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
      for (const handler of sp.streamHandlers) {
        handler(data as StreamBatch)
      }
      return
    }

    // Push event
    if ('type' in data) {
      for (const handler of sp.pushHandlers) {
        handler(data as PiPush)
      }
    }
  }

  port.start()
  sessionPorts.set(sessionId, sp)

  // Drain pending handlers registered before port arrived
  const pendingPush = pendingPushHandlers.get(sessionId)
  if (pendingPush) {
    for (const cb of pendingPush) sp.pushHandlers.add(cb)
    pendingPushHandlers.delete(sessionId)
  }
  const pendingStream = pendingStreamHandlers.get(sessionId)
  if (pendingStream) {
    for (const cb of pendingStream) sp.streamHandlers.add(cb)
    pendingStreamHandlers.delete(sessionId)
  }
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
  resumeSession: (
    sessionPath: string,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke(PiChannel.ResumeSession, sessionPath),

  /** Destroy a session. */
  destroySession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PiChannel.DestroySession, sessionId),

  /** Mark a session as recently selected. */
  touchSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PiChannel.TouchSession, sessionId),

  /** Get persisted project directory state from main process. */
  getProjects: (): Promise<ProjectStateResult> => ipcRenderer.invoke(PiChannel.GetProjects),

  /** Set active project directory from recent projects. */
  setActiveProject: (path: string): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.SetActiveProject, path),

  /** Open native directory picker and persist selected project directory. */
  openProjectDirectory: (): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.OpenProjectDirectory),

  /** List persisted pi sessions for project directories. */
  listProjectSessions: (cwds: string[]): Promise<SessionListResult> =>
    ipcRenderer.invoke(PiChannel.ListProjectSessions, cwds),

  /** Subscribe to persisted pi session chunks by project cwd. */
  onProjectSessionsChunk: (callback: (chunk: ProjectSessionsChunk) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: ProjectSessionsChunk): void => {
      callback(chunk)
    }
    ipcRenderer.on(PiChannel.ProjectSessionsChunk, handler)
    return () => ipcRenderer.removeListener(PiChannel.ProjectSessionsChunk, handler)
  },

  /** Send a command to a session (via MessagePort). Returns result. */
  send: (sessionId: string, cmd: PiCommand): Promise<unknown> => {
    const sp = sessionPorts.get(sessionId)
    if (!sp)
      return Promise.reject(
        new Error(`no port for session ${sessionId} (port may not have arrived yet)`),
      )
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
    if (sp) {
      sp.pushHandlers.add(callback)
    } else {
      // Port not yet arrived -- queue
      if (!pendingPushHandlers.has(sessionId)) {
        pendingPushHandlers.set(sessionId, new Set())
      }
      pendingPushHandlers.get(sessionId)!.add(callback)
    }
    return () => {
      const s = sessionPorts.get(sessionId)
      if (s) s.pushHandlers.delete(callback)
      pendingPushHandlers.get(sessionId)?.delete(callback)
    }
  },

  /** Subscribe to stream batches for a session. */
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void): (() => void) => {
    const sp = sessionPorts.get(sessionId)
    if (sp) {
      sp.streamHandlers.add(callback)
    } else {
      if (!pendingStreamHandlers.has(sessionId)) {
        pendingStreamHandlers.set(sessionId, new Set())
      }
      pendingStreamHandlers.get(sessionId)!.add(callback)
    }
    return () => {
      const s = sessionPorts.get(sessionId)
      if (s) s.streamHandlers.delete(callback)
      pendingStreamHandlers.get(sessionId)?.delete(callback)
    }
  },

  /** Listen for process exit (main → renderer). */
  onProcessExit: (callback: (data: { sessionId: string; code: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { sessionId: string; code: number },
    ): void => {
      cleanupSessionPort(data.sessionId)
      callback(data)
    }
    ipcRenderer.on(PiChannel.ProcessExit, handler)
    return () => ipcRenderer.removeListener(PiChannel.ProcessExit, handler)
  },

  /** Get the app's working directory (for session creation). */
  getCwd: (): string => process.cwd(),
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('piApi', piApi)
