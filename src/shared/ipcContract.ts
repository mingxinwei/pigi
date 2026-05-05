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

export interface ProjectDirectory {
  path: string
  name: string
}

export interface ProjectState {
  recentProjects: ProjectDirectory[]
  activeProject: ProjectDirectory | null
}

export type ProjectStateResult =
  | ({ success: true } & ProjectState)
  | { success: false; error?: string; canceled?: boolean }

export interface PiSessionInfo {
  path: string
  id: string
  cwd: string
  name?: string
  parentSessionPath?: string
  created: string
  modified: string
  messageCount: number
  firstMessage: string
  allMessagesText: string
}

export type SessionListResult =
  | { success: true; requestId: string }
  | { success: false; error?: string }

export interface ProjectSessionsChunk {
  requestId: string
  cwd: string
  success: boolean
  sessions?: PiSessionInfo[]
  error?: string
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
  /** renderer → main: mark a session as recently selected */
  TouchSession = 'pi:touch_session',
  /** main → renderer: deliver a MessagePort for a session */
  SessionPort = 'pi:session_port',
  /** main → renderer: a session's process exited unexpectedly */
  ProcessExit = 'pi:process_exit',
  /** renderer → main: get persisted project cwd state */
  GetProjects = 'pi:get_projects',
  /** renderer → main: set active project cwd from recent project list */
  SetActiveProject = 'pi:set_active_project',
  /** renderer → main: open a native directory picker for project cwd selection */
  OpenProjectDirectory = 'pi:open_project_directory',
  /** renderer → main: list persisted pi sessions for a project cwd */
  ListProjectSessions = 'pi:list_project_sessions',
  /** main → renderer: persisted pi sessions for one project cwd */
  ProjectSessionsChunk = 'pi:project_sessions_chunk',
}

export interface SessionIndexCommand {
  type: 'list_project_sessions'
  requestId: string
  cwds: string[]
}

export type SessionIndexResponse = { type: 'project_sessions_chunk' } & ProjectSessionsChunk

// =============================================================================
// Internal: Main → Utility (parentPort, lifecycle only)
// =============================================================================

export type UtilityCommand =
  | { type: 'create_session'; cwd: string }
  | { type: 'resume_session'; sessionPath: string }
  | { type: 'prewarm_session_services'; cwds: string[] }
  | { type: 'attach_port' }

// =============================================================================
// Internal: Utility → Main (parentPort, lifecycle only)
// =============================================================================

export type UtilityResponse =
  | { type: 'session_created'; sessionId: string }
  | { type: 'session_error'; error: string }
  | { type: 'session_busy_changed'; isBusy: boolean }
