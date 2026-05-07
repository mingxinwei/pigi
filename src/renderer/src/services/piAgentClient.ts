/**
 * Pi agent client - renderer-side typed wrappers over window.piApi.
 *
 * Components use these instead of calling piApi directly.
 */
import type {
  PiCommand,
  PiPush,
  GitBranchResult,
  ProjectSessionsChunk,
  ProjectStateResult,
  SessionOptions,
  SessionState,
  SessionListResult,
  ThinkingLevel,
  StreamBatch,
} from '../../../shared/ipcContract';

type CommandResult<T = unknown> = { success: boolean; error?: string } & T;

async function send<T = unknown>(sessionId: string, cmd: PiCommand): Promise<T> {
  return window.piApi.send(sessionId, cmd) as Promise<T>;
}

// =============================================================================
// Session lifecycle
// =============================================================================

/** Create a new session. Resolves when port is received. */
export async function createSession(cwd: string): Promise<string> {
  const result = await window.piApi.createSession(cwd);
  if (!result.success || !result.sessionId) {
    throw new Error(result.error || 'failed to create session');
  }
  return result.sessionId;
}

/** Resume an existing session by file path. */
export async function resumeSession(sessionPath: string): Promise<string> {
  const result = await window.piApi.resumeSession(sessionPath);
  if (!result.success || !result.sessionId) {
    throw new Error(result.error || 'failed to resume session');
  }
  return result.sessionId;
}

/** Destroy a session. */
export async function destroySession(sessionId: string): Promise<void> {
  await window.piApi.destroySession(sessionId);
}

export async function touchSession(sessionId: string): Promise<void> {
  await window.piApi.touchSession(sessionId);
}

export async function getProjects(): Promise<ProjectStateResult> {
  return window.piApi.getProjects();
}

export async function getGitBranch(cwd: string): Promise<GitBranchResult> {
  return window.piApi.getGitBranch(cwd);
}

export async function setActiveProject(path: string): Promise<ProjectStateResult> {
  return window.piApi.setActiveProject(path);
}

export async function openProjectDirectory(): Promise<ProjectStateResult> {
  return window.piApi.openProjectDirectory();
}

export async function listProjectSessions(cwds: string[]): Promise<SessionListResult> {
  return window.piApi.listProjectSessions(cwds);
}

export function onProjectSessionsChunk(
  callback: (chunk: ProjectSessionsChunk) => void,
): () => void {
  return window.piApi.onProjectSessionsChunk(callback);
}

// =============================================================================
// Session commands (via MessagePort)
// =============================================================================

export async function prompt(sessionId: string, message: string): Promise<void> {
  const result = await send<CommandResult>(sessionId, { type: 'prompt', message });
  if (!result.success) {
    throw new Error(result.error || 'prompt failed');
  }
}

export async function steer(sessionId: string, message: string): Promise<void> {
  const result = await send<CommandResult>(sessionId, { type: 'steer', message });
  if (!result.success) {
    throw new Error(result.error || 'steer failed');
  }
}

export async function abort(sessionId: string): Promise<void> {
  await send(sessionId, { type: 'abort' });
}

export async function compact(sessionId: string): Promise<void> {
  const result = await send<CommandResult>(sessionId, { type: 'compact' });
  if (!result.success) {
    throw new Error(result.error || 'compact failed');
  }
}

export async function getState(sessionId: string): Promise<SessionState> {
  return send<SessionState>(sessionId, { type: 'get_state' });
}

export async function getSessionOptions(sessionId: string): Promise<SessionOptions> {
  return send<SessionOptions>(sessionId, { type: 'get_session_options' });
}

export async function getMessages(sessionId: string): Promise<unknown[]> {
  return send<unknown[]>(sessionId, { type: 'get_messages' });
}

export async function listSessions(sessionId: string, cwd?: string): Promise<unknown[]> {
  return send<unknown[]>(sessionId, { type: 'list_sessions', cwd });
}

export async function cycleModel(sessionId: string): Promise<unknown> {
  return send(sessionId, { type: 'cycle_model' });
}

export async function cycleThinkingLevel(sessionId: string): Promise<string | null> {
  return send<string | null>(sessionId, { type: 'cycle_thinking_level' });
}

export async function setModel(
  sessionId: string,
  provider: string,
  modelId: string,
): Promise<void> {
  const result = await send<CommandResult>(sessionId, { type: 'set_model', provider, modelId });
  if (!result.success) {
    throw new Error(result.error || 'set_model failed');
  }
}

export async function setThinkingLevel(sessionId: string, level: ThinkingLevel): Promise<void> {
  const result = await send<CommandResult>(sessionId, { type: 'set_thinking_level', level });
  if (!result.success) {
    throw new Error(result.error || 'set_thinking_level failed');
  }
}

// =============================================================================
// Subscriptions
// =============================================================================

export function onPush(sessionId: string, callback: (msg: PiPush) => void): () => void {
  return window.piApi.onPush(sessionId, callback);
}

export function onStreamBatch(
  sessionId: string,
  callback: (batch: StreamBatch) => void,
): () => void {
  return window.piApi.onStreamBatch(sessionId, callback);
}
