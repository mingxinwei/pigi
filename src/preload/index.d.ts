import { ElectronAPI } from '@electron-toolkit/preload'

interface PiApi {
  prompt: (message: string) => Promise<{ success: boolean; error?: string }>
  abort: () => Promise<{ success: boolean }>
  getState: () => Promise<{
    model: { name: string; provider: string; id: string } | null
    thinkingLevel: string
    isStreaming: boolean
    sessionFile: string | undefined
    sessionId: string
    messageCount: number
  } | null>
  getMessages: () => Promise<unknown[]>
  newSession: () => Promise<{ success: boolean; sessionId?: string }>
  switchSession: (sessionPath: string) => Promise<{ success: boolean; sessionId?: string }>
  listSessions: (cwd?: string) => Promise<unknown[]>
  cycleModel: () => Promise<unknown>
  cycleThinkingLevel: () => Promise<string | null>
  onEvent: (callback: (event: unknown) => void) => () => void
  onError: (callback: (error: { error: string }) => void) => () => void
}

declare global {
  interface Window {
    electron: ElectronAPI
    api: PiApi
  }
}
