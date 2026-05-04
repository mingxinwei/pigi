import { create } from 'zustand'
import type { ModelInfo } from '../../../shared/ipcContract'
import type { AgentStatus } from './transcriptController'

export type { AgentStatus }

export interface SessionEntry {
  sessionId: string
  status: AgentStatus
  model: ModelInfo | null
  thinkingLevel: string | null
  error: string | null
}

interface AppState {
  // Sessions
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null

  addSession: (sessionId: string) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Omit<SessionEntry, 'sessionId'>>) => void

  // Sidebar
  sidebarExpanded: boolean
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,

  addSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(sessionId, {
        sessionId,
        status: 'idle',
        model: null,
        thinkingLevel: null,
        error: null,
      })
      return { sessions }
    }),

  removeSession: (sessionId) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.delete(sessionId)
      const activeSessionId = state.activeSessionId === sessionId ? null : state.activeSessionId
      return { sessions, activeSessionId }
    }),

  setActiveSession: (activeSessionId) => set({ activeSessionId }),

  updateSession: (sessionId, updates) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const existing = sessions.get(sessionId)
      if (existing) {
        sessions.set(sessionId, { ...existing, ...updates })
      }
      return { sessions }
    }),

  // Sidebar
  sidebarExpanded: true,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}))
