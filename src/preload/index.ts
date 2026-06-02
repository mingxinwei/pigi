/**
 * Preload script - exposes piApi to renderer via contextBridge.
 *
 * After session creation, communication goes directly over control/data MessagePorts.
 * Main process is only involved for lifecycle (create/resume/destroy session).
 */
import { electronAPI } from '@electron-toolkit/preload';
import { contextBridge, ipcRenderer } from 'electron';
import {
  PiChannel,
  isPiPush,
  isPiResult,
  isStreamBatch,
  type ControlPortMessage,
  type DataPortMessage,
  type GitBranchResult,
  type PiCommand,
  type PiPush,
  type PiRequest,
  type ProjectSessionsChunk,
  type ProjectStateResult,
  type SessionListResult,
  type ShortcutBinding,
  type ShortcutDefinition,
  type StreamBatch,
} from '../shared/ipcContract';

// =============================================================================
// Per-session port management (keyed by sessionPath)
// =============================================================================

interface PendingCommand {
  resolve: (value: unknown) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingPortWaiter {
  resolve: () => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface SessionPort {
  controlPort: MessagePort;
  dataPort: MessagePort;
  pending: Map<string, PendingCommand>;
  pushHandlers: Set<(message: PiPush) => void>;
  streamHandlers: Set<(batch: StreamBatch) => void>;
  requestId: number;
}

const sessionPorts = new Map<string, SessionPort>();
const SESSION_PORT_CLOSED_ERROR = 'session process exited';
const PORT_READY_TIMEOUT_MS = 5000;

/** Handlers registered before port arrives */
const pendingPushHandlers = new Map<string, Set<(message: PiPush) => void>>();
const pendingStreamHandlers = new Map<string, Set<(batch: StreamBatch) => void>>();
const pendingPortWaiters = new Map<string, Set<PendingPortWaiter>>();

function cleanupPendingPortWaiters(sessionPath: string, error: Error): void {
  const waiters = pendingPortWaiters.get(sessionPath);
  if (!waiters) {
    return;
  }

  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutId);
    waiter.reject(error);
  }
  pendingPortWaiters.delete(sessionPath);
}

function waitForPort(sessionPath: string): Promise<void> {
  if (sessionPorts.has(sessionPath)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const waiters = pendingPortWaiters.get(sessionPath);
      if (waiters) {
        waiters.delete(waiter);
        if (waiters.size === 0) {
          pendingPortWaiters.delete(sessionPath);
        }
      }
      reject(new Error(`port for session ${sessionPath} did not arrive`));
    }, PORT_READY_TIMEOUT_MS);

    const waiter: PendingPortWaiter = { resolve, reject, timeoutId };
    const waiters = pendingPortWaiters.get(sessionPath) ?? new Set<PendingPortWaiter>();
    waiters.add(waiter);
    pendingPortWaiters.set(sessionPath, waiters);
  });
}

function resolvePendingPortWaiters(sessionPath: string): void {
  const waiters = pendingPortWaiters.get(sessionPath);
  if (!waiters) {
    return;
  }

  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutId);
    waiter.resolve();
  }
  pendingPortWaiters.delete(sessionPath);
}

function cleanupSessionPort(sessionPath: string, clearPendingHandlers = true): void {
  const session = sessionPorts.get(sessionPath);
  if (session) {
    for (const pendingCommand of session.pending.values()) {
      clearTimeout(pendingCommand.timeoutId);
      pendingCommand.reject(new Error(SESSION_PORT_CLOSED_ERROR));
    }
    session.pending.clear();
    session.pushHandlers.clear();
    session.streamHandlers.clear();
    session.controlPort.close();
    session.dataPort.close();
    sessionPorts.delete(sessionPath);
  }

  if (clearPendingHandlers) {
    pendingPushHandlers.delete(sessionPath);
    pendingStreamHandlers.delete(sessionPath);
    cleanupPendingPortWaiters(sessionPath, new Error(SESSION_PORT_CLOSED_ERROR));
  }
}

