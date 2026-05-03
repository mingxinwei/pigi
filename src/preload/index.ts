/**
 * Preload script - exposes piApi to renderer via contextBridge.
 *
 * Two communication paths:
 * 1. Normal IPC (invoke/send): low-frequency commands and lifecycle events
 * 2. MessagePort (direct to pi-agent): high-frequency streaming batches
 */
import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

// --- Stream Port Setup ---
// Renderer requests port on load (and on HMR reload/refresh).
// Main responds by transferring port2 of the MessageChannel.

let streamPort: MessagePort | null = null
let streamCallback: ((batch: unknown) => void) | null = null

ipcRenderer.on('pi:stream_port', (event) => {
  const [port] = event.ports
  if (port) {
    streamPort = port
    streamPort.onmessage = (e) => {
      streamCallback?.(e.data)
    }
    streamPort.start()
  }
})

// Request the port (fires on initial load and after any reload)
ipcRenderer.send('pi:request_stream_port')

// --- API ---

const piApi = {
  // Low-frequency commands (normal IPC, routed through main)
  prompt: (message: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:prompt', message),

  abort: (): Promise<{ success: boolean }> =>
    ipcRenderer.invoke('pi:abort'),

  getState: (): Promise<unknown> =>
    ipcRenderer.invoke('pi:getState'),

  getMessages: (): Promise<unknown[]> =>
    ipcRenderer.invoke('pi:getMessages'),

  newSession: (): Promise<{ success: boolean; sessionId?: string }> =>
    ipcRenderer.invoke('pi:newSession'),

  switchSession: (sessionPath: string): Promise<{ success: boolean; sessionId?: string }> =>
    ipcRenderer.invoke('pi:switchSession', sessionPath),

  listSessions: (cwd?: string): Promise<unknown[]> =>
    ipcRenderer.invoke('pi:listSessions', cwd),

  cycleModel: (): Promise<unknown> =>
    ipcRenderer.invoke('pi:cycleModel'),

  cycleThinkingLevel: (): Promise<string | null> =>
    ipcRenderer.invoke('pi:cycleThinkingLevel'),

  // Low-frequency lifecycle events (normal IPC)
  onEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },

  onError: (callback: (error: { error: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { error: string }): void => callback(data)
    ipcRenderer.on('pi:error', handler)
    return () => ipcRenderer.removeListener('pi:error', handler)
  },

  onRuntimeReady: (callback: (data: { sessionId: string; model: { name: string; provider: string; id: string } | null; thinkingLevel: string | null }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { sessionId: string; model: { name: string; provider: string; id: string } | null; thinkingLevel: string | null }): void => callback(data)
    ipcRenderer.on('pi:runtime_ready', handler)
    return () => ipcRenderer.removeListener('pi:runtime_ready', handler)
  },

  onRuntimeError: (callback: (data: { error: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { error: string }): void => callback(data)
    ipcRenderer.on('pi:runtime_error', handler)
    return () => ipcRenderer.removeListener('pi:runtime_error', handler)
  },

  // High-frequency streaming (MessagePort, bypasses main)
  onStreamBatch: (callback: (batch: unknown) => void): (() => void) => {
    streamCallback = callback
    return () => { streamCallback = null }
  },
}

contextBridge.exposeInMainWorld('electron', electronAPI)
contextBridge.exposeInMainWorld('piApi', piApi)
