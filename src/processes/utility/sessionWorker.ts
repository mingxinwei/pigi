import { type SessionInfo, SessionManager } from '@mariozechner/pi-coding-agent';
import type {
  PiSessionInfo,
  SessionWorkerCommand,
  SessionWorkerResponse,
} from '../../shared/ipcContract';

function sendToMain(response: SessionWorkerResponse): void {
  process.parentPort?.postMessage(response);
}

function serializeSessionInfo(session: SessionInfo): PiSessionInfo {
  return {
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    allMessagesText: session.allMessagesText,
  };
}

async function listProjectSessions(requestId: string, cwd: string): Promise<void> {
  try {
    const sessions = await SessionManager.list(cwd);
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: true,
      sessions: sessions.map(serializeSessionInfo),
    });
  } catch (error) {
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

process.parentPort?.on('message', async (messageEvent) => {
  // parentPort only receives SessionWorkerCommand from main — safe narrowing
  const command: SessionWorkerCommand = messageEvent.data;

  switch (command.type) {
    case 'list_project_sessions': {
      await Promise.all(command.cwds.map((cwd) => listProjectSessions(command.requestId, cwd)));
      break;
    }
    case 'rename_session': {
      const trimmedName = command.name?.trim();
      if (!trimmedName) {
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: false,
          error: 'name must be a non-empty string',
        });
        break;
      }
      try {
        const sessionManager = SessionManager.open(command.sessionPath);
        sessionManager.appendSessionInfo(trimmedName);
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: true,
        });
      } catch (error) {
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
  }
});