function setupPort(sessionPath: string, controlPort: MessagePort, dataPort: MessagePort): void {
  cleanupSessionPort(sessionPath, false);

  const session: SessionPort = {
    controlPort,
    dataPort,
    pending: new Map(),
    pushHandlers: new Set(),
    streamHandlers: new Set(),
    requestId: 0,
  };

  controlPort.onmessage = (event) => {
    const data: ControlPortMessage = event.data;

    if (isPiResult(data)) {
      const pendingCommand = session.pending.get(data.id);
      if (pendingCommand) {
        clearTimeout(pendingCommand.timeoutId);
        session.pending.delete(data.id);
        pendingCommand.resolve(data.result);
      }
    }
  };

  function deliverPush(message: PiPush): void {
    for (const handler of session.pushHandlers) {
      handler(message);
    }
  }

  dataPort.onmessage = (event) => {
    const data: DataPortMessage = event.data;

    if (isStreamBatch(data)) {
      for (const handler of session.streamHandlers) {
        handler(data);
      }
      return;
    }

    if (isPiPush(data)) {
      deliverPush(data);
    }
  };

  sessionPorts.set(sessionPath, session);

  // Drain pending handlers registered before port arrived.
  const queuedPushHandlers = pendingPushHandlers.get(sessionPath);
  if (queuedPushHandlers) {
    for (const callback of queuedPushHandlers) session.pushHandlers.add(callback);
    pendingPushHandlers.delete(sessionPath);
  }
  const queuedStreamHandlers = pendingStreamHandlers.get(sessionPath);
  if (queuedStreamHandlers) {
    for (const callback of queuedStreamHandlers) session.streamHandlers.add(callback);
    pendingStreamHandlers.delete(sessionPath);
  }

  controlPort.start();
  dataPort.start();
  resolvePendingPortWaiters(sessionPath);
}

// Receive session ports from main. ports[0] is low-volume control, ports[1] is data stream.
ipcRenderer.on(PiChannel.SessionPort, (event, data: { sessionPath: string }) => {
  const [controlPort, dataPort] = event.ports;
  if (!controlPort || !dataPort || !data?.sessionPath) return;
  setupPort(data.sessionPath, controlPort, dataPort);
});

// =============================================================================
// API
// =============================================================================

