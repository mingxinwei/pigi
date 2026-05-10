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
  type ControlPortMessage,
  type DataPortMessage,
  type GitBranchResult,
  type PiCommand,
  type PiPush,
  type PiRequest,
  type PiResult,
  type ProjectSessionsChunk,
  type ProjectStateResult,
  type SessionListResult,
  type StreamBatch,
} from '../shared/ipcContract';

// =============================================================================
// Per-session port management
// =============================================================================

interface PendingCommand {
  resolve: (v: unknown) => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface PendingPortWaiter {
  resolve: () => void;
  reject: (e: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

interface SessionPort {
  controlPort: MessagePort;
  dataPort: MessagePort;
  pending: Map<string, PendingCommand>;
  pushHandlers: Set<(msg: PiPush) => void>;
  streamHandlers: Set<(batch: StreamBatch) => void>;
  requestId: number;
}

const sessionPorts = new Map<string, SessionPort>();
const SESSION_PORT_CLOSED_ERROR = 'session process exited';
const PORT_READY_TIMEOUT_MS = 5000;

/** Handlers registered before port arrives */
const pendingPushHandlers = new Map<string, Set<(msg: PiPush) => void>>();
const pendingStreamHandlers = new Map<string, Set<(batch: StreamBatch) => void>>();
const pendingPortWaiters = new Map<string, Set<PendingPortWaiter>>();

function cleanupPendingPortWaiters(sessionId: string, error: Error): void {
  const waiters = pendingPortWaiters.get(sessionId);
  if (!waiters) {
    return;
  }

  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutId);
    waiter.reject(error);
  }
  pendingPortWaiters.delete(sessionId);
}

function waitForPort(sessionId: string): Promise<void> {
  if (sessionPorts.has(sessionId)) {
    return Promise.resolve();
  }

  return new Promise((resolve, reject) => {
    const timeoutId = setTimeout(() => {
      const waiters = pendingPortWaiters.get(sessionId);
      if (waiters) {
        waiters.delete(waiter);
        if (waiters.size === 0) {
          pendingPortWaiters.delete(sessionId);
        }
      }
      reject(new Error(`port for session ${sessionId} did not arrive`));
    }, PORT_READY_TIMEOUT_MS);

    const waiter: PendingPortWaiter = { resolve, reject, timeoutId };
    const waiters = pendingPortWaiters.get(sessionId) ?? new Set<PendingPortWaiter>();
    waiters.add(waiter);
    pendingPortWaiters.set(sessionId, waiters);
  });
}

function resolvePendingPortWaiters(sessionId: string): void {
  const waiters = pendingPortWaiters.get(sessionId);
  if (!waiters) {
    return;
  }

  for (const waiter of waiters) {
    clearTimeout(waiter.timeoutId);
    waiter.resolve();
  }
  pendingPortWaiters.delete(sessionId);
}

function cleanupSessionPort(sessionId: string, clearPendingHandlers = true): void {
  const sp = sessionPorts.get(sessionId);
  if (sp) {
    for (const pending of sp.pending.values()) {
      clearTimeout(pending.timeoutId);
      pending.reject(new Error(SESSION_PORT_CLOSED_ERROR));
    }
    sp.pending.clear();
    sp.pushHandlers.clear();
    sp.streamHandlers.clear();
    sp.controlPort.close();
    sp.dataPort.close();
    sessionPorts.delete(sessionId);
  }

  if (clearPendingHandlers) {
    pendingPushHandlers.delete(sessionId);
    pendingStreamHandlers.delete(sessionId);
    cleanupPendingPortWaiters(sessionId, new Error(SESSION_PORT_CLOSED_ERROR));
  }
}

function mergeStreamBatches(batches: StreamBatch[]): StreamBatch {
  if (batches.length === 1) return batches[0];
  const merged: StreamBatch = { type: 'stream_batch' };
  for (const batch of batches) {
    if (batch.text) {
      if (!merged.text) merged.text = {};
      for (const [id, delta] of Object.entries(batch.text)) {
        merged.text[id] = (merged.text[id] || '') + delta;
      }
    }
    if (batch.thinking) {
      if (!merged.thinking) merged.thinking = {};
      for (const [id, delta] of Object.entries(batch.thinking)) {
        merged.thinking[id] = (merged.thinking[id] || '') + delta;
      }
    }
    if (batch.toolOutput) {
      if (!merged.toolOutput) merged.toolOutput = {};
      for (const [id, output] of Object.entries(batch.toolOutput)) {
        merged.toolOutput[id] = output;
      }
    }
    if (batch.toolArgs) {
      if (!merged.toolArgs) merged.toolArgs = {};
      for (const [id, entry] of Object.entries(batch.toolArgs)) {
        merged.toolArgs[id] = entry;
      }
    }
  }
  return merged;
}

function setupPort(sessionId: string, controlPort: MessagePort, dataPort: MessagePort): void {
  cleanupSessionPort(sessionId, false);

  const sp: SessionPort = {
    controlPort,
    dataPort,
    pending: new Map(),
    pushHandlers: new Set(),
    streamHandlers: new Set(),
    requestId: 0,
  };

  controlPort.onmessage = (event) => {
    const data = event.data as ControlPortMessage;

    if ('id' in data && 'result' in data) {
      const res = data as PiResult;
      const pending = sp.pending.get(res.id);
      if (pending) {
        clearTimeout(pending.timeoutId);
        sp.pending.delete(res.id);
        pending.resolve(res.result);
      }
    }
  };

  // Coalesce stream batches: buffer incoming batches and deliver at most once per
  // animation frame. This keeps the main thread from being saturated by back-to-back
  // React renders, leaving gaps for keyboard events (e.g. Escape to abort) to fire.
  let pendingStreamBatches: StreamBatch[] = [];
  let streamRafScheduled = false;

  // Push event queue: rate-limit tool_execution_end to the next animation frame so the
  // browser paints the 'running' state before completion. All other events are immediate.
  const THROTTLED_PUSH_EVENTS = new Set(['tool_execution_end']);
  const pushQueue: PiPush[] = [];
  let pushRafScheduled = false;

  function deliverPush(msg: PiPush): void {
    for (const handler of sp.pushHandlers) {
      handler(msg);
    }
  }

  function schedulePushDrain(): void {
    if (pushRafScheduled || pushQueue.length === 0) return;
    pushRafScheduled = true;
    requestAnimationFrame(() => {
      pushRafScheduled = false;
      if (pushQueue.length === 0) return;
      const msg = pushQueue.shift()!;
      deliverPush(msg);
      schedulePushDrain();
    });
  }

  function enqueuePush(msg: PiPush): void {
    const eventType =
      'event' in msg && msg.event != null ? (msg.event as { type?: string }).type : undefined;
    if (eventType && THROTTLED_PUSH_EVENTS.has(eventType)) {
      // Stamp receive time before RAF delay so timing calculations stay accurate
      ((msg as { event?: unknown }).event as { _receivedAt?: number })._receivedAt = Date.now();
      pushQueue.push(msg);
      schedulePushDrain();
    } else {
      deliverPush(msg);
    }
  }

  dataPort.onmessage = (event) => {
    const data = event.data as DataPortMessage;

    if ('type' in data && data.type === 'stream_batch') {
      pendingStreamBatches.push(data as StreamBatch);
      if (!streamRafScheduled) {
        streamRafScheduled = true;
        requestAnimationFrame(() => {
          streamRafScheduled = false;
          const batches = pendingStreamBatches;
          pendingStreamBatches = [];
          const merged = mergeStreamBatches(batches);
          for (const handler of sp.streamHandlers) {
            handler(merged);
          }
        });
      }
      return;
    }

    if ('type' in data) {
      enqueuePush(data as PiPush);
    }
  };

  sessionPorts.set(sessionId, sp);

  // Drain pending handlers registered before port arrived before starting delivery.
  const pendingPush = pendingPushHandlers.get(sessionId);
  if (pendingPush) {
    for (const cb of pendingPush) sp.pushHandlers.add(cb);
    pendingPushHandlers.delete(sessionId);
  }
  const pendingStream = pendingStreamHandlers.get(sessionId);
  if (pendingStream) {
    for (const cb of pendingStream) sp.streamHandlers.add(cb);
    pendingStreamHandlers.delete(sessionId);
  }

  controlPort.start();
  dataPort.start();
  resolvePendingPortWaiters(sessionId);
}

// Receive session ports from main. ports[0] is low-volume control, ports[1] is data stream.
ipcRenderer.on(PiChannel.SessionPort, (event, data: { sessionId: string }) => {
  const [controlPort, dataPort] = event.ports;
  if (!controlPort || !dataPort || !data?.sessionId) return;
  setupPort(data.sessionId, controlPort, dataPort);
});

// =============================================================================
// API
// =============================================================================

const piApi = {
  /** Create a new session. Resolves after the renderer-side ports are registered. */
  createSession: async (
    cwd: string,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    const result = (await ipcRenderer.invoke(PiChannel.CreateSession, cwd)) as {
      success: boolean;
      sessionId?: string;
      error?: string;
    };
    if (result.success && result.sessionId) {
      await waitForPort(result.sessionId);
    }
    return result;
  },

  /** Resume an existing session by file path. Resolves after renderer-side ports are registered. */
  resumeSession: async (
    sessionPath: string,
  ): Promise<{ success: boolean; sessionId?: string; error?: string }> => {
    const result = (await ipcRenderer.invoke(PiChannel.ResumeSession, sessionPath)) as {
      success: boolean;
      sessionId?: string;
      error?: string;
    };
    if (result.success && result.sessionId) {
      await waitForPort(result.sessionId);
    }
    return result;
  },

  /** Destroy a session. */
  destroySession: (sessionId: string): Promise<{ success: boolean }> =>
    ipcRenderer.invoke(PiChannel.DestroySession, sessionId),

  /** Mark a session as recently selected. */
  touchSession: (sessionId: string): Promise<{ success: boolean; error?: string }> =>
    ipcRenderer.invoke(PiChannel.TouchSession, sessionId),

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

  /** Send a command to a session (via control MessagePort). Returns result. */
  send: (sessionId: string, cmd: PiCommand): Promise<unknown> => {
    const sp = sessionPorts.get(sessionId);
    if (!sp)
      return Promise.reject(
        new Error(`no port for session ${sessionId} (port may not have arrived yet)`),
      );
    const id = `req-${++sp.requestId}`;
    return new Promise((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        if (sp.pending.has(id)) {
          sp.pending.delete(id);
          reject(new Error('command timed out'));
        }
      }, 60000);
      sp.pending.set(id, { resolve, reject, timeoutId });
      const req: PiRequest = { id, cmd };
      sp.controlPort.postMessage(req);
    });
  },

  /** Subscribe to push events for a session (session_ready, event, error). */
  onPush: (sessionId: string, callback: (msg: PiPush) => void): (() => void) => {
    const sp = sessionPorts.get(sessionId);
    if (sp) {
      sp.pushHandlers.add(callback);
    } else {
      // Port not yet arrived -- queue
      if (!pendingPushHandlers.has(sessionId)) {
        pendingPushHandlers.set(sessionId, new Set());
      }
      pendingPushHandlers.get(sessionId)!.add(callback);
    }
    return () => {
      const s = sessionPorts.get(sessionId);
      if (s) s.pushHandlers.delete(callback);
      pendingPushHandlers.get(sessionId)?.delete(callback);
    };
  },

  /** Subscribe to stream batches for a session. */
  onStreamBatch: (sessionId: string, callback: (batch: StreamBatch) => void): (() => void) => {
    const sp = sessionPorts.get(sessionId);
    if (sp) {
      sp.streamHandlers.add(callback);
    } else {
      if (!pendingStreamHandlers.has(sessionId)) {
        pendingStreamHandlers.set(sessionId, new Set());
      }
      pendingStreamHandlers.get(sessionId)!.add(callback);
    }
    return () => {
      const s = sessionPorts.get(sessionId);
      if (s) s.streamHandlers.delete(callback);
      pendingStreamHandlers.get(sessionId)?.delete(callback);
    };
  },

  /** Listen for process exit (main → renderer). */
  onProcessExit: (callback: (data: { sessionId: string; code: number }) => void) => {
    const handler = (
      _: Electron.IpcRendererEvent,
      data: { sessionId: string; code: number },
    ): void => {
      cleanupSessionPort(data.sessionId);
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
};

contextBridge.exposeInMainWorld('electron', electronAPI);
contextBridge.exposeInMainWorld('piApi', piApi);
