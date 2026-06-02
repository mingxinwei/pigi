/**
 * Pi Agent Bridge - main process bridge for session lifecycle.
 *
 * Each session gets its own utility process. Main manages:
 * 1. Spawning process per session
 * 2. Two-step handshake: create session → get real sessionId → distribute ports
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

const processPool = new PiAgentProcessPool((sessionId, code) => {
  sendToRenderer(PiChannel.ProcessExit, { sessionId, code });
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
      // Drain pending rename callbacks on crash
      for (const [id, callback] of pendingRenameCallbacks) {
        callback({ success: false, error: 'session worker process exited' });
        pendingRenameCallbacks.delete(id);
      }
      // Drain pending read messages callbacks on crash
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
  processPool.ensureWarmSessionProcesses(cwds);
  return { success: true, requestId };
}

/**
 * Spawn a utility process, send lifecycle command, wait for real sessionId,
 * then establish dedicated control/data MessagePorts between renderer and utility.
 */
async function spawnSessionProcess(
  command: UtilityCommand,
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = processPool.claimSessionProcess();
    let resolved = false;

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true;
        proc.kill();
        resolve({ success: false, error: 'session creation timed out' });
      }
    }, 30000);

    proc.on('message', (message: UtilityResponse) => {
      if (message.type === 'session_busy_changed') {
        processPool.updateBusyState(proc, message.isBusy);
        return;
      }

      if (resolved) return;

      switch (message.type) {
        case 'session_created': {
          resolved = true;
          clearTimeout(timeout);

          const sessionId = message.sessionId;
          processPool.registerSessionProcess(sessionId, proc, message.sessionPath);

          // Establish separate ports so high-volume stream output cannot delay controls.
          const controlChannel = new MessageChannelMain();
          const dataChannel = new MessageChannelMain();
          const attachCommand: UtilityCommand = { type: 'attach_ports' };
          proc.postMessage(attachCommand, [controlChannel.port1, dataChannel.port1]);

          const win = getMainWindow();
          if (win && !win.isDestroyed()) {
            win.webContents.postMessage(PiChannel.SessionPort, { sessionId }, [
              controlChannel.port2,
              dataChannel.port2,
            ]);
          }

          resolve({ success: true, sessionId });
          processPool.refillAfterSetup();
          break;
        }
        case 'session_error': {
          resolved = true;
          clearTimeout(timeout);
          proc.kill();
          processPool.ensureWarmSessionProcesses();
          resolve({ success: false, error: message.error });
          break;
        }
      }
    });

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true;
        clearTimeout(timeout);
        resolve({ success: false, error: `process exited with code ${code} during setup` });
      }
    });

    // Send the lifecycle command to start session creation
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
  processPool.ensureWarmSessionProcesses();

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
    const existing = processPool.findSessionByPath(sessionPath);
    if (existing) {
      processPool.touchSessionProcess(existing.sessionId);
      return { success: true, sessionId: existing.sessionId };
    }
    return spawnSessionProcess({ type: 'resume_session', sessionPath });
  });

  ipcMain.handle(PiChannel.DestroySession, async (_e, sessionId: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }
    return { success: processPool.destroySessionProcess(sessionId) };
  });

  ipcMain.handle(PiChannel.TouchSession, async (_e, sessionId: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' };
    }
    return { success: processPool.touchSessionProcess(sessionId) };
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
