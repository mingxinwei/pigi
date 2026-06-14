/**
 * Pi agent client - renderer-side typed wrappers over window.piApi.
 *
 * Components use these instead of calling piApi directly.
 * All session-scoped functions take `sessionPath` as the session identifier.
 */
import type {
  AuthProviderInfo,
  ModelInfo,
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

async function send<T = unknown>(sessionPath: string, command: PiCommand): Promise<T> {
  return window.piApi.send(sessionPath, command) as Promise<T>;
}

// =============================================================================
// Session lifecycle
// =============================================================================

/** Create a new session. Resolves with sessionPath when port is received. */
export async function createSession(cwd: string): Promise<string> {
  const result = await window.piApi.createSession(cwd);
  if (!result.success || !result.sessionPath) {
    throw new Error(result.error || 'failed to create session');
  }
  return result.sessionPath;
}

/** Resume an existing session by file path. Resolves with sessionPath when port is ready. */
export async function resumeSession(sessionPath: string): Promise<string> {
  const result = await window.piApi.resumeSession(sessionPath);
  if (!result.success || !result.sessionPath) {
    throw new Error(result.error || 'failed to resume session');
  }
  return result.sessionPath;
}

/** Destroy a session. */
export async function destroySession(sessionPath: string): Promise<void> {
  await window.piApi.destroySession(sessionPath);
}

export async function touchSession(sessionPath: string): Promise<void> {
  await window.piApi.touchSession(sessionPath);
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

export async function removeProject(path: string): Promise<ProjectStateResult> {
  return window.piApi.removeProject(path);
}

export async function reorderProjects(paths: string[]): Promise<ProjectStateResult> {
  return window.piApi.reorderProjects(paths);
}

export async function listProjectSessions(cwds: string[]): Promise<SessionListResult> {
  return window.piApi.listProjectSessions(cwds);
}

/** Read messages from a session file without a live utility process. */
export async function readSessionMessages(sessionPath: string): Promise<{
  messages: unknown[];
  compactionCount: number;
  thinkingLevel: string;
  model: { provider: string; modelId: string } | null;
}> {
  const result = await window.piApi.readSessionMessages(sessionPath);
  if (!result.success || !result.messages) {
    throw new Error(result.error || 'failed to read session messages');
  }
  return {
    messages: result.messages,
    compactionCount: result.compactionCount ?? 0,
    thinkingLevel: result.thinkingLevel ?? 'off',
    model: result.model ?? null,
  };
}

export function onProjectSessionsChunk(
  callback: (chunk: ProjectSessionsChunk) => void,
): () => void {
  return window.piApi.onProjectSessionsChunk(callback);
}

// =============================================================================
// Session commands (via MessagePort)
// =============================================================================

export async function prompt(sessionPath: string, message: string): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'prompt', message });
  if (!result.success) {
    throw new Error(result.error || 'prompt failed');
  }
}

export async function steer(sessionPath: string, message: string): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'steer', message });
  if (!result.success) {
    throw new Error(result.error || 'steer failed');
  }
}

export async function followUp(sessionPath: string, message: string): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'follow_up', message });
  if (!result.success) {
    throw new Error(result.error || 'follow_up failed');
  }
}

interface ClearQueueResult {
  success: boolean;
  steering?: string[];
  followUp?: string[];
  error?: string;
}

export async function clearQueue(sessionPath: string): Promise<ClearQueueResult> {
  return send<ClearQueueResult>(sessionPath, { type: 'clear_queue' });
}

export async function abort(sessionPath: string): Promise<void> {
  await send(sessionPath, { type: 'abort' });
}

export async function compact(sessionPath: string): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'compact' });
  if (!result.success) {
    throw new Error(result.error || 'compact failed');
  }
}

export async function getState(sessionPath: string): Promise<SessionState> {
  return send<SessionState>(sessionPath, { type: 'get_state' });
}

export async function getSessionOptions(sessionPath: string): Promise<SessionOptions> {
  return send<SessionOptions>(sessionPath, { type: 'get_session_options' });
}

export async function getMessages(
  sessionPath: string,
): Promise<{ messages: unknown[]; compactionCount: number }> {
  return send<{ messages: unknown[]; compactionCount: number }>(sessionPath, {
    type: 'get_messages',
  });
}

export async function listSessions(sessionPath: string, cwd?: string): Promise<unknown[]> {
  return send<unknown[]>(sessionPath, { type: 'list_sessions', cwd });
}

export async function cycleModel(sessionPath: string): Promise<unknown> {
  return send(sessionPath, { type: 'cycle_model' });
}

export async function cycleThinkingLevel(sessionPath: string): Promise<string | null> {
  return send<string | null>(sessionPath, { type: 'cycle_thinking_level' });
}

export async function setModel(
  sessionPath: string,
  provider: string,
  modelId: string,
): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'set_model', provider, modelId });
  if (!result.success) {
    throw new Error(result.error || 'set_model failed');
  }
}

export async function setThinkingLevel(sessionPath: string, level: ThinkingLevel): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'set_thinking_level', level });
  if (!result.success) {
    throw new Error(result.error || 'set_thinking_level failed');
  }
}

export async function renameSession(sessionPath: string, name: string): Promise<void> {
  const result = await send<CommandResult>(sessionPath, { type: 'rename_session', name });
  if (!result.success) {
    throw new Error(result.error || 'rename_session failed');
  }
}

// =============================================================================
// Authentication
// =============================================================================

export async function getAuthProviders(
  sessionPath: string,
): Promise<{ success: boolean; providers: AuthProviderInfo[] }> {
  return send(sessionPath, { type: 'get_auth_providers' });
}

export async function loginOAuth(sessionPath: string, providerId: string): Promise<CommandResult> {
  return send<CommandResult>(sessionPath, { type: 'login_oauth', providerId });
}

export async function loginApiKey(
  sessionPath: string,
  providerId: string,
  apiKey: string,
): Promise<CommandResult> {
  return send<CommandResult>(sessionPath, { type: 'login_api_key', providerId, apiKey });
}

export async function logout(sessionPath: string, providerId: string): Promise<CommandResult> {
  return send<CommandResult>(sessionPath, { type: 'logout', providerId });
}

// =============================================================================
// Subscriptions
// =============================================================================

export function onPush(sessionPath: string, callback: (message: PiPush) => void): () => void {
  return window.piApi.onPush(sessionPath, callback);
}

export function onStreamBatch(
  sessionPath: string,
  callback: (batch: StreamBatch) => void,
): () => void {
  return window.piApi.onStreamBatch(sessionPath, callback);
}

/** Get model options from the warm (pre-spawned) process. Returns empty if not ready. */
export async function getWarmSessionOptions(): Promise<{
  models: ModelInfo[];
}> {
  return window.piApi.getWarmSessionOptions();
}
