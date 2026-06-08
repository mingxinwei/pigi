import type { EditToolInput, WriteToolInput } from '@earendil-works/pi-coding-agent';

/**
 * IPC Contract - single source of truth for all inter-process communication.
 *
 * Architecture:
 *   One utility process per session.
 *   Renderer ←(control/data MessagePorts)→ Utility Process (1:1 with session)
 *   Main only handles: process lifecycle + port handshake
 *
 * Flow:
 *   1. Renderer invokes create/resume on main
 *   2. Main spawns a new utility process, sends lifecycle command
 *   3. Utility creates session, reports back real sessionId
 *   4. Main creates MessageChannels, distributes ports, returns sessionId
 *   5. Runtime communication flows over dedicated control/data MessagePorts
 */

// =============================================================================
// Shared Data Types
// =============================================================================

export interface ModelInfo {
  name: string;
  provider: string;
  id: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}

export type ThinkingLevel = 'off' | 'minimal' | 'low' | 'medium' | 'high' | 'xhigh';

export interface ProjectDirectory {
  path: string;
  name: string;
}

export interface ProjectState {
  recentProjects: ProjectDirectory[];
  activeProject: ProjectDirectory | null;
}

export type GitBranchResult =
  | { success: true; branch: string | null; detached: boolean }
  | { success: false; error?: string };

export type ProjectStateResult =
  | ({ success: true } & ProjectState)
  | { success: false; error?: string; canceled?: boolean };

export interface PiSessionInfo {
  path: string;
  id: string;
  cwd: string;
  name?: string;
  parentSessionPath?: string;
  created: string;
  modified: string;
  messageCount: number;
  firstMessage: string;
  allMessagesText: string;
}

export type SessionListResult =
  | { success: true; requestId: string }
  | { success: false; error?: string };

export interface ProjectSessionsChunk {
  requestId: string;
  cwd: string;
  success: boolean;
  sessions?: PiSessionInfo[];
  error?: string;
}

export interface SessionState {
  model: ModelInfo | null;
  thinkingLevel: string | null;
  isStreaming: boolean;
  sessionFile: string | undefined;
  sessionId: string;
  messageCount: number;
  contextUsage: ContextUsage | null;
  autoCompactionEnabled: boolean;
  compactionCount: number;
}

export interface ContextUsage {
  tokens: number | null;
  contextWindow: number;
  percent: number | null;
}

export interface SkillSlashCommand {
  name: string;
  description: string;
}

export interface SessionOptions {
  models: ModelInfo[];
  thinkingLevels: ThinkingLevel[];
  skills: SkillSlashCommand[];
}

// =============================================================================
// Commands: Renderer → Utility (via control MessagePort, after handshake)
// =============================================================================

export interface AuthProviderInfo {
  id: string;
  name: string;
  hasAuth: boolean;
  authStatus: { configured: boolean; source?: string; label?: string };
  authType: 'oauth' | 'api_key';
}

export type PiCommand =
  | { type: 'prompt'; message: string }
  | { type: 'steer'; message: string }
  | { type: 'follow_up'; message: string }
  | { type: 'abort' }
  | { type: 'clear_queue' }
  | { type: 'compact' }
  | { type: 'get_state' }
  | { type: 'get_session_options' }
  | { type: 'get_messages' }
  | { type: 'list_sessions'; cwd?: string }
  | { type: 'cycle_model' }
  | { type: 'cycle_thinking_level' }
  | { type: 'set_model'; provider: string; modelId: string }
  | { type: 'set_thinking_level'; level: ThinkingLevel }
  | { type: 'rename_session'; name: string }
  | { type: 'get_auth_providers' }
  | { type: 'login_oauth'; providerId: string }
  | { type: 'login_api_key'; providerId: string; apiKey: string }
  | { type: 'logout'; providerId: string }
  | { type: 'debug' };

/** Wire format for a command request (renderer → utility via port) */
export interface PiRequest {
  id: string;
  cmd: PiCommand;
}

/** Wire format for a command response (utility → renderer via port) */
export interface PiResult {
  id: string;
  result: unknown;
}

// =============================================================================
// Push events: Utility → Renderer (via data MessagePort, no request ID)
// =============================================================================

export type PiPush =
  | {
      type: 'session_ready';
      model: ModelInfo | null;
      thinkingLevel: string | null;
      contextUsage: ContextUsage | null;
      autoCompactionEnabled: boolean;
    }
  | { type: 'session_error'; error: string }
  | { type: 'event'; event: unknown }
  | { type: 'error'; error: string }
  | { type: 'status_sync'; isStreaming: boolean }
  | { type: 'login_open_url'; url: string }
  | { type: 'login_progress'; message: string }
  | { type: 'login_complete'; providerId: string }
  | { type: 'login_error'; error: string }
  | { type: 'auto_title'; title: string; cwd: string };

