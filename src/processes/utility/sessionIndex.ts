import { type SessionInfo, SessionManager } from '@mariozechner/pi-coding-agent'
import type {
  PiSessionInfo,
  SessionIndexCommand,
  SessionIndexResponse,
} from '../../shared/ipcContract'

function sendToMain(msg: SessionIndexResponse): void {
  process.parentPort?.postMessage(msg)
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
  }
}

async function listProjectSessions(requestId: string, cwd: string): Promise<void> {
  try {
    const sessions = await SessionManager.list(cwd)
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: true,
      sessions: sessions.map(serializeSessionInfo),
    })
  } catch (err) {
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: false,
      error: err instanceof Error ? err.message : String(err),
    })
  }
}

process.parentPort?.on('message', async (messageEvent) => {
  const cmd = messageEvent.data as SessionIndexCommand

  switch (cmd.type) {
    case 'list_project_sessions': {
      const uniqueCwds = [...new Set(cmd.cwds)]
      await Promise.all(uniqueCwds.map((cwd) => listProjectSessions(cmd.requestId, cwd)))
      break
    }
  }
})
