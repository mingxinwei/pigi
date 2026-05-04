import { create } from 'zustand'
import type { ModelInfo, ProjectDirectory } from '../../../shared/ipcContract'
import type { AgentStatus } from './transcriptController'

export type { AgentStatus }

export interface SessionEntry {
  sessionId: string
  status: AgentStatus
  title: string
  cwd: string
  model: ModelInfo | null
  thinkingLevel: string | null
  error: string | null
}

interface AppState {
  // Sessions
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null

  recentProjects: ProjectDirectory[]
  activeProject: ProjectDirectory | null

  addSession: (sessionId: string, cwd: string) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Omit<SessionEntry, 'sessionId'>>) => void
  setProjects: (recentProjects: ProjectDirectory[], activeProject: ProjectDirectory | null) => void

  // Sidebar
  sidebarExpanded: boolean
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,

  recentProjects: [],
  activeProject: null,

  addSession: (sessionId, cwd) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(sessionId, {
        sessionId,
        status: 'idle',
        title: 'New chat',
        cwd,
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

  setProjects: (recentProjects, activeProject) => set({ recentProjects, activeProject }),

  // Sidebar
  sidebarExpanded: true,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}))
