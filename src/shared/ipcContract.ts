/**
 * IPC Contract - single source of truth for all inter-process communication.
 *
 * Architecture:
 *   One utility process per session.
 *   Renderer ←(MessagePort)→ Utility Process (1:1 with session)
 *   Main only handles: process lifecycle + port handshake
 *
 * Flow:
 *   1. Renderer invokes create/resume on main
 *   2. Main spawns a new utility process, sends lifecycle command
 *   3. Utility creates session, reports back real sessionId
 *   4. Main creates MessageChannel, distributes ports, returns sessionId
 *   5. All subsequent communication flows over the MessagePort
 */

// =============================================================================
// Shared Data Types
// =============================================================================

export interface ModelInfo {
  name: string
  provider: string
  id: string
}

export interface SessionState {
  model: ModelInfo | null
  thinkingLevel: string | null
  isStreaming: boolean
  sessionFile: string | undefined
  sessionId: string
  messageCount: number
}

// =============================================================================
// Commands: Renderer → Utility (via MessagePort, after handshake)
// =============================================================================

export type PiCommand =
  | { type: 'prompt'; message: string }
  | { type: 'abort' }
  | { type: 'get_state' }
  | { type: 'get_messages' }
  | { type: 'list_sessions'; cwd?: string }
  | { type: 'cycle_model' }
  | { type: 'cycle_thinking_level' }
  | { type: 'debug' }

/** Wire format for a command request (renderer → utility via port) */
export interface PiRequest {
  id: string
  cmd: PiCommand
}

/** Wire format for a command response (utility → renderer via port) */
export interface PiResult {
  id: string
  result: unknown
}

// =============================================================================
// Push events: Utility → Renderer (via MessagePort, no request ID)
// =============================================================================

export type PiPush =
  | { type: 'session_ready'; model: ModelInfo | null; thinkingLevel: string | null }
  | { type: 'session_error'; error: string }
  | { type: 'event'; event: unknown }
  | { type: 'error'; error: string }

// =============================================================================
// Stream batches: Utility → Renderer (via MessagePort, high-frequency)
// =============================================================================

/** Batched streaming data, flushed every 16ms */
export interface StreamBatch {
  type: 'stream_batch'
  text?: Record<string, string>
  thinking?: Record<string, string>
  toolOutput?: Record<string, string>
}

// =============================================================================
// Port message: union of everything that can flow over a session's MessagePort
// =============================================================================

export type PortMessage = PiRequest | PiResult | PiPush | StreamBatch

// =============================================================================
// IPC Channels (only used for lifecycle via main process)
// =============================================================================

export enum PiChannel {
  /** renderer → main: create a new session (spawns process, returns real sessionId + port) */
  CreateSession = 'pi:create_session',
  /** renderer → main: resume an existing session */
  ResumeSession = 'pi:resume_session',
  /** renderer → main: destroy a session (kills process) */
  DestroySession = 'pi:destroy_session',
  /** main → renderer: deliver a MessagePort for a session */
  SessionPort = 'pi:session_port',
  /** main → renderer: a session's process exited unexpectedly */
  ProcessExit = 'pi:process_exit',
}

// =============================================================================
// Internal: Main → Utility (parentPort, lifecycle only)
// =============================================================================

export type UtilityCommand =
  | { type: 'create_session'; cwd: string }
  | { type: 'resume_session'; sessionPath: string }
  | { type: 'attach_port' }

// =============================================================================
// Internal: Utility → Main (parentPort, lifecycle only)
// =============================================================================

export type UtilityResponse =
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_error'; error: string }
