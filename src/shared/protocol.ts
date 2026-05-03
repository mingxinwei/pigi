/**
 * Protocol types for communication between renderer ↔ pi-agent utility process.
 *
 * Two channels:
 * 1. Control (normal IPC via main): low-frequency commands and lifecycle events
 * 2. Stream (MessagePort, direct renderer ↔ utility): high-frequency batched deltas
 */

// --- Stream channel (MessagePort) ---

/** Batched streaming data: renderer ← utility (high-frequency, every 16ms) */
export interface StreamBatch {
  type: 'stream_batch'
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
  | { type: 'init'; cwd: string }
  | { type: 'prompt'; message: string }
  | { type: 'abort' }
  | { type: 'getState' }
  | { type: 'getMessages' }
  | { type: 'newSession' }
  | { type: 'switchSession'; sessionPath: string }
  | { type: 'listSessions'; cwd?: string }
  | { type: 'cycleModel' }
  | { type: 'cycleThinkingLevel' }

/** Responses: utility → main → renderer */
export type PiResponse =
  | { type: 'runtime_ready'; sessionId: string; model: ModelInfo | null; thinkingLevel: string | null }
  | { type: 'runtime_error'; error: string }
  | { type: 'event'; event: unknown }
  | { type: 'error'; error: string }
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
