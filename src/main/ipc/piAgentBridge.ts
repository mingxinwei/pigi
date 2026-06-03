/**
 * Pi Agent Bridge - main process bridge for session lifecycle.
 *
 * Each session gets its own utility process. Main manages:
 * 1. Spawning process per session (with warm process optimization)
 * 2. Two-step handshake: create session → get sessionPath → distribute ports
 * 3. Process cleanup on destroy or crash
 *
 * After port handshake, main is NOT in the data path.
 */
import { ipcMain, MessageChannelMain } from 'electron';
import { getMainWindow } from '../windows/createMainWindow';
import { createSessionWorkerProcess } from '../processes/createPiAgentProcess';
import { PiAgentProcessPool } from './piAgentProcessPool';
import {
  PiChannel,
  type ListProjectSessionsCommand,
  type ReadSessionMessagesCommand,
  type RenameSessionCommand,
  type SessionWorkerResponse,
  type SessionListResult,
  type UtilityCommand,
  type UtilityResponse,
} from '../../shared/ipcContract';

let sessionWorkerProcess: Electron.UtilityProcess | null = null;
let sessionWorkerRequestId = 0;
const pendingRenameCallbacks = new Map<
  string,
  (result: { success: boolean; error?: string }) => void
>();
const pendingReadMessagesCallbacks = new Map<
  string,
  (result: {
    success: boolean;
    messages?: unknown[];
    compactionCount?: number;
    thinkingLevel?: string;
    model?: { provider: string; modelId: string } | null;
    error?: string;
  }) => void
>();

function sendToRenderer(channel: PiChannel, data: unknown): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

const processPool = new PiAgentProcessPool((sessionPath, code) => {
  sendToRenderer(PiChannel.ProcessExit, { sessionPath, code });
});

function startSessionWorker(): void {
  if (sessionWorkerProcess) {
    return;
  }

  const proc = createSessionWorkerProcess();
  sessionWorkerProcess = proc;

  proc.on('message', (message: SessionWorkerResponse) => {
    switch (message.type) {
      case 'project_sessions_chunk':
        sendToRenderer(PiChannel.ProjectSessionsChunk, {
          requestId: message.requestId,
          cwd: message.cwd,
          success: message.success,
          sessions: message.sessions,
          error: message.error,
        });
        break;
      case 'rename_session_result': {
        const callback = pendingRenameCallbacks.get(message.requestId);
        if (callback) {
          pendingRenameCallbacks.delete(message.requestId);
          callback({ success: message.success, error: message.error });
        }
        break;
      }
      case 'session_messages_result': {
        const callback = pendingReadMessagesCallbacks.get(message.requestId);
        if (callback) {
          pendingReadMessagesCallbacks.delete(message.requestId);
          callback({
            success: message.success,
            messages: message.messages,
            compactionCount: message.compactionCount,
            thinkingLevel: message.thinkingLevel,
            model: message.model,
            error: message.error,
          });
        }
        break;
      }
    }
  });

  proc.on('exit', () => {
    if (sessionWorkerProcess === proc) {
      sessionWorkerProcess = null;
      for (const [id, callback] of pendingRenameCallbacks) {
        callback({ success: false, error: 'session worker process exited' });
        pendingRenameCallbacks.delete(id);
      }
      for (const [id, callback] of pendingReadMessagesCallbacks) {
        callback({ success: false, error: 'session worker process exited' });
        pendingReadMessagesCallbacks.delete(id);
      }
    }
  });
}

function listProjectSessions(cwds: string[]): SessionListResult {
  startSessionWorker();
  if (!sessionWorkerProcess) {
    return { success: false, error: 'session worker process not available' };
  }

  const requestId = `session-list-${++sessionWorkerRequestId}`;
  const command: ListProjectSessionsCommand = {
    type: 'list_project_sessions',
    requestId,
    cwds: [...new Set(cwds)],
  };
  sessionWorkerProcess.postMessage(command);
  // Prewarm services in the warm process for these cwds
  processPool.ensureWarmProcess(cwds);
  return { success: true, requestId };
}

/**
 * Spawn a utility process (or claim the warm one), send lifecycle command,
 * wait for sessionPath, then establish dedicated control/data MessagePorts.
 */
