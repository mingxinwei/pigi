import { ElectronAPI } from '@electron-toolkit/preload';
import type {
  PiCommand,
  PiPush,
  GitBranchResult,
  ModelInfo,
  ProjectSessionsChunk,
  ProjectStateResult,
  SessionListResult,
  ShortcutBinding,
  ShortcutDefinition,
  StreamBatch,
} from '../shared/ipcContract';

interface PiApi {
  // Session lifecycle (via main process IPC)
  createSession: (
    cwd: string,
  ) => Promise<{ success: boolean; sessionPath?: string; error?: string }>;
  resumeSession: (
    sessionPath: string,
  ) => Promise<{ success: boolean; sessionPath?: string; error?: string }>;
  destroySession: (sessionPath: string) => Promise<{ success: boolean }>;
  touchSession: (sessionPath: string) => Promise<{ success: boolean; error?: string }>;

  // Project directories
  getProjects: () => Promise<ProjectStateResult>;
  getGitBranch: (cwd: string) => Promise<GitBranchResult>;
  setActiveProject: (path: string) => Promise<ProjectStateResult>;
  openProjectDirectory: () => Promise<ProjectStateResult>;
  removeProject: (path: string) => Promise<ProjectStateResult>;
  reorderProjects: (paths: string[]) => Promise<ProjectStateResult>;
  renamePersistedSession: (
    sessionPath: string,
    name: string,
  ) => Promise<{ success: boolean; error?: string }>;
  readSessionMessages: (sessionPath: string) => Promise<{
    success: boolean;
    messages?: unknown[];
    compactionCount?: number;
    thinkingLevel?: string;
    model?: { provider: string; modelId: string } | null;
    error?: string;
  }>;
  listProjectSessions: (cwds: string[]) => Promise<SessionListResult>;
  onProjectSessionsChunk: (callback: (chunk: ProjectSessionsChunk) => void) => () => void;

  // Commands (via control MessagePort, direct to utility)
  send: (sessionPath: string, command: PiCommand) => Promise<unknown>;

  // Subscriptions (via data MessagePort)
  onPush: (sessionPath: string, callback: (message: PiPush) => void) => () => void;
  onStreamBatch: (sessionPath: string, callback: (batch: StreamBatch) => void) => () => void;

  // Process lifecycle
  onProcessExit: (callback: (data: { sessionPath: string; code: number }) => void) => () => void;

  // Utilities
  getCwd: () => string;
  openExternal: (url: string) => void;
  getWarmSessionOptions: () => Promise<{ models: ModelInfo[]; complete: boolean }>;

  // Keyboard shortcuts
  getShortcuts: () => Promise<ShortcutDefinition[]>;
  setShortcut: (
    id: string,
    binding: ShortcutBinding,
  ) => Promise<{ success: boolean; error?: string }>;
  getAccentColor: () => Promise<string | null>;

  // Bottom-panel terminals (one PTY per cwd, I/O over a dedicated MessagePort each)
  terminal: {
    start: (cwd: string, cols: number, rows: number) => Promise<{ success: boolean }>;
    stop: (cwd: string) => void;
    write: (cwd: string, data: string) => void;
    resize: (cwd: string, cols: number, rows: number) => void;
    onData: (cwd: string, callback: (data: string) => void) => () => void;
    onExit: (cwd: string, callback: (exitCode: number | null) => void) => () => void;
  };
}

declare global {
  interface Window {
    electron: ElectronAPI;
    piApi: PiApi;
  }
}
