import {
  type AgentSessionServices,
  createAgentSessionServices,
  getAgentDir,
  type ModelRuntime,
  type SessionInfo,
  SessionManager,
  SettingsManager,
} from '@earendil-works/pi-coding-agent';
import type {
  PiSessionInfo,
  SessionWorkerCommand,
  SessionWorkerResponse,
  ThinkingLevel,
} from '../../shared/ipcContract';
import { toModelInfo } from '../../shared/modelInfo';

function sendToMain(response: SessionWorkerResponse): void {
  process.parentPort?.postMessage(response);
}

// =============================================================================
// Model catalog
//
// The catalog is a property of the user environment (user-level extensions
// register providers; credentials live in agentDir/auth.json), not of the
// active project — project-level extensions that register providers are out
// of scope by product decision. So this worker loads it exactly once at
// startup and rebuilds it only when credentials change (login/logout). There
// is no cwd coordination, no query-triggered refresh, and no retry loop: a
// picker that misses a dynamic provider due to a network blip recovers on the
// next app launch or login, with the on-disk models cache as the fallback.
// =============================================================================

// Upper bound for the one network refresh per load, so a stalled provider
// (the SDK reload has no network timeout) cannot wedge the reload chain.
const CATALOG_REFRESH_TIMEOUT_MS = 10000;

let catalogServices: AgentSessionServices | null = null;
// Dedup key of the last published catalog (sorted provider/id pairs).
let lastPublishedCatalogKey: string | null = null;
// Serializes reloads: a login burst may fire several credentials_changed.
let reloadChain: Promise<void> = Promise.resolve();

function createCatalogServices(): Promise<AgentSessionServices> {
  return (async () => {
    const agentDir = getAgentDir();
    const previousCwd = process.cwd();
    try {
      // cwd is pinned to agentDir: agentDir has no `.pi/` subdirectory, so
      // project-level discovery (settings/extensions) is empty by
      // construction and the catalog stays purely user-level. Some pi
      // extensions read process.cwd() while they register; match the SDK cwd
      // during service construction (same pattern as piAgent.ts).
      process.chdir(agentDir);
      return await createAgentSessionServices({
        cwd: agentDir,
        agentDir,
        settingsManager: SettingsManager.create(agentDir, agentDir),
        // Only providers/models are needed here; skip every other resource
        // scan (skills, prompt templates, themes, context files).
        resourceLoaderOptions: {
          noSkills: true,
          noPromptTemplates: true,
          noThemes: true,
          noContextFiles: true,
        },
      });
    } finally {
      process.chdir(previousCwd);
    }
  })();
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Publish the current snapshot to main, but only when it actually changed. */
function publishCatalog(modelRuntime: ModelRuntime): void {
  const models = modelRuntime.getAvailableSnapshot().map(toModelInfo);
  // Sort for order-insensitivity, then stringify the full entries so any
  // field change (not just the provider/id set) counts as a catalog change.
  const key = JSON.stringify(
    [...models].sort((a, b) => `${a.provider}/${a.id}`.localeCompare(`${b.provider}/${b.id}`)),
  );
  if (key === lastPublishedCatalogKey) {
    return;
  }
  lastPublishedCatalogKey = key;
  sendToMain({ type: 'catalog_updated', models });
}

/**
 * (Re)build the catalog services and publish. Called once at startup and on
 * every credentials change (the in-memory auth snapshot is not re-read from
 * disk by refresh(), so a rebuild is the reliable way to pick up logins).
 */
async function reloadCatalog(): Promise<void> {
  reloadChain = reloadChain.then(async () => {
    try {
      const services = await createCatalogServices();
      catalogServices = services;
      // Publish the local snapshot immediately so the picker renders from
      // disk-cached models (dynamic providers included) without waiting on
      // the network…
      publishCatalog(services.modelRuntime);
      // …then do the single network refresh per load (equivalent to the old
      // warm-up behavior). Time-boxed so a stalled provider cannot wedge the
      // reload chain; if it finishes late anyway, publish the result then.
      const refresh = services.modelRuntime.reloadConfig().catch(() => {});
      const outcome = await Promise.race([
        refresh.then(() => 'completed' as const),
        delay(CATALOG_REFRESH_TIMEOUT_MS).then(() => 'timed_out' as const),
      ]);
      if (outcome === 'timed_out') {
        void refresh.then(() => {
          if (catalogServices === services) {
            publishCatalog(services.modelRuntime);
          }
        });
      }
      if (catalogServices === services) {
        publishCatalog(services.modelRuntime);
      }
    } catch (error) {
      // Keep serving the last published catalog; the next reload retries.
      console.error('Failed to load model catalog services:', error);
    }
  });
  await reloadChain;
}

function serializeSessionInfo(session: SessionInfo): PiSessionInfo {
  return {
    path: session.path,
    id: session.id,
    cwd: session.cwd,
    name: session.name,
    parentSessionPath: session.parentSessionPath,
    created: session.created.toISOString(),
    modified: session.modified.toISOString(),
    messageCount: session.messageCount,
    firstMessage: session.firstMessage,
    allMessagesText: session.allMessagesText,
  };
}

async function listProjectSessions(requestId: string, cwd: string): Promise<void> {
  try {
    const sessions = await SessionManager.list(cwd);
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: true,
      sessions: sessions.map(serializeSessionInfo),
    });
  } catch (error) {
    sendToMain({
      type: 'project_sessions_chunk',
      requestId,
      cwd,
      success: false,
      error: error instanceof Error ? error.message : String(error),
    });
  }
}

