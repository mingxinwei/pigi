/**
 * Preload script - exposes piApi to renderer via contextBridge.
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'
import { PiIpcInvoke, PiIpcSend } from '../shared/ipcChannels'

// --- Per-session stream ports ---

const streamCallbacks = new Map<string, (batch: unknown) => void>()

ipcRenderer.on(PiIpcSend.StreamPort, (event, data: { sessionId: string }) => {
  const [port] = event.ports
  if (!port || !data?.sessionId) return

  port.onmessage = (e) => {
    const callback = streamCallbacks.get(data.sessionId)
    callback?.(e.data)
  }
  port.start()
})

// --- API ---

const piApi = {
  // Session lifecycle
  createSession: (cwd: string) =>
    ipcRenderer.invoke(PiIpcInvoke.CreateSession, cwd),

  destroySession: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.DestroySession, sessionId),

  resumeSession: (sessionPath: string) =>
    ipcRenderer.invoke(PiIpcInvoke.ResumeSession, sessionPath),

  requestStreamPort: (sessionId: string): void => {
    ipcRenderer.send(PiIpcSend.RequestStreamPort, sessionId)
  },

  // Commands (all scoped by sessionId)
  prompt: (sessionId: string, message: string) =>
    ipcRenderer.invoke(PiIpcInvoke.Prompt, sessionId, message),

  abort: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.Abort, sessionId),

  getState: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.GetState, sessionId),

  getMessages: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.GetMessages, sessionId),

  switchSession: (sessionId: string, sessionPath: string) =>
    ipcRenderer.invoke(PiIpcInvoke.SwitchSession, sessionId, sessionPath),

  listSessions: (cwd?: string) =>
    ipcRenderer.invoke(PiIpcInvoke.ListSessions, cwd),

  cycleModel: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.CycleModel, sessionId),

  cycleThinkingLevel: (sessionId: string) =>
    ipcRenderer.invoke(PiIpcInvoke.CycleThinkingLevel, sessionId),

  // Lifecycle events
  onSessionReady: (callback: (data: { sessionId: string; model: unknown; thinkingLevel: string | null }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; model: unknown; thinkingLevel: string | null }): void => callback(data)
    ipcRenderer.on(PiIpcSend.SessionReady, handler)
    return () => ipcRenderer.removeListener(PiIpcSend.SessionReady, handler)
  },

  onSessionError: (callback: (data: { sessionId: string; error: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on(PiIpcSend.SessionError, handler)
    return () => ipcRenderer.removeListener(PiIpcSend.SessionError, handler)
  },

  onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; event: unknown }): void => callback(data)
    ipcRenderer.on(PiIpcSend.Event, handler)
    return () => ipcRenderer.removeListener(PiIpcSend.Event, handler)
  },

  onError: (callback: (data: { sessionId: string; error: string }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; error: string }): void => callback(data)
    ipcRenderer.on(PiIpcSend.Error, handler)
    return () => ipcRenderer.removeListener(PiIpcSend.Error, handler)
  },

  onProcessExit: (callback: (data: { code: number }) => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { code: number }): void => callback(data)
    ipcRenderer.on(PiIpcSend.ProcessExit, handler)
    return () => ipcRenderer.removeListener(PiIpcSend.ProcessExit, handler)
  },

  // Stream subscription (per session, via MessagePort)
  onStreamBatch: (sessionId: string, callback: (batch: unknown) => void): (() => void) => {
    streamCallbacks.set(sessionId, callback)
    return () => { streamCallbacks.delete(sessionId) }
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('piApi', piApi)
