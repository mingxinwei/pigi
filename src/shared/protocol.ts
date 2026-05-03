/**
 * Protocol types for communication between processes.
 *
 * Three layers:
 * 1. IPC (renderer ↔ main): defined in ipcChannels.ts
 * 2. Internal (main ↔ utility): PiCommand, PiResponse, UtilityMessage
 * 3. Stream (utility → renderer via MessagePort): StreamBatch
 */

// --- Stream channel (one MessagePort per session) ---

/** Batched streaming data: utility → renderer (high-frequency, every 16ms) */
export interface StreamBatch {
  type: 'stream_batch'
  sessionId: string
  /** Accumulated text deltas keyed by assistant message id */
  text?: Record<string, string>
  /** Accumulated thinking deltas keyed by assistant message id */
  thinking?: Record<string, string>
  /** Accumulated tool output keyed by tool call id */
  toolOutput?: Record<string, string>
}

// --- Internal protocol (main ↔ utility process via parentPort/postMessage) ---

/** Messages from main → utility that are NOT regular commands (carry ports, no response) */
export type UtilityMessage =
  | { type: 'attach_stream_port'; sessionId: string }

/** Commands: main → utility (expect a result response) */
export type PiCommand =
  | { type: 'create_session'; cwd: string }
  | { type: 'resume_session'; sessionPath: string }
  | { type: 'destroy_session'; sessionId: string }
  | { type: 'prompt'; sessionId: string; message: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'getState'; sessionId: string }
  | { type: 'getMessages'; sessionId: string }
  | { type: 'switchSession'; sessionId: string; sessionPath: string }
  | { type: 'listSessions'; cwd?: string }
  | { type: 'cycleModel'; sessionId: string }
  | { type: 'cycleThinkingLevel'; sessionId: string }

/** Responses/events: utility → main */
export type PiResponse =
  | { type: 'session_ready'; sessionId: string; model: ModelInfo | null; thinkingLevel: string | null }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'event'; sessionId: string; event: unknown }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'result'; id: string; data: unknown }

// --- Shared types ---

export interface ModelInfo {
  name: string
  provider: string
  id: string
}

export interface SessionState {
  model: ModelInfo | null
  thinkingLevel: string
  isStreaming: boolean
  sessionFile: string | undefined
  sessionId: string
  messageCount: number
}
