import { create } from 'zustand';
import type {
  ContextUsage,
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
} from '../../../shared/ipcContract';
import type { Platform } from '../../../shared/platform';
import type { AgentStatus } from './transcriptController';

export type { AgentStatus };

export interface SessionEntry {
  sessionPath: string;
  persistedSessionId: string;
  status: AgentStatus;
  title: string;
  cwd: string;
  createdAt: string;
  model: ModelInfo | null;
  thinkingLevel: string | null;
  contextUsage: ContextUsage | null;
  autoCompactionEnabled: boolean;
  messageCount: number;
  error: string | null;
}

interface AppState {
  // Sessions (keyed by sessionPath)
  sessions: Map<string, SessionEntry>;
  activeSessionPath: string | null;

  recentProjects: ProjectDirectory[];
  activeProject: ProjectDirectory | null;
  projectSessions: Record<string, PiSessionInfo[]>;

  addSession: (sessionPath: string, cwd: string) => void;
  addSessionEntry: (entry: SessionEntry) => void;
  removeSession: (sessionPath: string) => void;
  setActiveSession: (sessionPath: string | null) => void;
  updateSession: (sessionPath: string, updates: Partial<Omit<SessionEntry, 'sessionPath'>>) => void;
  setProjects: (recentProjects: ProjectDirectory[], activeProject: ProjectDirectory | null) => void;
  setProjectSessions: (sessionsByCwd: Record<string, PiSessionInfo[]>) => void;
  setProjectSessionList: (cwd: string, sessions: PiSessionInfo[]) => void;

  // Sidebar
  sidebarExpanded: boolean;
  toggleSidebar: () => void;

  // Platform
  platform: Platform;
  setPlatform: (platform: Platform) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionPath: null,

  recentProjects: [],
  activeProject: null,
  projectSessions: {},

  addSession: (sessionPath, cwd) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(sessionPath, {
        sessionPath,
        persistedSessionId: '',
        status: 'idle',
        title: 'New chat',
        cwd,
        createdAt: new Date().toISOString(),
        model: null,
        thinkingLevel: null,
        contextUsage: null,
        autoCompactionEnabled: false,
        messageCount: 0,
        error: null,
      });
      return { sessions };
    }),

  addSessionEntry: (entry) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.set(entry.sessionPath, entry);
      return { sessions };
    }),

  removeSession: (sessionPath) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      sessions.delete(sessionPath);
      const activeSessionPath =
        state.activeSessionPath === sessionPath ? null : state.activeSessionPath;
      return { sessions, activeSessionPath };
    }),

  setActiveSession: (activeSessionPath) => set({ activeSessionPath }),

  updateSession: (sessionPath, updates) =>
    set((state) => {
      const sessions = new Map(state.sessions);
      const existing = sessions.get(sessionPath);
      if (existing) {
        sessions.set(sessionPath, { ...existing, ...updates });
      }
      return { sessions };
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

  // Platform
  platform: 'unknown',
  setPlatform: (platform) => set({ platform }),
}));
