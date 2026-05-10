import { type SessionInfo, SessionManager } from '@mariozechner/pi-coding-agent';
import type {
  PiSessionInfo,
  SessionWorkerCommand,
  SessionWorkerResponse,
} from '../../shared/ipcContract';

function sendToMain(msg: SessionWorkerResponse): void {
  process.parentPort?.postMessage(msg);
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
  } catch (err) {
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

process.parentPort?.on('message', async (messageEvent) => {
  const cmd = messageEvent.data as SessionWorkerCommand;

  switch (cmd.type) {
    case 'list_project_sessions': {
      await Promise.all(cmd.cwds.map((cwd) => listProjectSessions(cmd.requestId, cwd)));
      break;
    }
    case 'rename_session': {
      const trimmedName = cmd.name?.trim();
      if (!trimmedName) {
        sendToMain({
          type: 'rename_session_result',
          requestId: cmd.requestId,
          success: false,
          error: 'name must be a non-empty string',
        });
        break;
      }
      try {
        const sm = SessionManager.open(cmd.sessionPath);
        sm.appendSessionInfo(trimmedName);
        sendToMain({ type: 'rename_session_result', requestId: cmd.requestId, success: true });
      } catch (err) {
        sendToMain({
          type: 'rename_session_result',
          requestId: cmd.requestId,
          success: false,
          error: err instanceof Error ? err.message : String(err),
        });
      }
      break;
    }
  }
});
