import { create } from 'zustand'

export type RuntimeStatus = 'initializing' | 'ready' | 'error'
export type AgentStatus = 'idle' | 'streaming' | 'tool_running' | 'error'

interface ModelInfo {
  name: string
  provider: string
  id: string
}

interface SessionInfo {
  sessionId: string
  sessionFile?: string
}

interface AppState {
  // Runtime
  runtimeStatus: RuntimeStatus
  runtimeError: string | null
  setRuntimeReady: () => void
  setRuntimeError: (error: string) => void

  // Agent status
  agentStatus: AgentStatus
  setAgentStatus: (status: AgentStatus) => void

  // Model
  model: ModelInfo | null
  thinkingLevel: string | null
  setModel: (model: ModelInfo | null) => void
  setThinkingLevel: (level: string | null) => void

  // Session
  session: SessionInfo | null
  setSession: (session: SessionInfo | null) => void

  // Sidebar
  sidebarExpanded: boolean
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  // Runtime
  runtimeStatus: 'initializing',
  runtimeError: null,
  setRuntimeReady: () => set({ runtimeStatus: 'ready', runtimeError: null }),
  setRuntimeError: (error) => set({ runtimeStatus: 'error', runtimeError: error }),

  // Agent status
  agentStatus: 'idle',
  setAgentStatus: (agentStatus) => set({ agentStatus }),

  // Model
  model: null,
  thinkingLevel: null,
  setModel: (model) => set({ model }),
  setThinkingLevel: (thinkingLevel) => set({ thinkingLevel }),

  // Session
  session: null,
  setSession: (session) => set({ session }),

  // Sidebar
  sidebarExpanded: true,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}))
