import { ElectronAPI } from '@electron-toolkit/preload'
import type { StreamBatch, ModelInfo, SessionState } from '../shared/protocol'

interface PiApi {
  // Low-frequency commands
  prompt: (message: string) => Promise<{ success: boolean; error?: string }>
  abort: () => Promise<{ success: boolean }>
  getState: () => Promise<SessionState | null>
  getMessages: () => Promise<unknown[]>
  newSession: () => Promise<{ success: boolean; sessionId?: string }>
  switchSession: (sessionPath: string) => Promise<{ success: boolean; sessionId?: string }>
  listSessions: (cwd?: string) => Promise<unknown[]>
  cycleModel: () => Promise<unknown>
  cycleThinkingLevel: () => Promise<string | null>

  // Low-frequency lifecycle events (normal IPC)
  onEvent: (callback: (event: unknown) => void) => () => void
  onError: (callback: (error: { error: string }) => void) => () => void
  onRuntimeReady: (callback: (data: { sessionId: string; model: ModelInfo | null; thinkingLevel: string | null }) => void) => () => void
  onRuntimeError: (callback: (data: { error: string }) => void) => () => void

  // High-frequency streaming (MessagePort, bypasses main)
  onStreamBatch: (callback: (batch: StreamBatch) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    piApi: PiApi
  }
}
