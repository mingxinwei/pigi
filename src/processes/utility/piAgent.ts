/**
 * Pi Agent - utility process managing exactly ONE pi SDK session.
 *
 * Lifecycle:
 * 1. Receives create_session/resume_session from main via parentPort
 * 2. Creates session, reports back real sessionId
 * 3. Receives attach_ports from main with control/data MessagePorts
 * 4. Commands flow over the control port; push/stream output flows over the data port
 *
 * One process per session. Process exits when session is destroyed.
 */
import {
  type AgentSessionEvent,
  type AgentSessionRuntime,
  type AgentSessionServices,
  createAgentSessionFromServices,
  createAgentSessionRuntime,
  type CreateAgentSessionRuntimeFactory,
  createAgentSessionServices,
  getAgentDir,
  SessionManager,
  SettingsManager,
  type WriteToolInput,
  type EditToolInput,
} from '@earendil-works/pi-coding-agent';
import type {
  ModelInfo,
  PiCommand,
  PiPush,
  PiRequest,
  PiResult,
  ControlPortMessage,
  StreamBatch,
  StreamBatchToolArgs,
  UtilityCommand,
  UtilityResponse,
} from '../../shared/ipcContract';

function toModelInfo(model: {
  name: string;
  provider: string;
  id: string;
  api: string;
  contextWindow: number;
  maxTokens: number;
  reasoning: boolean;
}): ModelInfo {
  return {
    name: model.name,
    provider: model.provider,
    id: model.id,
    api: model.api,
    contextWindow: model.contextWindow,
    maxTokens: model.maxTokens,
    reasoning: model.reasoning,
  };
}

// =============================================================================
// Port interface (compatible with Electron's MessagePortMain)
// =============================================================================

interface Port {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  on(event: 'message', listener: (messageEvent: { data: unknown }) => void): unknown;
}

// =============================================================================
// StreamBatcher
// =============================================================================

class StreamBatcher {
  private static readonly MIN_INTERVAL_MS = 8;
  private batch: StreamBatch = { type: 'stream_batch' };
  private dirty = false;
  private scheduled = false;
  private lastFlushAt = 0;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private port: Port | null = null;

  start(port: Port): void {
    this.port = port;
  }

  stop(): void {
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    this.flush();
  }

  appendText(delta: string): void {
    this.batch.text = (this.batch.text || '') + delta;
    this.markDirty();
  }

  appendThinking(delta: string): void {
    this.batch.thinking = (this.batch.thinking || '') + delta;
    this.markDirty();
  }

  setToolOutput(id: string, output: string): void {
    if (!this.batch.toolOutput) this.batch.toolOutput = {};
    this.batch.toolOutput[id] = output;
    this.markDirty();
  }

  setToolArgs(toolCallId: string, entry: StreamBatchToolArgs): void {
    if (!this.batch.toolArgs) this.batch.toolArgs = {};
    this.batch.toolArgs[toolCallId] = entry;
    this.markDirty();
  }

  /** Force an immediate flush, ensuring all buffered deltas are sent before subsequent push events. */
  flushNow(): void {
    this.flush();
  }

  private markDirty(): void {
    this.dirty = true;
    if (this.scheduled) return;
    this.scheduled = true;

    const elapsed = performance.now() - this.lastFlushAt;
    const delay = Math.max(1, StreamBatcher.MIN_INTERVAL_MS - elapsed);
    this.flushTimer = setTimeout(() => this.flush(), delay);
  }

  private flush(): void {
    this.scheduled = false;
    if (this.flushTimer) {
      clearTimeout(this.flushTimer);
      this.flushTimer = null;
    }
    if (!this.dirty || !this.port) return;
    this.lastFlushAt = performance.now();
    this.port.postMessage(this.batch);
    this.batch = { type: 'stream_batch' };
    this.dirty = false;
  }
}

// =============================================================================
// Session state (single session per process)
// =============================================================================