const piApi = {
  /** Create a new session. Resolves after the renderer-side ports are registered. */
  createSession: async (
    cwd: string,
  ): Promise<{ success: boolean; sessionPath?: string; error?: string }> => {
    const result: { success: boolean; sessionPath?: string; error?: string } =
      await ipcRenderer.invoke(PiChannel.CreateSession, cwd);
    if (result.success && result.sessionPath) {
      await waitForPort(result.sessionPath);
    }
    return result;
  },

  /** Resume an existing session by file path. Resolves after renderer-side ports are registered. */
  resumeSession: async (
    sessionPath: string,
  ): Promise<{ success: boolean; sessionPath?: string; error?: string }> => {
    const result: { success: boolean; sessionPath?: string; error?: string } =
      await ipcRenderer.invoke(PiChannel.ResumeSession, sessionPath);
    if (result.success && result.sessionPath) {
      await waitForPort(result.sessionPath);
    }
    return result;
  },

  /** Destroy a session by its file path. */
  destroySession: (sessionPath: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PiChannel.DestroySession, sessionPath),

  /** Mark a session as recently selected. */
  touchSession: (sessionPath: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PiChannel.TouchSession, sessionPath),

  /** Get persisted project directory state from main process. */
  getProjects: (): Promise<ProjectStateResult> => ipcRenderer.invoke(PiChannel.GetProjects),

  /** Get current git branch for a project directory. */
  getGitBranch: (cwd: string): Promise<GitBranchResult> =>
    ipcRenderer.invoke(PiChannel.GetGitBranch, cwd),

  /** Set active project directory from recent projects. */
  setActiveProject: (path: string): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.SetActiveProject, path),

  /** Open native directory picker and persist selected project directory. */
  openProjectDirectory: (): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.OpenProjectDirectory),

  /** Remove a project from recent projects. */
  removeProject: (path: string): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.RemoveProject, path),

  /** Reorder recent projects. */
  reorderProjects: (paths: string[]): Promise<ProjectStateResult> =>
    ipcRenderer.invoke(PiChannel.ReorderProjects, paths),

  /** Rename a persisted (non-running) session by appending a session_info entry. */
  renamePersistedSession: (
    sessionPath: string,
    name: string,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PiChannel.RenamePersistedSession, sessionPath, name),

  /** Read messages from a session file without spawning a utility process. */
  readSessionMessages: (
    sessionPath: string,
  ): Promise<{
    success: boolean;
    messages?: unknown[];
    compactionCount?: number;
    thinkingLevel?: string;
    model?: { provider: string; modelId: string } | null;
    error?: string;
  }> => ipcRenderer.invoke(PiChannel.ReadSessionMessages, sessionPath),

  /** List persisted pi sessions for project directories. */
  listProjectSessions: (cwds: string[]): Promise<SessionListResult> =>
    ipcRenderer.invoke(PiChannel.ListProjectSessions, cwds),

  /** Subscribe to persisted pi session chunks by project cwd. */
  onProjectSessionsChunk: (callback: (chunk: ProjectSessionsChunk) => void): (() => void) => {
    const handler = (_: Electron.IpcRendererEvent, chunk: ProjectSessionsChunk): void => {
      callback(chunk);
    };
    ipcRenderer.on(PiChannel.ProjectSessionsChunk, handler);
    return () => ipcRenderer.removeListener(PiChannel.ProjectSessionsChunk, handler);
  },

  /** Send a command to a session (via control MessagePort). */
  send: (sessionPath: string, command: PiCommand): Promise<unknown> => {
    const session = sessionPorts.get(sessionPath);
    if (!session)
      return Promise.reject(
        new Error(`no port for session ${sessionPath} (port may not have arrived yet)`),
      );
    const requestId = `req-${++session.requestId}`;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (session.pending.has(requestId)) {
          session.pending.delete(requestId);
          reject(new Error('command timed out'));
        }
      }, 60000);
      session.pending.set(requestId, { resolve, reject, timeoutId });
      const request: PiRequest = { id: requestId, cmd: command };
      session.controlPort.postMessage(request);
    });
  },

  /** Subscribe to push events for a session. */
  onPush: (sessionPath: string, callback: (message: PiPush) => void): (() => void) => {
    const session = sessionPorts.get(sessionPath);
    if (session) {
      session.pushHandlers.add(callback);
    } else {
      if (!pendingPushHandlers.has(sessionPath)) {
        pendingPushHandlers.set(sessionPath, new Set());
      }
      pendingPushHandlers.get(sessionPath)!.add(callback);
    }
    return () => {
      const current = sessionPorts.get(sessionPath);
      if (current) current.pushHandlers.delete(callback);
      pendingPushHandlers.get(sessionPath)?.delete(callback);
    };
  },

  /** Subscribe to stream batches for a session. */
  onStreamBatch: (sessionPath: string, callback: (batch: StreamBatch) => void): (() => void) => {
    const session = sessionPorts.get(sessionPath);
    if (session) {
      session.streamHandlers.add(callback);
    } else {
      if (!pendingStreamHandlers.has(sessionPath)) {
        pendingStreamHandlers.set(sessionPath, new Set());
      }
      pendingStreamHandlers.get(sessionPath)!.add(callback);
    }
    return () => {
      const current = sessionPorts.get(sessionPath);
      if (current) current.streamHandlers.delete(callback);
      pendingStreamHandlers.get(sessionPath)?.delete(callback);
    };
  },

  /** Listen for process exit (main → renderer). */
  onProcessExit: (callback: (data: { sessionPath: string; code: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { sessionPath: string; code: number },
    ): void => {
      cleanupSessionPort(data.sessionPath);
      callback(data);
    };
    ipcRenderer.on(PiChannel.ProcessExit, handler);
    return () => ipcRenderer.removeListener(PiChannel.ProcessExit, handler);
  },

  /** Get the app's working directory (for session creation). */
  getCwd: (): string => process.cwd(),

  /** Open a URL in the system browser. */
  openExternal: (url: string): void => {
    ipcRenderer.send(PiChannel.OpenExternal, url);
  },

  /** Get all keyboard shortcut definitions with current bindings. */
  getShortcuts: (): Promise<ShortcutDefinition[]> => ipcRenderer.invoke(PiChannel.GetShortcuts),

  /** Update a keyboard shortcut binding. */
  setShortcut: (
    id: string,
    binding: ShortcutBinding,
  ): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PiChannel.SetShortcut, id, binding),

  /** Get the system accent color as a hex string (e.g. '#007aff'). Returns null on unsupported platforms. */
  getAccentColor: (): Promise<string | null> => ipcRenderer.invoke(PiChannel.GetAccentColor),
};

contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('piApi', piApi);
