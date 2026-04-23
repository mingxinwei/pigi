import { contextBridge, ipcRenderer } from 'electron'
import { electronAPI } from '@electron-toolkit/preload'

const piApi = {
  /** Send a prompt to pi */
  prompt: (message: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke('pi:prompt', message),

  /** Abort current operation */
  abort: (): Promise<{ success: boolean }> => ipcRenderer.invoke('pi:abort'),

  /** Get current session state */
  getState: (): Promise<{
    model: { name: string; provider: string; id: string } | null
    thinkingLevel: string
    isStreaming: boolean
    sessionFile: string | undefined
    sessionId: string
    messageCount: number
  } | null> => ipcRenderer.invoke('pi:getState'),

  /** Get all messages in current session */
  getMessages: (): Promise<unknown[]> => ipcRenderer.invoke('pi:getMessages'),

  /** Create a new session */
  newSession: (): Promise<{ success: boolean; sessionId?: string }> =>
    ipcRenderer.invoke('pi:newSession'),

  /** Switch to a saved session */
  switchSession: (sessionPath: string): Promise<{ success: boolean; sessionId?: string }> =>
    ipcRenderer.invoke('pi:switchSession', sessionPath),

  /** List sessions */
  listSessions: (cwd?: string): Promise<unknown[]> => ipcRenderer.invoke('pi:listSessions', cwd),

  /** Cycle model */
  cycleModel: (): Promise<unknown> => ipcRenderer.invoke('pi:cycleModel'),

  /** Cycle thinking level */
  cycleThinkingLevel: (): Promise<string | null> => ipcRenderer.invoke('pi:cycleThinkingLevel'),

  /** Listen for pi events */
  onEvent: (callback: (event: unknown) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: unknown): void => callback(data)
    ipcRenderer.on('pi:event', handler)
    return () => ipcRenderer.removeListener('pi:event', handler)
  },

  /** Listen for pi errors */
  onError: (callback: (error: { error: string }) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, data: { error: string }): void => callback(data)
    ipcRenderer.on('pi:error', handler)
    return () => ipcRenderer.removeListener('pi:error', handler)
  },
}

if (process.contextIsolated) {
  try {
    contextBridge.exposeInMainWorld('electron', electronAPI)
    contextBridge.exposeInMainWorld('api', piApi)
  } catch (error) {
    console.error(error)
  }
} else {
  // @ts-ignore
  window.electron = electronAPI
  // @ts-ignore
  window.api = piApi
}