// =============================================================================
// Stream batches: Utility → Renderer (via data MessagePort, high-frequency)
// =============================================================================

export type StreamBatchToolArgs =
  | { name: 'write'; args: Partial<WriteToolInput> }
  | { name: 'edit'; args: Pick<EditToolInput, 'path'> };

/** Batched streaming data, flushed every 16ms */
export interface StreamBatch {
  type: 'stream_batch';
  text?: string;
  thinking?: string;
  toolOutput?: Record<string, string>;
  toolArgs?: Record<string, StreamBatchToolArgs>;
}

// =============================================================================
// Port messages
// =============================================================================

/** Low-volume control port: renderer → utility commands and utility → renderer responses. */
export type ControlPortMessage = PiRequest | PiResult;

/** High-volume data port: utility → renderer push events and stream batches. */
export type DataPortMessage = PiPush | StreamBatch;

/** Union of all session port messages. */
export type PortMessage = ControlPortMessage | DataPortMessage;

// =============================================================================
// Type guards for discriminated union narrowing
// =============================================================================

export function isPiResult(message: ControlPortMessage): message is PiResult {
  return 'id' in message && 'result' in message;
}

export function isPiRequest(message: ControlPortMessage): message is PiRequest {
  return 'id' in message && 'cmd' in message;
}

export function isStreamBatch(message: DataPortMessage): message is StreamBatch {
  return message.type === 'stream_batch';
}

export function isPiPush(message: DataPortMessage): message is PiPush {
  return 'type' in message && message.type !== 'stream_batch';
}

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
  /** main → renderer: deliver control/data MessagePorts for a session */
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
  /** renderer → main: get current git branch for a cwd */
  GetGitBranch = 'pi:get_git_branch',
  /** renderer → main: remove a project from recent projects list */
  RemoveProject = 'pi:remove_project',
  /** renderer → main: reorder recent projects */
  ReorderProjects = 'pi:reorder_projects',
  /** renderer → main: rename a persisted (non-running) session */
  RenamePersistedSession = 'pi:rename_persisted_session',
  /** renderer → main: read messages from a session file without spawning a utility process */
  ReadSessionMessages = 'pi:read_session_messages',
  /** renderer → main: open a URL in the system browser */
  OpenExternal = 'pi:open_external',
  /** renderer → main: get system accent color */
  GetAccentColor = 'pi:get_accent_color',
  /** renderer → main: get all keyboard shortcut definitions with current bindings */
  GetShortcuts = 'pi:get_shortcuts',
  /** renderer → main: update a keyboard shortcut binding */
  SetShortcut = 'pi:set_shortcut',
  /** renderer → main: get model options from warm (pre-spawned) process */
  GetWarmSessionOptions = 'pi:get_warm_session_options',
}

// =============================================================================
// Keyboard Shortcuts
// =============================================================================

export interface ShortcutBinding {
  key: string;
  ctrl?: boolean;
  meta?: boolean;
  shift?: boolean;
  alt?: boolean;
}

export interface ShortcutDefinition {
  id: string;
  label: string;
  defaultBinding: ShortcutBinding;
  binding: ShortcutBinding;
}

export interface ListProjectSessionsCommand {
  type: 'list_project_sessions';
  requestId: string;
  cwds: string[];
}

export interface RenameSessionCommand {
  type: 'rename_session';
  requestId: string;
  sessionPath: string;
  name: string;
}

export interface ReadSessionMessagesCommand {
  type: 'read_session_messages';
  requestId: string;
  sessionPath: string;
}

export type SessionWorkerCommand =
  | ListProjectSessionsCommand
  | RenameSessionCommand
  | ReadSessionMessagesCommand;

export type SessionWorkerResponse =
  | ({ type: 'project_sessions_chunk' } & ProjectSessionsChunk)
  | { type: 'rename_session_result'; requestId: string; success: boolean; error?: string }
  | {
      type: 'session_messages_result';
      requestId: string;
      success: boolean;
      messages?: unknown[];
      compactionCount?: number;
      thinkingLevel?: string;
      model?: { provider: string; modelId: string } | null;
      error?: string;
    };

// =============================================================================
// Internal: Main → Utility (parentPort, lifecycle only)
// =============================================================================

export type UtilityCommand =
  | { type: 'create_session'; cwd: string }
  | { type: 'resume_session'; sessionPath: string }
  | { type: 'warm_up'; cwds: string[] }
  | { type: 'prewarm_session_services'; cwds: string[] }
  | { type: 'attach_ports' };

// =============================================================================
// Internal: Utility → Main (parentPort, lifecycle only)
// =============================================================================

export type UtilityResponse =
  | { type: 'session_created'; sessionId: string; sessionPath: string }
  | { type: 'session_error'; error: string }
  | { type: 'session_busy_changed'; isBusy: boolean }
  | { type: 'warm_ready'; models: ModelInfo[]; thinkingLevels: string[] };
