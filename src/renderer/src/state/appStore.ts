import { create } from 'zustand'

export type AgentStatus = 'idle' | 'streaming' | 'tool_running' | 'error'

export interface ModelInfo {
  name: string
  provider: string
  id: string
}

export interface ChatMessage {
  id: string
  role: 'user' | 'assistant' | 'tool'
  content: string
  toolName?: string
  isStreaming?: boolean
}

export interface SessionEntry {
  sessionId: string
  status: AgentStatus
  model: ModelInfo | null
  thinkingLevel: string | null
  error: string | null
  messages: ChatMessage[]
}

interface AppState {
  // Sessions (multiple can exist simultaneously)
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null

  addSession: (sessionId: string) => void
  removeSession: (sessionId: string) => void
  setActiveSession: (sessionId: string | null) => void
  updateSession: (sessionId: string, updates: Partial<Omit<SessionEntry, 'sessionId' | 'messages'>>) => void

  // Per-session message operations
  appendMessage: (sessionId: string, message: ChatMessage) => void
  updateMessage: (sessionId: string, messageId: string, updates: Partial<ChatMessage>) => void
  setMessages: (sessionId: string, messages: ChatMessage[]) => void

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
        messages: [],
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

  appendMessage: (sessionId, message) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const existing = sessions.get(sessionId)
      if (existing) {
        sessions.set(sessionId, {
          ...existing,
          messages: [...existing.messages, message],
        })
      }
      return { sessions }
    }),

  updateMessage: (sessionId, messageId, updates) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const existing = sessions.get(sessionId)
      if (existing) {
        sessions.set(sessionId, {
          ...existing,
          messages: existing.messages.map((m) =>
            m.id === messageId ? { ...m, ...updates } : m,
          ),
        })
      }
      return { sessions }
    }),

  setMessages: (sessionId, messages) =>
    set((state) => {
      const sessions = new Map(state.sessions)
      const existing = sessions.get(sessionId)
      if (existing) {
        sessions.set(sessionId, { ...existing, messages })
      }
      return { sessions }
    }),

  // Sidebar
  sidebarExpanded: true,
  toggleSidebar: () => set((s) => ({ sidebarExpanded: !s.sidebarExpanded })),
}))