async function spawnSessionProcess(
  command: UtilityCommand,
): Promise<{ success: boolean; sessionPath?: string; error?: string }> {
  return new Promise((resolve) => {
    // Try to claim the warm process first; fall back to spawning fresh.
    const proc = processPool.claimWarmProcess() ?? processPool.createFreshProcess();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'session creation timed out' });
      }
    }, 30000);

    const messageHandler = (message: UtilityResponse): void => {
      // Always handle busy state changes
      if (message.type === 'session_busy_changed') {
        processPool.updateBusyState(proc, message.isBusy);
        return;
      }

      // Ignore warm_ready during session setup (it's from the warm phase)
      if (message.type === 'warm_ready') {
        return;
      }

      if (resolved) return;

      switch (message.type) {
        case 'session_created': {
          resolved = true;
          clearTimeout(timeout);

          const sessionPath = message.sessionPath;
          if (!sessionPath) {
            proc.kill();
            resolve({ success: false, error: 'session created without a path' });
            break;
          }

          processPool.registerSessionProcess(sessionPath, proc);

          // Establish control/data MessagePorts
          const controlChannel = new MessageChannelMain();
          const dataChannel = new MessageChannelMain();
          const attachCommand: UtilityCommand = { type: 'attach_ports' };
          proc.postMessage(attachCommand, [controlChannel.port1, dataChannel.port1]);

          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.postMessage(PiChannel.SessionPort, { sessionPath }, [
              controlChannel.port2,
              dataChannel.port2,
            ]);
          }

          resolve({ success: true, sessionPath });
          break;
        }
        case 'session_error': {
          resolved = true;
          clearTimeout(timeout);
          proc.kill();
          resolve({ success: false, error: message.error });
          break;
        }
      }
    };

    proc.on('message', messageHandler);

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ success: false, error: `process exited with code ${code} during setup` });
      }
    });

    // Send the lifecycle command
    proc.postMessage(command);
  });
}

export function stopAllProcesses(): void {
  processPool.stopAllProcesses();
  sessionWorkerProcess?.kill();
  sessionWorkerProcess = null;
}

export function registerIpcHandlers(): void {
  startSessionWorker();
  // Spawn the initial warm process
  processPool.ensureWarmProcess();

  ipcMain.handle(PiChannel.CreateSession, async (_e, cwd: string) => {
    if (!cwd || typeof cwd !== 'string') {
      return { success: false, error: 'cwd must be a non-empty string' };
    }
    return spawnSessionProcess({ type: 'create_session', cwd });
  });

  ipcMain.handle(PiChannel.ResumeSession, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string' || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionPath must be a non-empty string' };
    }
    // Reuse existing process if this session is already open
    const existing = processPool.findBySessionPath(sessionPath);
    if (existing) {
      processPool.touchSessionProcess(sessionPath);
      return { success: true, sessionPath };
    }
    return spawnSessionProcess({ type: 'resume_session', sessionPath });
  });

  ipcMain.handle(PiChannel.DestroySession, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string') {
      return { success: false, error: 'sessionPath must be a non-empty string' };
    }
    return { success: processPool.destroySessionProcess(sessionPath) };
  });

  ipcMain.handle(PiChannel.TouchSession, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string') {
      return { success: false, error: 'sessionPath must be a non-empty string' };
    }
    return { success: processPool.touchSessionProcess(sessionPath) };
  });

  ipcMain.handle(PiChannel.GetWarmSessionOptions, async () => {
    return processPool.getWarmSessionOptions();
  });

  ipcMain.handle(PiChannel.ListProjectSessions, async (_e, cwds: string[]) => {
    if (!Array.isArray(cwds) || cwds.some((cwd) => !cwd || typeof cwd !== 'string')) {
      return { success: false, error: 'cwds must be an array of non-empty strings' };
    }
    return listProjectSessions(cwds);
  });

  ipcMain.handle(
    PiChannel.RenamePersistedSession,
    async (_e, sessionPath: string, name: string) => {
      if (!sessionPath || typeof sessionPath !== 'string') {
        return { success: false, error: 'sessionPath must be a non-empty string' };
      }
      if (!name || typeof name !== 'string') {
        return { success: false, error: 'name must be a non-empty string' };
      }
      startSessionWorker();
      if (!sessionWorkerProcess) {
        return { success: false, error: 'session worker process not available' };
      }
      const requestId = `rename-${++sessionWorkerRequestId}`;
      const proc = sessionWorkerProcess;
      return new Promise<{ success: boolean; error?: string }>((resolve) => {
        const timeout = setTimeout(() => {
          pendingRenameCallbacks.delete(requestId);
          resolve({ success: false, error: 'rename timed out' });
        }, 10000);
        pendingRenameCallbacks.set(requestId, (result) => {
          clearTimeout(timeout);
          resolve(result);
        });
        const renameCmd: RenameSessionCommand = {
          type: 'rename_session',
          requestId,
          sessionPath,
          name,
        };
        proc.postMessage(renameCmd);
      });
    },
  );

  ipcMain.handle(PiChannel.ReadSessionMessages, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string' || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionPath must be a non-empty string' };
    }
    startSessionWorker();
    if (!sessionWorkerProcess) {
      return { success: false, error: 'session worker process not available' };
    }
    const requestId = `read-messages-${++sessionWorkerRequestId}`;
    const proc = sessionWorkerProcess;
    return new Promise<{
      success: boolean;
      messages?: unknown[];
      compactionCount?: number;
      thinkingLevel?: string;
      model?: { provider: string; modelId: string } | null;
      error?: string;
    }>((resolve) => {
      const timeout = setTimeout(() => {
        pendingReadMessagesCallbacks.delete(requestId);
        resolve({ success: false, error: 'read session messages timed out' });
      }, 10000);
      pendingReadMessagesCallbacks.set(requestId, (result) => {
        clearTimeout(timeout);
        resolve(result);
      });
      const readCmd: ReadSessionMessagesCommand = {
        type: 'read_session_messages',
        requestId,
        sessionPath,
      };
      proc.postMessage(readCmd);
    });
  });
}
