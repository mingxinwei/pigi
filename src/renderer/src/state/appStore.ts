import { create } from 'zustand'
import type {
  ContextUsage,
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
} from '../../../shared/ipcContract'
import type { AgentStatus } from './transcriptController'

export type { AgentStatus }

export interface SessionEntry {
  sessionId: string
  persistedSessionId: string
  sessionPath: string | null
  status: AgentStatus
  title: string
  cwd: string
  createdAt: string
  model: ModelInfo | null
  thinkingLevel: string | null
  contextUsage: ContextUsage | null
  autoCompactionEnabled: boolean
  error: string | null
}

interface AppState {
  // Sessions
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null

  recentProjects: ProjectDirectory[]
  activeProject: ProjectDirectory | null
  projectSessions: Record<string, PiSessionInfo[]>

  addSession: (sessionId: string, cwd: string) => void
  addSessionEntry: (entry: SessionEntry) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Omit<SessionEntry, 'sessionId'>>) => void
  setProjects: (recentProjects: ProjectDirectory[], activeProject: ProjectDirectory | null) => void
  setProjectSessions: (sessionsByCwd: Record<string, PiSessionInfo[]>) => void
  setProjectSessionList: (cwd: string, sessions: PiSessionInfo[]) => void

  // Sidebar
  sidebarExpanded: boolean
  toggleSidebar: () => void
}

export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionId: null,

  recentProjects: [],
  activeProject: null,
  projectSessions: {},

  addSession: (sessionId, cwd) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(sessionId, {
        sessionId,
        persistedSessionId: sessionId,
        sessionPath: null,
        status: 'idle',
        title: 'New chat',
        cwd,
        createdAt: new Date().toISOString(),
        model: null,
        thinkingLevel: null,
        contextUsage: null,
        autoCompactionEnabled: false,
        error: null,
      })
      return { sessions }
    }),

  addSessionEntry: (entry) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      sessions.set(entry.sessionId, entry)
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
  setProjectSessions: (projectSessions) => set({ projectSessions }),
  setProjectSessionList: (cwd, sessions) =>
    set((state) => ({
      projectSessions: {
        ...state.projectSessions,
        [cwd]: sessions,
      },
    })),

  // Sidebar
  sidebarExpanded: true,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}))
