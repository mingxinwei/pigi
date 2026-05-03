/**
 * Preload script - exposes piApi to renderer via contextBridge.
 *
 * Multi-session design:
 * - Commands are scoped by sessionId
 * - Each session gets its own MessagePort for streaming
 * - Lifecycle events include sessionId so renderer knows which session they belong to
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// --- Per-session stream ports ---

const streamPorts = new Map<string, MessagePort>()
const streamCallbacks = new Map<string, (batch: unknown) => void>()

// Receive stream port for a specific session
ipcRenderer.on('pi:stream_port', (event, data: { sessionId: string }) => {
  const [port] = event.ports
  if (!port || !data?.sessionId) return

  streamPorts.set(data.sessionId, port)
  port.onmessage = (e) => {
    const callback = streamCallbacks.get(data.sessionId)
    callback?.(e.data)
  }
  port.start()
})

// --- API ---

const piApi = {
  // Session lifecycle
  createSession: (cwd: string): Promise<{ success: boolean; sessionId?: string; error?: string }> =>
    ipcRenderer.invoke('pi:createSession', cwd),

  destroySession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pi:destroySession', sessionId),

  // Request a stream port for a session (call after session_ready)
  requestStreamPort: (sessionId: string): void => {
    ipcRenderer.send('pi:request_stream_port', sessionId)
  },

  // Commands (all scoped by sessionId)
  prompt: (sessionId: string, message: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:prompt', sessionId, message),

  abort: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pi:abort', sessionId),

  getState: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke('pi:getState', sessionId),

  getMessages: (sessionId: string): Promise<unknown[]> =>
    ipcRenderer.invoke('pi:getMessages', sessionId),

  switchSession: (sessionId: string, sessionPath: string): Promise<{ success: boolean; sessionId?: string }> =>
    ipcRenderer.invoke('pi:switchSession', sessionId, sessionPath),

  listSessions: (cwd?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('pi:listSessions', cwd),

  cycleModel: (sessionId: string): Promise<unknown> =>
    ipcRenderer.invoke('pi:cycleModel', sessionId),

  cycleThinkingLevel: (sessionId: string): Promise<string | null> =>
    ipcRenderer.invoke('pi:cycleThinkingLevel', sessionId),

  // Lifecycle events (include sessionId)
  onSessionReady: (callback: (data: { sessionId: string; model: unknown; thinkingLevel: string | null }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; model: unknown; thinkingLevel: string | null }): void => callback(data)
    ipcRenderer.on('pi:session_ready', handler)
    return () => ipcRenderer.removeListener('pi:session_ready', handler)
  },

  onSessionError: (callback: (data: { sessionId: string; error: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on('pi:session_error', handler)
    return () => ipcRenderer.removeListener('pi:session_error', handler)
  },

  onEvent: (callback: (data: { sessionId: string; event: unknown }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; event: unknown }): void => callback(data)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },

  onError: (callback: (data: { sessionId: string; error: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on('pi:error', handler)
    return () => ipcRenderer.removeListener('pi:error', handler)
  },

  onAgentProcessExit: (callback: (data: { code: number }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { code: number }): void => callback(data)
    ipcRenderer.on('pi:agent_process_exit', handler)
    return () => ipcRenderer.removeListener('pi:agent_process_exit', handler)
  },

  // Stream subscription (per session, via MessagePort)
  onStreamBatch: (sessionId: string, callback: (batch: unknown) => void): (() => void) => {
    streamCallbacks.set(sessionId, callback)
    return () => { streamCallbacks.delete(sessionId) }
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('piApi', piApi)
