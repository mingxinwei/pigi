/**
 * Protocol types for communication between renderer ↔ pi-agent utility process.
 *
 * Two channels per session:
 * 1. Control (normal IPC via main): commands and lifecycle events, tagged with sessionId
 * 2. Stream (MessagePort per session): high-frequency batched deltas
 */

// --- Stream channel (one MessagePort per session) ---

/** Batched streaming data: renderer ← utility (high-frequency, every 16ms) */
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

// --- Control channel (normal IPC) ---

/** Commands: renderer → main → utility */
export type PiCommand =
  | { type: 'create_session'; sessionId: string; cwd: string }
  | { type: 'destroy_session'; sessionId: string }
  | { type: 'prompt'; sessionId: string; message: string }
  | { type: 'abort'; sessionId: string }
  | { type: 'getState'; sessionId: string }
  | { type: 'getMessages'; sessionId: string }
  | { type: 'switchSession'; sessionId: string; sessionPath: string }
  | { type: 'listSessions'; cwd?: string }
  | { type: 'cycleModel'; sessionId: string }
  | { type: 'cycleThinkingLevel'; sessionId: string }

/** Responses/events: utility → main → renderer */
export type PiResponse =
  | { type: 'session_ready'; sessionId: string; model: ModelInfo | null; thinkingLevel: string | null }
  | { type: 'session_error'; sessionId: string; error: string }
  | { type: 'event'; sessionId: string; event: unknown }
  | { type: 'error'; sessionId: string; error: string }
  | { type: 'result'; id: string; data: unknown }

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
