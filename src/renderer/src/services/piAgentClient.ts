/**
 * Pi agent client - renderer-side interface for multi-session communication.
 *
 * Each session has:
 * - A sessionId for routing commands/events
 * - Its own MessagePort for high-frequency streaming (requested after session_ready)
 */
import type { StreamBatch } from '../../../shared/protocol'

export type StreamBatchHandler = (batch: StreamBatch) => void

/** Create a new session and return its sessionId */
export async function createSession(cwd: string): Promise<string> {
  const result = await window.piApi.createSession(cwd)
  if (!result.success || !result.sessionId) {
    throw new Error(result.error || 'failed to create session')
  }
  window.piApi.requestStreamPort(result.sessionId)
  return result.sessionId
}

/** Resume an existing session by its file path (from SessionInfo.path) */
export async function resumeSession(sessionPath: string): Promise<string> {
  const result = await window.piApi.resumeSession(sessionPath)
  if (!result.success || !result.sessionId) {
    throw new Error(result.error || 'failed to resume session')
  }
  window.piApi.requestStreamPort(result.sessionId)
  return result.sessionId
}

/** Destroy a session */
export async function destroySession(sessionId: string): Promise<void> {
  await window.piApi.destroySession(sessionId)
}

/** Subscribe to stream batches for a specific session */
export function subscribeToStream(sessionId: string, handler: StreamBatchHandler): () => void {
  return window.piApi.onStreamBatch(sessionId, handler)
}

/** Per-session commands */
export const piAgent = {
  prompt: (sessionId: string, message: string) => window.piApi.prompt(sessionId, message),
  abort: (sessionId: string) => window.piApi.abort(sessionId),
  getState: (sessionId: string) => window.piApi.getState(sessionId),
  getMessages: (sessionId: string) => window.piApi.getMessages(sessionId),
  switchSession: (sessionId: string, path: string) => window.piApi.switchSession(sessionId, path),
  listSessions: (cwd?: string) => window.piApi.listSessions(cwd),
  cycleModel: (sessionId: string) => window.piApi.cycleModel(sessionId),
  cycleThinkingLevel: (sessionId: string) => window.piApi.cycleThinkingLevel(sessionId),
}
