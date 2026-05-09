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
} from '@mariozechner/pi-coding-agent';
import type {
  ModelInfo,
  PiCommand,
  PiPush,
  PiRequest,
  PiResult,
  ControlPortMessage,
  StreamBatch,
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
  private batch: StreamBatch = { type: 'stream_batch' };
  private dirty = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private port: Port | null = null;

  start(port: Port): void {
    this.port = port;
    this.timer = setInterval(() => this.flush(), 16);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.flush();
  }

  appendText(id: string, delta: string): void {
    if (!this.batch.text) this.batch.text = {};
    this.batch.text[id] = (this.batch.text[id] || '') + delta;
    this.dirty = true;
  }

  appendThinking(id: string, delta: string): void {
    if (!this.batch.thinking) this.batch.thinking = {};
    this.batch.thinking[id] = (this.batch.thinking[id] || '') + delta;
    this.dirty = true;
  }

  setToolOutput(id: string, output: string): void {
    if (!this.batch.toolOutput) this.batch.toolOutput = {};
    this.batch.toolOutput[id] = output;
    this.dirty = true;
  }

  private flush(): void {
    if (!this.dirty || !this.port) return;
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
    const msg: PiPush = { type: 'status_sync', isStreaming: isBusy };
    dataPort.postMessage(msg);
  }
}

function subscribeToSession(rt: AgentSessionRuntime, port: Port, batch: StreamBatcher): () => void {
  const session = rt.session;
  let currentAssistantId: string | null = null;

  function push(msg: PiPush): void {
    port.postMessage(msg);
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
        const msg = (event as { message?: { role?: string; id?: string } }).message;
        if (msg?.role === 'assistant') {
          currentAssistantId = msg.id || null;
        }
        push({ type: 'event', event });
        break;
      }

      case 'message_update': {
        const ame = (event as { assistantMessageEvent?: { type: string; delta?: string } })
          .assistantMessageEvent;
        if (ame && currentAssistantId) {
          if (ame.type === 'text_delta' && ame.delta) {
            batch.appendText(currentAssistantId, ame.delta);
            return;
          }
          if (ame.type === 'thinking_delta' && ame.delta) {
            batch.appendThinking(currentAssistantId, ame.delta);
            return;
          }
        }
        push({ type: 'event', event });
        break;
      }

      case 'message_end':
        currentAssistantId = null;
        push({ type: 'event', event });
        break;

      case 'tool_execution_update': {
        const toolEvent = event as {
          toolCallId?: string;
          partialResult?: { content?: Array<{ text?: string }> };
        };
        const text = toolEvent.partialResult?.content?.[0]?.text;
        if (text && toolEvent.toolCallId) {
          batch.setToolOutput(toolEvent.toolCallId, text);
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

async function handleCommand(cmd: PiCommand): Promise<unknown> {
  if (!runtime) return { success: false, error: 'session not initialized' };

  switch (cmd.type) {
    case 'prompt': {
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'prompt must be a non-empty string' };
      }
      runtime.session.prompt(cmd.message).catch((err) => {
        if (dataPort) {
          const msg: PiPush = {
            type: 'error',
            error: err instanceof Error ? err.message : String(err),
          };
          dataPort.postMessage(msg);
        }
      });
      return { success: true };
    }

    case 'steer': {
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'steer message must be a non-empty string' };
      }
      await runtime.session.steer(cmd.message);
      return { success: true };
    }

    case 'follow_up': {
      if (!cmd.message || cmd.message.trim().length === 0) {
        return { success: false, error: 'follow_up message must be a non-empty string' };
      }
      await runtime.session.followUp(cmd.message);
      return { success: true };
    }

    case 'clear_queue': {
      const { steering, followUp } = runtime.session.clearQueue();
      return { success: true, steering, followUp };
    }

    case 'abort':
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
      };
    }

    case 'get_messages':
      return runtime.session.messages;

    case 'get_session_options': {
      const session = runtime.session;
      const scopedModels = session.scopedModels.filter((scoped) =>
        session.modelRegistry.hasConfiguredAuth(scoped.model),
      );
      const models =
        scopedModels.length > 0
          ? scopedModels.map((scoped) => toModelInfo(scoped.model))
          : (await session.modelRegistry.getAvailable()).map(toModelInfo);
      return {
        models,
        thinkingLevels: session.getAvailableThinkingLevels(),
      };
    }

    case 'list_sessions': {
      return cmd.cwd ? await SessionManager.list(cmd.cwd) : await SessionManager.listAll();
    }

    case 'cycle_model':
      return await runtime.session.cycleModel();

    case 'cycle_thinking_level':
      return runtime.session.cycleThinkingLevel();

    case 'set_model': {
      const model = runtime.session.modelRegistry.find(cmd.provider, cmd.modelId);
      if (!model) {
        return { success: false, error: `model not found: ${cmd.provider}/${cmd.modelId}` };
      }
      await runtime.session.setModel(model);
      return { success: true };
    }

    case 'set_thinking_level':
      runtime.session.setThinkingLevel(cmd.level);
      return { success: true };

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
      const providerId = cmd.providerId;
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
      if (!cmd.providerId?.trim() || !cmd.apiKey?.trim()) {
        return { success: false, error: 'Provider and API key must not be empty' };
      }
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      authStorage.set(cmd.providerId, { type: 'api_key', key: cmd.apiKey });
      runtime.services.modelRegistry.refresh();
      if (dataPort) {
        dataPort.postMessage({ type: 'login_complete', providerId: cmd.providerId });
      }
      return { success: true };
    }

    case 'logout': {
      const authStorage = runtime.services.modelRegistry?.authStorage;
      if (!authStorage) {
        return { success: false, error: 'Auth storage not initialized' };
      }
      authStorage.logout(cmd.providerId);
      runtime.services.modelRegistry.refresh();
      return { success: true };
    }

    default:
      return { success: false, error: `Unknown command: ${(cmd as { type: string }).type}` };
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

function sendToMain(msg: UtilityResponse): void {
  process.parentPort?.postMessage(msg);
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
  const cmd = data as UtilityCommand;

  switch (cmd.type) {
    case 'create_session':
      await createSession(cmd.cwd);
      break;
    case 'resume_session':
      await resumeSession(cmd.sessionPath);
      break;
    case 'prewarm_session_services':
      prewarmSessionServices(cmd.cwds);
      break;
    case 'attach_ports':
      if (ports.length > 1) {
        attachPorts(ports[0], ports[1]);
      }
      break;
  }
});