process.parentPort?.on('message', async (messageEvent) => {
  // parentPort only receives SessionWorkerCommand from main — safe narrowing
  const command: SessionWorkerCommand = messageEvent.data;

  switch (command.type) {
    case 'list_project_sessions': {
      await Promise.all(command.cwds.map((cwd) => listProjectSessions(command.requestId, cwd)));
      break;
    }
    case 'reload_catalog': {
      await reloadCatalog();
      break;
    }
    case 'rename_session': {
      const trimmedName = command.name?.trim();
      if (!trimmedName) {
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: false,
          error: 'name must be a non-empty string',
        });
        break;
      }
      try {
        const sessionManager = SessionManager.open(command.sessionPath);
        sessionManager.appendSessionInfo(trimmedName);
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: true,
        });
      } catch (error) {
        sendToMain({
          type: 'rename_session_result',
          requestId: command.requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
    case 'read_session_messages': {
      try {
        const sessionManager = SessionManager.open(command.sessionPath);
        const { messages, thinkingLevel, model } = sessionManager.buildSessionContext();
        const entries = sessionManager.getEntries();
        // Attach outer (persistence) timestamp from entries to each regular
        // LLM message so the renderer can compute real thinking duration.
        // buildSessionContext pushes entry.message directly for message-type
        // entries, so they share the same object reference.
        const msgSet = new Set(messages);
        for (const entry of entries) {
          if (entry.type === 'message' && msgSet.has(entry.message)) {
            (entry.message as unknown as Record<string, unknown>).pigiPersistedAt = entry.timestamp;
          }
        }
        const compactionCount = entries.filter((entry) => entry.type === 'compaction').length;
        sendToMain({
          type: 'session_messages_result',
          requestId: command.requestId,
          success: true,
          messages,
          compactionCount,
          thinkingLevel: thinkingLevel as ThinkingLevel,
          model,
        });
      } catch (error) {
        sendToMain({
          type: 'session_messages_result',
          requestId: command.requestId,
          success: false,
          error: error instanceof Error ? error.message : String(error),
        });
      }
      break;
    }
  }
});

// Load and publish the model catalog as soon as the worker starts. The main
// process caches and rebroadcasts it, so renderer timing does not matter.
void reloadCatalog();