let runtime: AgentSessionRuntime | null = null;
let batcher: StreamBatcher | null = null;
let controlPort: Port | null = null;
let dataPort: Port | null = null;
let unsubscribeEvents: (() => void) | null = null;
let isCleanedUp = false;
let isSessionBusy = false;
// Services are expensive to build; prewarm them while the user is browsing sessions.
const servicesByCwd = new Map<string, Promise<AgentSessionServices>>();
let serviceCreationQueue: Promise<void> = Promise.resolve();

function enqueueServiceCreation<T>(task: () => Promise<T>): Promise<T> {
  const queuedTask = serviceCreationQueue.then(task, task);
  serviceCreationQueue = queuedTask.then(
    () => {},
    () => {},
  );
  return queuedTask;
}

function createServicesForCwd(cwd: string): Promise<AgentSessionServices> {
  return enqueueServiceCreation(async () => {
    const previousCwd = process.cwd();
    try {
      const agentDir = getAgentDir();
      const settingsManager = SettingsManager.create(cwd, agentDir);

      // Some Pi extensions read process.cwd() while they register tools. Match the
      // Pi SDK cwd option during service construction so extension-local tools bind
      // to the project directory, not Electron's app directory.
      process.chdir(cwd);
      return await createAgentSessionServices({ cwd, agentDir, settingsManager });
    } finally {
      process.chdir(previousCwd);
    }
  });
}

function setSessionProcessCwd(cwd: string): Promise<void> {
  return enqueueServiceCreation(async () => {
    // Keep the claimed session process in its project cwd for runtime setup and
    // later extension code paths that consult process.cwd().
    process.chdir(cwd);
  });
}

function getServices(cwd: string): Promise<AgentSessionServices> {
  const existing = servicesByCwd.get(cwd);
  if (existing) {
    return existing;
  }

  const services = createServicesForCwd(cwd);
  services.catch(() => {
    servicesByCwd.delete(cwd);
  });
  servicesByCwd.set(cwd, services);
  return services;
}

// =============================================================================
// Runtime factory
// =============================================================================

const createRuntimeFactory: CreateAgentSessionRuntimeFactory = async ({
  cwd,
  sessionManager,
  sessionStartEvent,
}) => {
  const services = await getServices(cwd);
  return {
    ...(await createAgentSessionFromServices({
      services,
      sessionManager,
      sessionStartEvent,
    })),
    services,
    diagnostics: services.diagnostics,
  };
};

// =============================================================================
// Event subscription
// =============================================================================

function setSessionBusy(isBusy: boolean): void {
  if (isSessionBusy === isBusy) {
    return;
  }

  isSessionBusy = isBusy;
  sendToMain({ type: 'session_busy_changed', isBusy });

  // Push status_sync to renderer so the UI can reconcile in case an
  // agent_end event was missed or arrived out of order.
  if (dataPort) {
    const statusMessage: PiPush = { type: 'status_sync', isStreaming: isBusy };
    dataPort.postMessage(statusMessage);
  }
}

function subscribeToSession(rt: AgentSessionRuntime, port: Port, batch: StreamBatcher): () => void {
  const session = rt.session;

  function push(message: PiPush): void {
    port.postMessage(message);
  }

  return session.subscribe((event: AgentSessionEvent) => {
    switch (event.type) {
      case 'agent_start':
      case 'compaction_start':
      case 'auto_retry_start':
        setSessionBusy(true);
        break;
      case 'agent_end':
      case 'compaction_end':
      case 'auto_retry_end':
        setSessionBusy(session.isStreaming);
        break;
    }

    switch (event.type) {
      case 'message_start': {
        push({ type: 'event', event });
        break;
      }

      case 'message_update': {
        const { assistantMessageEvent, message } = event;
        // toolcall_delta — batch by toolCallId directly
        if (assistantMessageEvent.type === 'toolcall_delta' && message.role === 'assistant') {
          const content = message.content[assistantMessageEvent.contentIndex];
          if (content.type === 'toolCall' && content.id && content.name) {
            if (content.name === 'write') {
              // Write: stream full args (shows content preview during streaming)
              const args = content.arguments as Partial<WriteToolInput>;
              batch.setToolArgs(content.id, { name: 'write', args });
            } else if (content.name === 'edit') {
              // Edit: stream only path (edits array is large and not shown during streaming)
              const args = content.arguments as Partial<EditToolInput>;
              if (args.path) {
                batch.setToolArgs(content.id, { name: 'edit', args: { path: args.path } });
              }
            }
            return;
          }
        }
        if (assistantMessageEvent.type === 'text_delta') {
          batch.appendText(assistantMessageEvent.delta);
          return;
        }
        if (assistantMessageEvent.type === 'thinking_delta') {
          batch.appendThinking(assistantMessageEvent.delta);
          return;
        }
        push({ type: 'event', event });
        break;
      }

      case 'message_end':
        batch.flushNow();
        push({ type: 'event', event });
        break;

      case 'tool_execution_update': {
        const { toolCallId, partialResult } = event;
        const text = partialResult?.content?.[0]?.text;
        if (typeof text === 'string' && text && toolCallId) {
          batch.setToolOutput(toolCallId, text);
          return;
        }
        push({ type: 'event', event });
        break;
      }

      default:
        push({ type: 'event', event });
        break;
    }
  });
}

