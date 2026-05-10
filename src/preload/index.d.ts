import { ElectronAPI } from '@electron-toolkit/preload';
import type {
  PiCommand,
  PiPush,
  GitBranchResult,
  ProjectSessionsChunk,
  ProjectStateResult,
  SessionListResult,
  StreamBatch,
} from '../shared/ipcContract';

interface PiApi {
  // Session lifecycle (via main process IPC)
  createSession: (cwd: string) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  resumeSession: (
    sessionPath: string,
  ) => Promise<{ success: boolean; sessionId?: string; error?: string }>;
  destroySession: (sessionId: string) => Promise<{ success: boolean }>;
  touchSession: (sessionId: string) => Promise<{ success: boolean; error?: string }>;

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
  listProjectSessions: (cwds: string[]) => Promise<SessionListResult>;
  onProjectSessionsChunk: (callback: (chunk: ProjectSessionsChunk) => void) => () => void;

  // Commands (via control MessagePort, direct to utility)
  send: (sessionId: string, cmd: PiCommand) => Promise<unknown>;

  // Subscriptions (via data MessagePort)
  onPush: (sessionId: string, callback: (msg: PiPush) => void) => () => void;
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void) => () => void;

  // Process lifecycle
  onProcessExit: (callback: (data: { sessionId: string; code: number }) => void) => () => void;

  // Utilities
  getCwd: () => string;
  openExternal: (url: string) => void;
}

declare global {
  interface Window {
    electron: ElectronAPI;
    piApi: PiApi;
  }
}
