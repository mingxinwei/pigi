import { create } from 'zustand';
import type {
  ContextUsage,
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
  ThinkingLevel,
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
  thinkingLevel: ThinkingLevel | null;
  contextUsage: ContextUsage | null;
  autoCompactionEnabled: boolean;
  messageCount: number;
  error: string | null;
}

interface AppState {
  // Sessions (keyed by sessionPath)
  sessions: Map<string, SessionEntry>;
  activeSessionPath: string | null;
  // Remembered scroll positions per session (sessionPath -> scrollTop)
  // scrollTop = -1 means "was at bottom, auto-scroll on restore"
  scrollPositions: Map<string, number>;
  setScrollPosition: (sessionPath: string, scrollTop: number) => void;

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

  // Navigation history (sessionPath[] stacks for back/forward)
  navigationBackStack: string[];
  navigationForwardStack: string[];

  /** Call BEFORE changing activeSessionPath to record the current session in history */
  pushNavigationHistory: (sessionPath: string) => void;
  /** Returns target sessionPath or null, updates stacks and activeSessionPath internally */
  navigateBack: () => string | null;
  /** Returns target sessionPath or null, updates stacks and activeSessionPath internally */
  navigateForward: () => string | null;
  /** Remove a session path from all history stacks */
  removeFromNavigationHistory: (sessionPath: string) => void;
}

export const useAppStore = create<AppState>((set) => ({
  sessions: new Map(),
  activeSessionPath: null,
  scrollPositions: new Map(),
  setScrollPosition: (sessionPath, scrollTop) =>
    set((state) => {
      const scrollPositions = new Map(state.scrollPositions);
      scrollPositions.set(sessionPath, scrollTop);
      return { scrollPositions };
    }),

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

  // Navigation history
  navigationBackStack: [],
  navigationForwardStack: [],

  pushNavigationHistory: (sessionPath) =>
    set((state) => {
      if (sessionPath === state.activeSessionPath) return {};
      // Remove target from backStack to avoid duplicates when toggling
      // between sessions (e.g. Ctrl+Tab D↔C keeps backStack clean).
      // .filter() creates a new array required by Zustand's immutability.
      const backStack = state.navigationBackStack.filter((p) => p !== sessionPath);
      if (state.activeSessionPath) {
        backStack.push(state.activeSessionPath);
      }
      return {
        navigationBackStack: backStack,
        navigationForwardStack: [],
      };
    }),

  navigateBack: () => {
    let targetPath: string | null = null;
    set((state) => {
      if (state.navigationBackStack.length === 0) return {};
      const nextBackStack = [...state.navigationBackStack];
      targetPath = nextBackStack.pop()!;
      const nextForwardStack = [...state.navigationForwardStack];
      if (state.activeSessionPath && !nextForwardStack.includes(state.activeSessionPath)) {
        nextForwardStack.push(state.activeSessionPath);
      }
      return {
        navigationBackStack: nextBackStack,
        navigationForwardStack: nextForwardStack,
      };
    });
    return targetPath;
  },

  navigateForward: () => {
    let targetPath: string | null = null;
    set((state) => {
      if (state.navigationForwardStack.length === 0) return {};
      const nextForwardStack = [...state.navigationForwardStack];
      targetPath = nextForwardStack.pop()!;
      const nextBackStack = [...state.navigationBackStack];
      if (state.activeSessionPath && !nextBackStack.includes(state.activeSessionPath)) {
        nextBackStack.push(state.activeSessionPath);
      }
      return {
        navigationBackStack: nextBackStack,
        navigationForwardStack: nextForwardStack,
      };
    });
    return targetPath;
  },

  removeFromNavigationHistory: (sessionPath) =>
    set((state) => ({
      navigationBackStack: state.navigationBackStack.filter((p) => p !== sessionPath),
      navigationForwardStack: state.navigationForwardStack.filter((p) => p !== sessionPath),
    })),
}));
