import { ElectronAPI } from '@electron-toolkit/preload'
import type { PiCommand, PiPush, StreamBatch } from '../shared/ipcContract'

interface PiApi {
  // Session lifecycle (via main process IPC)
  createSession: (cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  resumeSession: (sessionPath: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  destroySession: (sessionId: string) => Promise<{ success: boolean }>

  // Commands (via MessagePort, direct to utility)
  send: (sessionId: string, cmd: PiCommand) => Promise<unknown>

  // Subscriptions (via MessagePort)
  onPush: (sessionId: string, callback: (msg: PiPush) => void) => () => void
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void) => () => void

  // Process lifecycle
  onProcessExit: (callback: (data: { code: number }) => void) => () => void

  // Utilities
  hasPort: (sessionId: string) => boolean
}

declare global {
  interface Window {
    electron: ElectronAPI
    piApi: PiApi
  }
}
