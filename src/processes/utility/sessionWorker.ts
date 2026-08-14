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
// of scope by product decision. So this worker loads it at startup and
// rebuilds it on credential changes (login/logout) and on demand from the
// renderer (picker refresh).
//
// Self-healing rules, in order of escalation:
// - Every reload builds fresh services and is time-boxed end to end, so a
//   wedged SDK network call can never poison the reload chain (stale
//   outcomes are simply dropped).
// - The one network refresh per load is aborted for real via AbortController,
//   so a hung fetch settles instead of wedging the provider's coalesced
//   in-flight refresh for everyone.
// - If the catalog has never been published and services cannot be built,
//   the worker exits so main respawns a fresh process — the only guaranteed
//   way to clear an SDK network call that ignores abort signals.
// =============================================================================

// Upper bounds per load. The SDK's own reload path has no reliable timeout
// (refresh drops abort signals in some paths, and a provider's coalesced
// in-flight refresh ignores later signals), so these races are the real
// protection, with process restart as the final fallback. The services bound
// sits well above ModelRuntime.create's internal 15s refresh so a healthy
// but slow build is not mistaken for a wedge.
const CATALOG_SERVICES_TIMEOUT_MS = 30000;
const CATALOG_REFRESH_TIMEOUT_MS = 10000;

let catalogServices: AgentSessionServices | null = null;
// Dedup key of the last published catalog (sorted provider/id pairs).
let lastPublishedCatalogKey: string | null = null;
// Coalesced reload: concurrent requests join the in-flight reload instead of
// queueing behind it, so a burst (login + picker refresh) costs one rebuild.
let pendingReload: Promise<void> | null = null;
// Generation guard for process.cwd(): an abandoned timed-out build must not
// restore cwd over a newer build's registration (which pins cwd to agentDir).
let catalogBuildGeneration = 0;

function createCatalogServices(): Promise<AgentSessionServices> {
  const generation = ++catalogBuildGeneration;
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
      // Only the latest build may restore cwd: a superseded build that
      // settles late skips the restore (the newer build owns the cwd now).
      if (catalogBuildGeneration === generation) {
        process.chdir(previousCwd);
      }
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
 * (Re)build the catalog services and publish. Called at startup, on every
 * credentials change, and on picker refresh requests from the renderer.
 *
 * Every await inside is raced against a timeout so a hung SDK call can never
 * wedge the chain: the next reload builds fresh services regardless.
 */
async function performCatalogReload(): Promise<void> {
  const servicesPromise = createCatalogServices();
  servicesPromise.catch(() => {}); // handled via the race outcome below
  const servicesOutcome = await Promise.race([
    servicesPromise.then(
      (services) => ({ outcome: 'created' as const, services }),
      () => ({ outcome: 'failed' as const }),
    ),
    delay(CATALOG_SERVICES_TIMEOUT_MS).then(() => ({ outcome: 'timed_out' as const })),
  ]);

  if (servicesOutcome.outcome !== 'created') {
    console.error(
      `Failed to build model catalog services (${servicesOutcome.outcome}); ` +
        'a fresh reload will retry from scratch',
    );
    // Never published? The picker would be empty forever in this process,
    // and the hung SDK call cannot be cleared from the inside. Exit so main
    // respawns a fresh worker.
    if (lastPublishedCatalogKey === null) {
      process.exit(1);
    }
    // A catalog exists: keep serving it. The abandoned build (if it was a
    // hang rather than a failure) leaks one pending promise, but a hung
    // fetch is still bounded by Node's default socket timeouts and the next
    // reload starts a fresh build anyway.
    return;
  }

  const services = servicesOutcome.services;
  catalogServices = services;
  // Publish the local snapshot immediately so the picker renders from
  // disk-cached models (dynamic providers included) without waiting on
  // the network…
  publishCatalog(services.modelRuntime);

  // …then do the single network refresh per load, with a real abort: the
  // SDK's reloadConfig() takes no signal, but refresh() does. Aborting makes
  // a hung fetch settle instead of wedging the provider's coalesced
  // in-flight refresh for every later refresh in this process.
  const controller = new AbortController();
  const refreshPromise = services.modelRuntime.refresh({
    allowNetwork: true,
    signal: controller.signal,
  });
  const refreshOutcome = await Promise.race([
    refreshPromise.then(
      () => 'completed' as const,
      () => 'failed' as const,
    ),
    delay(CATALOG_REFRESH_TIMEOUT_MS).then(() => 'timed_out' as const),
  ]);
  if (refreshOutcome === 'timed_out') {
    controller.abort();
    // If the refresh still finishes late (some SDK paths ignore the abort),
    // publish the result then — unless a newer reload has taken over.
    void refreshPromise.then(
      () => {
        if (catalogServices === services) {
          publishCatalog(services.modelRuntime);
        }
      },
      () => {},
    );
  }
  if (refreshOutcome === 'failed') {
    console.error('Model catalog refresh failed; serving the local snapshot');
  }
  // Publish whatever the refresh produced (including a partial result).
  if (catalogServices === services) {
    publishCatalog(services.modelRuntime);
  }
}

/** Coalesced reload: concurrent requests join the in-flight one. */
function reloadCatalog(): Promise<void> {
  pendingReload ??= performCatalogReload().finally(() => {
    pendingReload = null;
  });
  return pendingReload;
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
