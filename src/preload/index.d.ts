import { ElectronAPI } from '@electron-toolkit/preload'
import type { StreamBatch, ModelInfo, SessionState } from '../shared/protocol'

interface PiApi {
  // Session lifecycle
  createSession: (cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>
  destroySession: (sessionId: string) => Promise<{ success: boolean }>
  requestStreamPort: (sessionId: string) => void

  // Commands (scoped by sessionId)
  prompt: (sessionId: string, message: string) => Promise<{ success: boolean; error?: string }>
  abort: (sessionId: string) => Promise<{ success: boolean }>
  getState: (sessionId: string) => Promise<SessionState | null>
  getMessages: (sessionId: string) => Promise<unknown[]>
  switchSession: (sessionId: string, sessionPath: string) => Promise<{ success: boolean; sessionId?: string }>
  listSessions: (cwd?: string) => Promise<unknown[]>
  cycleModel: (sessionId: string) => Promise<unknown>
  cycleThinkingLevel: (sessionId: string) => Promise<string | null>

  // Lifecycle events (include sessionId)
  onSessionReady: (callback: (data: { sessionId: string; model: ModelInfo | null; thinkingLevel: string | null }) => void) => () => void
  onSessionError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
  onEvent: (callback: (data: { sessionId: string; event: unknown }) => void) => () => void
  onError: (callback: (data: { sessionId: string; error: string }) => void) => () => void
  onAgentProcessExit: (callback: (data: { code: number }) => void) => () => void

  // Stream (per session, via MessagePort)
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    piApi: PiApi
  }
}