// =============================================================================
// Command handling (via control MessagePort from renderer)
// =============================================================================

async function handleCommand(command: PiCommand): Promise<unknown> {
  if (!runtime) return { success: false, error: 'session not initialized' };

  switch (command.type) {
    case 'prompt': {
      if (!command.message || command.message.trim().length === 0) {
        return { success: false, error: 'prompt must be a non-empty string' };
      }
      runtime.session.prompt(command.message).catch((err) => {
        if (dataPort) {
          const errorMessage: PiPush = {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
          dataPort.postMessage(errorMessage);
        }
      });
      return { success: true };
    }

    case 'steer': {
      if (!command.message || command.message.trim().length === 0) {
        return { success: false, error: 'steer message must be a non-empty string' };
      }
      await runtime.session.steer(command.message);
      return { success: true };
    }

    case 'follow_up': {
      if (!command.message || command.message.trim().length === 0) {
        return { success: false, error: 'follow_up message must be a non-empty string' };
      }
      await runtime.session.followUp(command.message);
      return { success: true };
    }

    case 'clear_queue': {
      const { steering, followUp } = runtime.session.clearQueue();
      return { success: true, steering, followUp };
    }

    case 'abort':
      runtime.session.abortCompaction();
      await runtime.session.abort();
      setSessionBusy(runtime.session.isStreaming);
      return { success: true };

    case 'compact':
      await runtime.session.compact();
      return { success: true };

    case 'get_state': {
      const s = runtime.session;
      return {
        model: s.model ? toModelInfo(s.model) : null,
        thinkingLevel: s.thinkingLevel,
        isStreaming: s.isStreaming,
        sessionFile: s.sessionFile,
        sessionId: s.sessionId,
        messageCount: s.messages.length,
        contextUsage: s.getContextUsage() ?? null,
        autoCompactionEnabled: s.autoCompactionEnabled,
        compactionCount: s.sessionManager
          .getBranch()
          .filter((e: { type: string }) => e.type === 'compaction').length,
      };
    }

    case 'get_messages': {
      const msgs = runtime.session.messages;
      const count = runtime.session.sessionManager
        .getBranch()
        .filter((e: { type: string }) => e.type === 'compaction').length;
      return { messages: msgs, compactionCount: count };
    }

    case 'get_session_options': {
      const session = runtime.session;
      const scopedModels = session.scopedModels.filter((scoped) =>
        session.modelRegistry.hasConfiguredAuth(scoped.model),
      );
      const models =
        scopedModels.length > 0
          ? scopedModels.map((scoped) => toModelInfo(scoped.model))
          : (await session.modelRegistry.getAvailable()).map(toModelInfo);
      const skills = runtime.services.resourceLoader.getSkills().skills.map((skill) => ({
        name: `skill:${skill.name}`,
        description: skill.description,
      }));
      return {
        models,
        thinkingLevels: session.getAvailableThinkingLevels(),
        skills,
      };
    }

    case 'list_sessions': {
      return command.cwd ? await SessionManager.list(command.cwd) : await SessionManager.listAll();
    }

    case 'cycle_model':
      return await runtime.session.cycleModel();

    case 'cycle_thinking_level':
      return runtime.session.cycleThinkingLevel();

    case 'set_model': {
      const model = runtime.session.modelRegistry.find(command.provider, command.modelId);
      if (!model) {
        return { success: false, error: `model not found: ${command.provider}/${command.modelId}` };
      }
      await runtime.session.setModel(model);
      return { success: true };
    }

    case 'set_thinking_level':
      runtime.session.setThinkingLevel(command.level);
      return { success: true };

    case 'rename_session': {
      if (!command.name || command.name.trim().length === 0) {
        return { success: false, error: 'name must be a non-empty string' };
      }
      runtime.session.sessionManager.appendSessionInfo(command.name.trim());
      return { success: true };
    }

    case 'debug': {
      const session = runtime.session;
      const models = runtime.services.modelRegistry;
      const available = await models.getAvailable();
      const extensions = runtime.services.resourceLoader.getExtensions();
      return {
        model: session.model
          ? { name: session.model.name, provider: session.model.provider, id: session.model.id }
          : null,
        availableModels: available.map(
          (m: { name: string; provider: string; id: string }) => `${m.provider}/${m.id}`,
        ),
        extensionCount: extensions.extensions.length,
        extensionNames: extensions.extensions.map(
          (e: { name?: string; path?: string }) => e.name || e.path,
        ),
        extensionErrors: extensions.errors,
        diagnostics: runtime.diagnostics,
      };
    }

    case 'get_auth_providers': {
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      const oauthProviders = authStorage.getOAuthProviders();
      const providers = oauthProviders.map((p) => {
        const status = authStorage.getAuthStatus(p.id);
        return {
          id: p.id,
          name: p.name,
          hasAuth: authStorage.hasAuth(p.id),
          authStatus: status,
        };
      });
      return { success: true, providers };
    }

    case 'login_oauth': {
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      const providerId = command.providerId;
      // Check if this is a registered OAuth provider
      const oauthProviders = authStorage.getOAuthProviders();
      const isOAuthProvider = oauthProviders.some((p) => p.id === providerId);
      if (!isOAuthProvider) {
        return {
          success: false,
          error: `"${providerId}" is not an OAuth provider. Use API key authentication instead.`,
        };
      }
      try {
        await authStorage.login(providerId, {
          onAuth: (info) => {
            if (dataPort) {
              dataPort.postMessage({ type: 'login_open_url', url: info.url });
            }
          },
          onPrompt: async () => {
            // For now, we don't support interactive prompts in Electron.
            // The callback server should handle the redirect automatically.
            return '';
          },
          onProgress: (message) => {
            if (dataPort) {
              dataPort.postMessage({ type: 'login_progress', message });
            }
          },
        });
        runtime.services.modelRegistry.refresh();
        if (dataPort) {
          dataPort.postMessage({ type: 'login_complete', providerId });
        }
        return { success: true };
      } catch (err) {
        const error = err instanceof Error ? err.message : String(err);
        if (dataPort) {
          dataPort.postMessage({ type: 'login_error', error });
        }
        return { success: false, error };
      }
    }

    case 'login_api_key': {
      if (!command.providerId?.trim() || !command.apiKey?.trim()) {
        return { success: false, error: 'Provider and API key must not be empty' };
      }
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      authStorage.set(command.providerId, { type: 'api_key', key: command.apiKey });
      runtime.services.modelRegistry.refresh();
      if (dataPort) {
        dataPort.postMessage({ type: 'login_complete', providerId: command.providerId });
      }
      return { success: true };
    }

    case 'logout': {
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      authStorage.logout(command.providerId);
      runtime.services.modelRegistry.refresh();
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown command: ${(command as { type: string }).type}` };
  }
}

function setupControlPortListener(port: Port): void {
  port.on('message', async (event: { data: unknown }) => {
    const data = event.data as ControlPortMessage;
    if ('id' in data && 'cmd' in data) {
      const req = data as PiRequest;
      try {
        const result = await handleCommand(req.cmd);
        const response: PiResult = { id: req.id, result };
        port.postMessage(response);
      } catch (err) {
        console.error(
          '[utility.controlPort] command failed:',
          req.cmd.type,
          err instanceof Error ? err.message : String(err),
        );
        const response: PiResult = {
          id: req.id,
          result: { success: false, error: err instanceof Error ? err.message : String(err) },
        };
        port.postMessage(response);
      }
    }
  });
  port.start();
}

// =============================================================================
// Session creation
// =============================================================================

function sendToMain(response: UtilityResponse): void {
  process.parentPort?.postMessage(response);
}

function prewarmSessionServices(cwds: string[]): void {
  for (const cwd of new Set(cwds)) {
    if (cwd) {
      void getServices(cwd);
    }
  }
}

async function createSession(cwd: string): Promise<void> {
  try {
    await setSessionProcessCwd(cwd);
    runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager: SessionManager.create(cwd),
    });
    await runtime.session.bindExtensions({});
    sendToMain({ type: 'session_created', sessionId: runtime.session.sessionId });
  } catch (err) {
    sendToMain({ type: 'session_error', error: err instanceof Error ? err.message : String(err) });
  }
}

async function resumeSession(sessionPath: string): Promise<void> {
  try {
    const sessionManager = SessionManager.open(sessionPath);
    const cwd = sessionManager.getCwd();
    await setSessionProcessCwd(cwd);
    runtime = await createAgentSessionRuntime(createRuntimeFactory, {
      cwd,
      agentDir: getAgentDir(),
      sessionManager,
    });
    await runtime.session.bindExtensions({});
    sendToMain({ type: 'session_created', sessionId: runtime.session.sessionId });
  } catch (err) {
    sendToMain({ type: 'session_error', error: err instanceof Error ? err.message : String(err) });
  }
}

function attachPorts(nextControlPort: Port, nextDataPort: Port): void {
  if (!runtime) {
    nextControlPort.close();
    nextDataPort.close();
    return;
  }

  unsubscribeEvents?.();
  batcher?.stop();
  controlPort?.close();
  dataPort?.close();

  controlPort = nextControlPort;
  dataPort = nextDataPort;
  setSessionBusy(runtime.session.isStreaming);
  batcher = new StreamBatcher();
  batcher.start(nextDataPort);
  unsubscribeEvents = subscribeToSession(runtime, nextDataPort, batcher);
  setupControlPortListener(nextControlPort);

  // Send session_ready as first push on the data port
  const session = runtime.session;
  const push: PiPush = {
    type: 'session_ready',
    model: session.model ? toModelInfo(session.model) : null,
    thinkingLevel: session.thinkingLevel,
    contextUsage: session.getContextUsage() ?? null,
    autoCompactionEnabled: session.autoCompactionEnabled,
  };
  nextDataPort.postMessage(push);
}

// =============================================================================
// Cleanup
// =============================================================================

function cleanup(): void {
  if (isCleanedUp) {
    return;
  }
  isCleanedUp = true;

  unsubscribeEvents?.();
  unsubscribeEvents = null;
  batcher?.stop();
  batcher = null;
  controlPort?.close();
  controlPort = null;
  dataPort?.close();
  dataPort = null;
  runtime?.dispose();
  runtime = null;
}

process.on('exit', cleanup);
process.on('SIGTERM', () => {
  cleanup();
  process.exit(0);
});

// =============================================================================
// Main listener (parentPort — lifecycle commands only)
// =============================================================================

process.parentPort?.on('message', async (messageEvent) => {
  const { data, ports } = messageEvent;
  // parentPort only receives UtilityCommand from main — safe narrowing
  const utilityCommand = data as UtilityCommand;

  switch (utilityCommand.type) {
    case 'create_session':
      await createSession(utilityCommand.cwd);
      break;
    case 'resume_session':
      await resumeSession(utilityCommand.sessionPath);
      break;
    case 'prewarm_session_services':
      prewarmSessionServices(utilityCommand.cwds);
      break;
    case 'attach_ports':
      if (ports.length > 1) {
        attachPorts(ports[0], ports[1]);
      }
      break;
  }
});
