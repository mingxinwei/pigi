import { useEffect, useCallback, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import { toast } from 'sonner';
import { useAppStore, type SessionEntry } from './state/appStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { detectPlatform } from './lib/platform';
import {
  disposeTranscriptSession,
  ensureTranscriptSession,
  getTranscriptController,
  markSessionHydrated,
  useTranscript,
} from './hooks/useTranscript';
import { TranscriptController } from './state/transcriptController';
import {
  resumeSession,
  createSession,
  prompt,
  steer,
  abort,
  compact,
  getProjects,
  getGitBranch,
  getState,
  getSessionOptions,
  getAuthProviders,
  loginOAuth,
  loginApiKey,
  logout,
  followUp,
  clearQueue,
  listProjectSessions,
  onProjectSessionsChunk,
  openProjectDirectory,
  setActiveProject,
  touchSession,
  setModel,
  setThinkingLevel,
  removeProject,
  reorderProjects,
  renameSession,
  readSessionMessages,
  getWarmSessionOptions,
} from './services/piAgentClient';
import type {
  AuthProviderInfo,
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
  SkillSlashCommand,
  ThinkingLevel,
} from '../../shared/ipcContract';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import StreamingQueue from './components/StreamingQueue';
import LoginDialog from './components/LoginDialog';
import SessionSwitcher from './components/SessionSwitcher';
import { SidebarProvider } from './components/ui/sidebar';
import { Empty, EmptyTitle, EmptyDescription, EmptyHeader } from './components/ui/empty';

const WELCOME_TITLE = 'Welcome to pigi';

function App(): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(244);
  // Used only for immediate sidebar feedback while a persisted session is resuming.
  const [pendingSelectedPath, setPendingSelectedPath] = useState<string | null>(null);
  const {
    activeSessionPath,
    sessions,
    addSession,
    addSessionEntry,
    setActiveSession,
    removeSession,
    activeProject,
    recentProjects,
    projectSessions,
    setProjectSessionList,
    navigationBackStack,
    navigationForwardStack,
    pushNavigationHistory,
    removeFromNavigationHistory,
  } = useAppStore();

  const [switcherOpen, setSwitcherOpen] = useState(false);
  const [switcherAutoPreselect, setSwitcherAutoPreselect] = useState(false);

  const activeSession = activeSessionPath ? (sessions.get(activeSessionPath) ?? null) : null;
  const activeCwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd();
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [thinkingLevelOptions, setThinkingLevelOptions] = useState<ThinkingLevel[]>([]);
  const [skillOptions, setSkillOptions] = useState<SkillSlashCommand[]>([]);
  const selectedSessionPath = pendingSelectedPath ?? activeSessionPath ?? null;
  const { state: transcript, controller: transcriptControllerRef } =
    useTranscript(activeSessionPath);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const lastModelRef = useRef<{ provider: string; id: string } | null>(null);
  const lastThinkingLevelRef = useRef<ThinkingLevel | null>(null);
  // State mirrors of refs for render access (updated alongside refs).
  const [lastModelSnapshot, setLastModelSnapshot] = useState<{
    provider: string;
    id: string;
  } | null>(null);
  const [lastThinkingLevelSnapshot, setLastThinkingLevelSnapshot] = useState<ThinkingLevel | null>(
    null,
  );

  // Draft chat: shown immediately on "new", no process/session until first message.
  const [isDraftChat, setIsDraftChat] = useState(false);
  const draftControllerRef = useRef(new TranscriptController());
  // True while the draft's createSession is in-flight (prevents duplicate spawns).
  const [isDraftSpawning, setIsDraftSpawning] = useState(false);
  const isDraftSpawningRef = useRef(false);
  const draftSubscribe = useCallback(
    (onStoreChange: () => void) => draftControllerRef.current.subscribe(onStoreChange),
    [],
  );
  const draftGetSnapshot = useCallback(() => draftControllerRef.current.state, []);
  const draftState = useSyncExternalStore(draftSubscribe, draftGetSnapshot);
  const isDraftEmpty = draftState.nodes.length === 0;

  // Synthetic session entry for draft mode — provides model/thinking display.
  const draftSession = useMemo((): SessionEntry | null => {
    if (!isDraftChat) return null;
    const resolvedModel =
      lastModelSnapshot && modelOptions.length > 0
        ? (modelOptions.find(
            (m) => m.id === lastModelSnapshot.id && m.provider === lastModelSnapshot.provider,
          ) ?? null)
        : null;
    return {
      sessionPath: '',
      persistedSessionId: '',
      status: 'idle' as const,
      title: '',
      cwd: activeCwd,
      createdAt: '',
      model: resolvedModel,
      thinkingLevel: lastThinkingLevelSnapshot,
      contextUsage: null,
      autoCompactionEnabled: false,
      messageCount: 0,
      error: null,
    };
  }, [isDraftChat, modelOptions, activeCwd, lastModelSnapshot, lastThinkingLevelSnapshot]);

  // Pending prompt buffer: holds messages sent before the utility process is ready.
  const pendingPromptsRef = useRef<Map<string, string[]>>(new Map());
  // Tracks sessions whose utility process is still spawning.
  const pendingResumesRef = useRef<Set<string>>(new Set());

  const refreshSessionState = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const sessionState = await getState(sessionId);
      useAppStore.getState().updateSession(sessionId, {
        model: sessionState.model,
        thinkingLevel: sessionState.thinkingLevel,
        contextUsage: sessionState.contextUsage,
        autoCompactionEnabled: sessionState.autoCompactionEnabled,
        messageCount: sessionState.messageCount,
      });
      // Track last-used model/thinking for draft mode fallback
      if (sessionState.model) {
        lastModelRef.current = {
          provider: sessionState.model.provider,
          id: sessionState.model.id,
        };
        setLastModelSnapshot({ provider: sessionState.model.provider, id: sessionState.model.id });
      }
      if (sessionState.thinkingLevel) {
        lastThinkingLevelRef.current = sessionState.thinkingLevel;
        setLastThinkingLevelSnapshot(sessionState.thinkingLevel);
      }
    } catch (err) {
      console.error('Failed to refresh session state:', err);
    }
  }, []);

  const refreshSessionOptions = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const options = await getSessionOptions(sessionId);
      setModelOptions(options.models);
      setThinkingLevelOptions(options.thinkingLevels);
      setSkillOptions(options.skills);
    } catch (err) {
      console.error('Failed to refresh session options:', err);
      setModelOptions([]);
      setThinkingLevelOptions([]);
      setSkillOptions([]);
    }
  }, []);

  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault();
      const startX = event.clientX;
      const startWidth = sidebarWidth;

      function handlePointerMove(moveEvent: PointerEvent): void {
        const nextWidth = Math.min(360, Math.max(220, startWidth + moveEvent.clientX - startX));
        setSidebarWidth(nextWidth);
      }

      function handlePointerUp(): void {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      }

      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [sidebarWidth],
  );

  const refreshProjectSessions = useCallback(
    async (projects: ProjectDirectory[]): Promise<void> => {
      await listProjectSessions(projects.map((project) => project.path));
    },
    [],
  );

  useEffect(() => {
    useAppStore.getState().setPlatform(detectPlatform());
  }, []);

  useEffect(() => {
    return onProjectSessionsChunk((chunk) => {
      if (chunk.success) {
        setProjectSessionList(chunk.cwd, chunk.sessions ?? []);
        // Seed lastModel/thinkingLevel from the first available session on first load.
        if (!lastModelRef.current && chunk.sessions && chunk.sessions.length > 0) {
          void readSessionMessages(chunk.sessions[0].path)
            .then((result) => {
              if (result.model && !lastModelRef.current) {
                lastModelRef.current = {
                  provider: result.model.provider,
                  id: result.model.modelId,
                };
                setLastModelSnapshot({
                  provider: result.model.provider,
                  id: result.model.modelId,
                });
              }
              if (result.thinkingLevel && !lastThinkingLevelRef.current) {
                lastThinkingLevelRef.current = result.thinkingLevel as ThinkingLevel;
                setLastThinkingLevelSnapshot(result.thinkingLevel as ThinkingLevel);
              }
            })
            .catch(() => {});
        }
      }
    });
  }, [setProjectSessionList]);

  useEffect(() => {
    void getProjects().then((result) => {
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
        void refreshProjectSessions(result.recentProjects);
      }
    });
  }, [refreshProjectSessions]);

  useEffect(() => {
    if (!activeSessionPath) {
      return;
    }
    useAppStore.getState().updateSession(activeSessionPath, { status: transcript.status });
    // Defer to next frame to avoid cascading renders from the async setState chain
    const frame = requestAnimationFrame(() => {
      void refreshSessionState(activeSessionPath);
    });
    return () => cancelAnimationFrame(frame);
  }, [activeSessionPath, refreshSessionState, transcript.status]);

  useEffect(() => {
    if (!activeSessionPath) {
      return;
    }

    let cancelled = false;
    void getSessionOptions(activeSessionPath)
      .then((options) => {
        if (cancelled) {
          return;
        }
        setModelOptions(options.models);
        setThinkingLevelOptions(options.thinkingLevels);
        setSkillOptions(options.skills);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to refresh session options:', err);
        setModelOptions([]);
        setThinkingLevelOptions([]);
        setSkillOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionPath]);

  const refreshGitBranch = useCallback(async () => {
    const result = await getGitBranch(activeCwd);
    setGitBranch(result.success ? result.branch : null);
  }, [activeCwd]);

  const isIdle = transcript.status === 'idle';
  useEffect(() => {
    if (!isIdle) {
      return;
    }
    let cancelled = false;
    getGitBranch(activeCwd).then((result) => {
      if (!cancelled) {
        setGitBranch(result.success ? result.branch : null);
      }
    });
    return () => {
      cancelled = true;
    };
  }, [activeCwd, isIdle]);

  useEffect(() => {
    return window.piApi.onProcessExit(({ sessionPath }) => {
      disposeTranscriptSession(sessionPath);
      removeFromNavigationHistory(sessionPath);
      removeSession(sessionPath);
    });
  }, [removeSession, removeFromNavigationHistory]);
  useEffect(() => {
    if (!activeSessionPath) {
      return;
    }
    void touchSession(activeSessionPath);
  }, [activeSessionPath]);

  // Register a callback so the controller can replay compaction-queued messages
  // on the correct session, even if the user switches sessions mid-compaction.
  useEffect(() => {
    if (!activeSessionPath) return;
    transcriptControllerRef.current?.setCompactionReplayCallback(
      activeSessionPath,
      (sessionId, queue) => {
        void (async () => {
          const first = queue[0];
          if (!first.text.startsWith('/skill:')) {
            ensureTranscriptSession(sessionId).addUserMessage(first.text);
          }
          await prompt(sessionId, first.text);
          for (let i = 1; i < queue.length; i++) {
            if (queue[i].mode === 'steer') {
              await steer(sessionId, queue[i].text);
            } else {
              await followUp(sessionId, queue[i].text);
            }
          }
        })();
      },
    );
  }, [activeSessionPath, transcriptControllerRef]);

  async function handleSend(message: string): Promise<void> {
    const cwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd();

    // Draft chat: first message triggers session creation in background.
    if (isDraftChat || !activeSessionPath) {
      // Show optimistic user message on the draft controller
      draftControllerRef.current.addUserMessage(message);

      // If already spawning (user typed multiple messages fast), just buffer
      if (isDraftSpawningRef.current) {
        return;
      }
      isDraftSpawningRef.current = true;
      setIsDraftSpawning(true);
      setIsDraftChat(true);

      try {
        const sessionPath = await createSession(cwd);
        addSession(sessionPath, cwd);
        useAppStore.getState().updateSession(sessionPath, { title: message });

        // Transfer draft controller content to the real session.
        // Draft only contains UserNodes (optimistic messages), so we just add them.
        const controller = getTranscriptController(sessionPath);
        const draftNodes = draftControllerRef.current.state.nodes;
        for (const node of draftNodes) {
          if (node.role === 'user') {
            controller.addUserMessage(node.text);
          }
        }
        markSessionHydrated(sessionPath);
        ensureTranscriptSession(sessionPath);

        // Apply last-used model and thinking level
        if (lastModelRef.current) {
          void setModel(sessionPath, lastModelRef.current.provider, lastModelRef.current.id).catch(
            () => {},
          );
        }
        if (lastThinkingLevelRef.current) {
          void setThinkingLevel(sessionPath, lastThinkingLevelRef.current).catch(() => {});
        }

        // Transition out of draft
        setIsDraftChat(false);
        isDraftSpawningRef.current = false;
        setIsDraftSpawning(false);
        controller.setStatus('streaming');
        pushNavigationHistory(sessionPath);
        setActiveSession(sessionPath);

        // Send the prompt (and any additional messages typed while spawning)
        const messages = draftNodes
          .filter(
            (n): n is { id: string; role: 'user'; text: string; sentAt: number } =>
              n.role === 'user',
          )
          .map((n) => n.text);

        if (messages.length > 0) {
          await prompt(sessionPath, messages[0]);
          for (let i = 1; i < messages.length; i++) {
            await steer(sessionPath, messages[i]);
          }
        }
      } catch (err) {
        console.error('Failed to create session from draft:', err);
        isDraftSpawningRef.current = false;
        setIsDraftSpawning(false);
        toast.error('Failed to create session. Please try again.');
      }
      return;
    }

    // Normal session flow (session already exists)
    const sessionPath = activeSessionPath;
    const existing = useAppStore.getState().sessions.get(sessionPath);
    if (existing?.title === 'New chat') {
      useAppStore.getState().updateSession(sessionPath, { title: message });
    }

    // If the session is still pending (utility process not ready), buffer the prompt
    if (pendingResumesRef.current.has(sessionPath)) {
      const queue = pendingPromptsRef.current.get(sessionPath) ?? [];
      queue.push(message);
      pendingPromptsRef.current.set(sessionPath, queue);
      getTranscriptController(sessionPath).addUserMessage(message);
      return;
    }

    // Queue locally during compaction
    if (transcript.isCompacting) {
      transcriptControllerRef.current?.addCompactionMessage(message, 'steer');
      void listProjectSessions([cwd]);
      return;
    }

    // If the session is already streaming, steer instead of prompting
    if (transcript.status !== 'idle') {
      await steer(sessionPath, message);
    } else {
      if (!message.startsWith('/skill:')) {
        ensureTranscriptSession(sessionPath).addUserMessage(message);
      }
      await prompt(sessionPath, message);
    }
    void listProjectSessions([cwd]);
  }

  const handleFollowUp = useCallback(
    async (message: string): Promise<void> => {
      const sessionId = activeSessionPath;
      if (!sessionId) return;

      // Queue locally during compaction.
      if (transcript.isCompacting) {
        transcriptControllerRef.current?.addCompactionMessage(message, 'followUp');
        return;
      }

      if (transcript.status !== 'idle') {
        await followUp(sessionId, message);
      } else {
        ensureTranscriptSession(sessionId).addUserMessage(message);
        await prompt(sessionId, message);
      }
    },
    [activeSessionPath, transcript.status, transcript.isCompacting, transcriptControllerRef],
  );

  const handleAbort = useCallback(async () => {
    if (!activeSessionPath) {
      return;
    }
    // If session is still pending (process not ready), just clear the buffered prompts
    if (pendingResumesRef.current.has(activeSessionPath)) {
      const bufferedMessages = pendingPromptsRef.current.get(activeSessionPath);
      pendingPromptsRef.current.delete(activeSessionPath);
      if (bufferedMessages && bufferedMessages.length > 0) {
        // Remove all optimistic user messages
        for (let i = 0; i < bufferedMessages.length; i++) {
          getTranscriptController(activeSessionPath).removeLastUserMessage();
        }
        setRestoreText(bufferedMessages.join('\n\n'));
      }
      return;
    }
    // Clear local queue state to prevent false delivery detection
    transcriptControllerRef.current?.clearLocalQueue();
    // Clear queued messages and restore them to input
    const result = await clearQueue(activeSessionPath);
    let queued = [...(result.steering ?? []), ...(result.followUp ?? [])];
    // Fallback: use local transcript state if clearQueue returned nothing
    if (queued.length === 0) {
      const ts = ensureTranscriptSession(activeSessionPath).state;
      queued = [...ts.queuedSteering, ...ts.queuedFollowUp];
    }
    await abort(activeSessionPath);
    if (queued.length > 0) {
      setRestoreText(queued.join('\n\n'));
    }
  }, [activeSessionPath, transcriptControllerRef]);

  const handleEditQueuedMessage = useCallback(
    async (type: 'steer' | 'followUp', index: number) => {
      if (!activeSessionPath) return;
      // Clear local queue state to prevent false delivery detection
      transcriptControllerRef.current?.clearLocalQueue();
      try {
        const result = await clearQueue(activeSessionPath);
        const steeringMessages = [...(result.steering ?? [])];
        const followUpMessages = [...(result.followUp ?? [])];
        const editedMessage =
          type === 'steer'
            ? steeringMessages.splice(index, 1)[0]
            : followUpMessages.splice(index, 1)[0];
        // Re-queue remaining
        for (const message of steeringMessages) await steer(activeSessionPath, message);
        for (const message of followUpMessages) await followUp(activeSessionPath, message);
        // Restore edited message to input
        if (editedMessage) setRestoreText(editedMessage);
      } catch (err) {
        console.error('Failed to edit queued message:', err);
      }
    },
    [activeSessionPath, transcriptControllerRef],
  );

  const handleRestoredText = useCallback(() => setRestoreText(null), []);

  // Global Escape key to abort streaming
  useEffect(() => {
    function handleKeyDown(e: KeyboardEvent): void {
      if (e.key === 'Escape' && transcript.status !== 'idle') {
        handleAbort();
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [handleAbort, transcript.status]);

  /** Enter draft chat mode — instant, no process spawned. */
  const handleNewSession = useCallback((): void => {
    // If already in draft mode, do nothing.
    if (isDraftChat && !activeSessionPath) return;
    // Push current active session to navigation history so it's not lost.
    // Pass empty string as sentinel (no real session path is empty) so the
    // current activeSessionPath gets pushed to backStack.
    pushNavigationHistory('');
    // Reset draft controller for a fresh chat.
    draftControllerRef.current.reset();
    isDraftSpawningRef.current = false;
    setIsDraftSpawning(false);
    setActiveSession(null);
    setIsDraftChat(true);
    setPendingSelectedPath(null);
    // Fetch model info from warm process (retry if not ready yet, max 10 attempts)
    let warmRetryCount = 0;
    const fetchWarmOptions = (): void => {
      void getWarmSessionOptions().then((options) => {
        if (options.models.length > 0) {
          setModelOptions(options.models);
          // Derive thinkingLevels from the last-used model if available
          const matchedModel = lastModelRef.current
            ? options.models.find(
                (m) =>
                  m.id === lastModelRef.current!.id &&
                  m.provider === lastModelRef.current!.provider,
              )
            : null;
          if (matchedModel) {
            setThinkingLevelOptions(matchedModel.thinkingLevels);
          } else {
            // Fallback: use first model's thinkingLevels
            setThinkingLevelOptions(options.models[0].thinkingLevels);
          }
        }
        // If empty, warm process isn't ready yet — retry after a short delay
        if (options.models.length === 0 && warmRetryCount < 10) {
          warmRetryCount++;
          setTimeout(fetchWarmOptions, 500);
        }
      });
    };
    fetchWarmOptions();
  }, [isDraftChat, activeSessionPath, pushNavigationHistory, setActiveSession]);

  function handleNewSessionForProject(path: string): void {
    const result = setActiveProject(path);
    void result.then((r) => {
      if (r.success) {
        useAppStore.getState().setProjects(r.recentProjects, r.activeProject);
      }
    });
    handleNewSession();
  }

  const handleResumeSession = useCallback(
    async (session: PiSessionInfo, options?: { skipHistory?: boolean }): Promise<void> => {
      setIsDraftChat(false);
      setPendingSelectedPath(session.path);

      // Switch active project to match the session's project directory
      const store = useAppStore.getState();
      if (store.activeProject?.path !== session.cwd) {
        const projectResult = await setActiveProject(session.cwd);
        if (projectResult.success) {
          store.setProjects(projectResult.recentProjects, projectResult.activeProject);
        }
      }

      const existing = store.sessions.get(session.path);
      if (existing) {
        if (!options?.skipHistory) {
          pushNavigationHistory(existing.sessionPath);
        }
        setPendingSelectedPath(null);
        setActiveSession(existing.sessionPath);
        return;
      }

      const sessionPath = session.path;

      addSessionEntry({
        sessionPath,
        persistedSessionId: session.id,
        status: 'idle',
        title: session.name ?? session.firstMessage,
        cwd: session.cwd,
        createdAt: session.created,
        model: null,
        thinkingLevel: null,
        contextUsage: null,
        autoCompactionEnabled: false,
        messageCount: session.messageCount,
        error: null,
      });
      // Mark as hydrated so useTranscript doesn't try getMessages via port
      markSessionHydrated(sessionPath);
      pendingResumesRef.current.add(sessionPath);

      // Hydrate transcript from session file (fast path, no utility process needed)
      try {
        const { messages, compactionCount, thinkingLevel, model } =
          await readSessionMessages(sessionPath);
        const controller = getTranscriptController(sessionPath);
        controller.hydrate(messages, compactionCount);
        if (model) {
          const matchedModel = modelOptions.find(
            (m) => m.id === model.modelId && m.provider === model.provider,
          );
          useAppStore.getState().updateSession(sessionPath, {
            thinkingLevel: thinkingLevel as ThinkingLevel,
            ...(matchedModel ? { model: matchedModel } : {}),
          });
        } else {
          useAppStore
            .getState()
            .updateSession(sessionPath, { thinkingLevel: thinkingLevel as ThinkingLevel });
        }
      } catch (err) {
        console.error('Failed to hydrate session from file:', err);
      }

      // Show the session — messages and metadata are ready
      if (!options?.skipHistory) {
        pushNavigationHistory(sessionPath);
      }
      setActiveSession(sessionPath);
      setPendingSelectedPath(null);

      // Spawn utility process in background
      try {
        await resumeSession(sessionPath);
        pendingResumesRef.current.delete(sessionPath);

        // Wire up live subscriptions (port is now available under sessionPath)
        ensureTranscriptSession(sessionPath);

        // Fetch session options and state from the process
        void refreshSessionState(sessionPath);
        void getSessionOptions(sessionPath)
          .then((options) => {
            setModelOptions(options.models);
            setThinkingLevelOptions(options.thinkingLevels);
            setSkillOptions(options.skills);
          })
          .catch(() => {});
        void touchSession(sessionPath);

        // Flush any pending prompts
        const bufferedMessages = pendingPromptsRef.current.get(sessionPath);
        if (bufferedMessages && bufferedMessages.length > 0) {
          pendingPromptsRef.current.delete(sessionPath);
          await prompt(sessionPath, bufferedMessages[0]);
          for (let i = 1; i < bufferedMessages.length; i++) {
            await steer(sessionPath, bufferedMessages[i]);
          }
          void listProjectSessions([session.cwd]);
        }
      } catch (err) {
        console.error('Failed to resume session process:', err);
        const store = useAppStore.getState();
        store.removeSession(sessionPath);
        disposeTranscriptSession(sessionPath);
        if (store.activeSessionPath === sessionPath) {
          store.setActiveSession(null);
        }
        const bufferedMessages = pendingPromptsRef.current.get(sessionPath);
        if (bufferedMessages && bufferedMessages.length > 0) {
          setRestoreText(bufferedMessages.join('\n\n'));
        }
        pendingPromptsRef.current.delete(sessionPath);
        pendingResumesRef.current.delete(sessionPath);
        toast.error('Failed to resume session. Please try again.');
      }
    },
    [modelOptions, addSessionEntry, pushNavigationHistory, refreshSessionState, setActiveSession],
  );

  const handleOpenProject = useCallback(async () => {
    const result = await openProjectDirectory();
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
      await refreshProjectSessions(result.recentProjects);
      setPendingSelectedPath(null);
      setActiveSession(null);
    }
  }, [refreshProjectSessions, setActiveSession]);

  const findSessionByPath = useCallback(
    (path: string): PiSessionInfo | undefined => {
      for (const cwd of Object.keys(projectSessions)) {
        const found = projectSessions[cwd].find((s) => s.path === path);
        if (found) return found;
      }
      return undefined;
    },
    [projectSessions],
  );

  const shortcutActions = useMemo(
    () => ({
      'sidebar.newChat': () => {
        handleNewSession();
      },
      'sidebar.openProject': () => {
        handleOpenProject();
      },
      'navigation.openSwitcher': () => {
        setSwitcherAutoPreselect(false);
        setSwitcherOpen(true);
      },
      'navigation.closeOrSelectSwitcher': () => {
        // Ctrl+Tab: preselect previous session so immediate release switches
        setSwitcherAutoPreselect(true);
        setSwitcherOpen(true);
      },
      'navigation.prev': () => {
        const targetPath = useAppStore.getState().navigateBack();
        if (targetPath) {
          const session = findSessionByPath(targetPath);
          if (session) {
            void handleResumeSession(session, { skipHistory: true });
          }
        }
      },
      'navigation.next': () => {
        const targetPath = useAppStore.getState().navigateForward();
        if (targetPath) {
          const session = findSessionByPath(targetPath);
          if (session) {
            void handleResumeSession(session, { skipHistory: true });
          }
        }
      },
    }),
    [handleNewSession, handleOpenProject, handleResumeSession, findSessionByPath],
  );
  const shortcutBindings = useKeyboardShortcuts(shortcutActions);

  const handleSelectProject = useCallback(async (path: string) => {
    const result = await setActiveProject(path);
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
    }
  }, []);

  const handleRemoveProject = useCallback(async (path: string) => {
    const result = await removeProject(path);
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
    }
  }, []);

  const handleReorderProjects = useCallback(async (paths: string[]) => {
    const result = await reorderProjects(paths);
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
    }
  }, []);

  const handleLogin = useCallback(async () => {
    let sessionPath = activeSessionPath;
    if (!sessionPath) {
      // Need a real session for auth — create one immediately
      const cwd = activeProject?.path ?? window.piApi.getCwd();
      try {
        sessionPath = await createSession(cwd);
        addSession(sessionPath, cwd);
        setIsDraftChat(false);
        setActiveSession(sessionPath);
      } catch {
        return;
      }
    }
    const result = await getAuthProviders(sessionPath);
    if (result.success) {
      setAuthProviders(result.providers);
    }
    setLoginDialogOpen(true);
  }, [activeSessionPath, activeProject, addSession, setActiveSession]);

  const handleRenameSession = useCallback(
    async (sessionPath: string, name: string) => {
      // Find the running session by path
      const entry = Array.from(sessions.values()).find((s) => s.sessionPath === sessionPath);
      if (entry) {
        // Session is running, rename via SDK
        try {
          await renameSession(entry.sessionPath, name);
        } catch (err) {
          console.error('Failed to rename session:', err);
        }
      } else {
        // Session is not running; rename directly via persisted session file
        const result = await window.piApi.renamePersistedSession(sessionPath, name);
        if (!result.success) {
          console.error('Failed to rename persisted session:', result.error);
        }
      }
      // Refresh session list to reflect new name
      const sessionCwd = entry?.cwd ?? findSessionByPath(sessionPath)?.cwd;
      if (sessionCwd) {
        void listProjectSessions([sessionCwd]);
      }
    },
    [sessions, findSessionByPath],
  );

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      lastModelRef.current = { provider: model.provider, id: model.id };
      setLastModelSnapshot({ provider: model.provider, id: model.id });
      // Filter thinking level options for the selected model
      let needsThinkingClamp = false;
      if (model.thinkingLevels.length > 0) {
        const levels = model.thinkingLevels;
        setThinkingLevelOptions(levels);
        // Reset thinking level if current one isn't available for this model
        if (lastThinkingLevelRef.current && !levels.includes(lastThinkingLevelRef.current)) {
          needsThinkingClamp = true;
          setLastThinkingLevelSnapshot('off');
        }
      }
      if (!activeSessionPath) {
        if (needsThinkingClamp) {
          lastThinkingLevelRef.current = 'off';
        }
        return;
      }
      await setModel(activeSessionPath, model.provider, model.id);
      await refreshSessionState(activeSessionPath);
      await refreshSessionOptions(activeSessionPath);
      // Clamp thinking level on the backend if not available for new model
      if (needsThinkingClamp) {
        lastThinkingLevelRef.current = 'off';
        await setThinkingLevel(activeSessionPath, 'off');
      }
    },
    [activeSessionPath, refreshSessionState, refreshSessionOptions],
  );

  const handleSelectThinkingLevel = useCallback(
    async (thinkingLevel: ThinkingLevel) => {
      lastThinkingLevelRef.current = thinkingLevel;
      setLastThinkingLevelSnapshot(thinkingLevel);
      if (!activeSessionPath) {
        return;
      }
      await setThinkingLevel(activeSessionPath, thinkingLevel);
      await refreshSessionState(activeSessionPath);
      await refreshSessionOptions(activeSessionPath);
    },
    [activeSessionPath, refreshSessionOptions, refreshSessionState],
  );

  const handleSlashCommand = useCallback(
    async (command: string, arg: string) => {
      try {
        switch (command) {
          case 'compact': {
            if (!activeSessionPath) return;
            await compact(activeSessionPath);
            break;
          }

          case 'name': {
            if (!activeSessionPath || !arg) return;
            try {
              await renameSession(activeSessionPath, arg);
            } catch {
              // Fallback: update local state only
            }
            useAppStore.getState().updateSession(activeSessionPath, { title: arg });
            break;
          }
          case 'new': {
            handleNewSession();
            break;
          }
          case 'login': {
            let sessionId = activeSessionPath;
            if (!sessionId) {
              const cwd = activeProject?.path ?? window.piApi.getCwd();
              try {
                sessionId = await createSession(cwd);
                addSession(sessionId, cwd);
                setIsDraftChat(false);
                setActiveSession(sessionId);
              } catch {
                return;
              }
            }
            if (!sessionId) return;
            if (arg) {
              // /login <provider> — start OAuth flow directly
              const result = await loginOAuth(sessionId, arg);
              if (result.success) {
                toast.success(`Authenticated with ${arg}`);
              } else {
                toast.error(result.error || 'Login failed');
              }
              await refreshSessionOptions(sessionId);
            } else {
              // /login — open login dialog
              const result = await getAuthProviders(sessionId);
              if (result.success) {
                setAuthProviders(result.providers);
              }
              setLoginDialogOpen(true);
            }
            break;
          }
          case 'logout': {
            if (!activeSessionPath || !arg) return;
            await logout(activeSessionPath, arg);
            await refreshSessionOptions(activeSessionPath);
            break;
          }
        }
      } catch (err) {
        console.error(`[slash command /${command}] failed:`, err);
      }
    },
    [
      activeSessionPath,
      activeProject,
      addSession,
      handleNewSession,
      refreshSessionOptions,
      setActiveSession,
    ],
  );

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      className="h-screen min-h-0"
      data-testid="app-shell"
    >
      <div className="relative flex h-full shrink-0">
        <Sidebar
          sessions={sessions}
          selectedSessionPath={selectedSessionPath}
          recentProjects={recentProjects}
          projectSessions={projectSessions}
          shortcutBindings={shortcutBindings}
          onNewSession={handleNewSession}
          onNewSessionForProject={handleNewSessionForProject}
          onResumeSession={handleResumeSession}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectProject}
          onRemoveProject={handleRemoveProject}
          onReorderProjects={handleReorderProjects}
          onRenameSession={handleRenameSession}
          onLogin={handleLogin}
        />
      </div>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden rounded-l-xl border-l-[0.5px] border-foreground/27 bg-background">
        <div
          aria-label="Resize sidebar"
          role="separator"
          aria-orientation="vertical"
          className="absolute inset-y-0 -left-1 z-10 w-2 cursor-col-resize"
          onPointerDown={handleSidebarResizeStart}
        />
        {activeSession ? (
          <>
            <MessageList nodes={transcript.nodes} sessionPath={activeSessionPath ?? ''} />
            <StreamingQueue
              isStreaming={transcript.status !== 'idle'}
              queuedSteering={transcript.queuedSteering}
              queuedFollowUp={transcript.queuedFollowUp}
              onEditQueuedMessage={handleEditQueuedMessage}
            />
            <ChatInput
              onSend={handleSend}
              onFollowUp={handleFollowUp}
              onAbort={handleAbort}
              onSlashCommand={handleSlashCommand}
              isStreaming={transcript.status !== 'idle'}
              gitBranch={gitBranch}
              restoreText={restoreText}
              onRestoredText={handleRestoredText}
              onRefreshGitBranch={refreshGitBranch}
              session={activeSession}
              modelOptions={activeSessionPath ? modelOptions : []}
              thinkingLevelOptions={activeSessionPath ? thinkingLevelOptions : []}
              skillOptions={activeSessionPath ? skillOptions : []}
              onSelectModel={handleSelectModel}
              onSelectThinkingLevel={handleSelectThinkingLevel}
            />
          </>
        ) : isDraftChat ? (
          <>
            {!isDraftEmpty && <MessageList nodes={draftState.nodes} sessionPath="" />}
            <ChatInput
              onSend={handleSend}
              onFollowUp={handleFollowUp}
              onAbort={handleAbort}
              onSlashCommand={handleSlashCommand}
              isStreaming={isDraftSpawning}
              gitBranch={gitBranch}
              restoreText={restoreText}
              onRestoredText={handleRestoredText}
              onRefreshGitBranch={refreshGitBranch}
              session={draftSession}
              modelOptions={modelOptions}
              thinkingLevelOptions={thinkingLevelOptions}
              skillOptions={skillOptions}
              onSelectModel={handleSelectModel}
              onSelectThinkingLevel={handleSelectThinkingLevel}
              isNewSession={isDraftEmpty}
              recentProjects={recentProjects}
              activeProject={activeProject}
              onSelectProject={handleSelectProject}
            />
          </>
        ) : recentProjects.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyTitle className="text-xl">{WELCOME_TITLE}</EmptyTitle>
              <EmptyDescription>
                Open a project to get started
                <br />
                {/* TODO: Use Ctrl instead of ⌘ on Windows/Linux */}
                <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-2 py-0 font-mono text-xs ml-1 min-w-6">
                  {'\u2318'}
                </kbd>
                <kbd className="inline-flex items-center justify-center rounded border border-border bg-muted px-2 py-0 font-mono text-xs ml-1 min-w-6">
                  o
                </kbd>
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : (
          <Empty>
            <EmptyHeader>
              <EmptyTitle className="text-xl">{WELCOME_TITLE}</EmptyTitle>
              <EmptyDescription>Select a session from the sidebar to get started.</EmptyDescription>
            </EmptyHeader>
          </Empty>
        )}
      </main>

      <SessionSwitcher
        projectSessions={projectSessions}
        navigationBackStack={navigationBackStack}
        navigationForwardStack={navigationForwardStack}
        activeSessionPath={activeSessionPath}
        onSwitch={(sessionPath) => {
          const session = findSessionByPath(sessionPath);
          if (session) {
            void handleResumeSession(session);
          }
        }}
        open={switcherOpen}
        onOpenChange={setSwitcherOpen}
        autoSelectPrevious={switcherAutoPreselect}
      />

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        providers={authProviders}
        onLoginOAuth={async (providerId) => {
          if (!activeSessionPath) return;
          const result = await loginOAuth(activeSessionPath, providerId);
          if (!result.success) throw new Error(result.error || 'Login failed');
          await refreshSessionOptions(activeSessionPath);
          const updated = await getAuthProviders(activeSessionPath);
          if (updated.success) setAuthProviders(updated.providers);
        }}
        onLoginApiKey={async (providerId, apiKey) => {
          if (!activeSessionPath) return;
          const result = await loginApiKey(activeSessionPath, providerId, apiKey);
          if (!result.success) throw new Error(result.error || 'Failed to save API key');
          await refreshSessionOptions(activeSessionPath);
          const updated = await getAuthProviders(activeSessionPath);
          if (updated.success) setAuthProviders(updated.providers);
        }}
        onLogout={async (providerId) => {
          if (!activeSessionPath) return;
          await logout(activeSessionPath, providerId);
          await refreshSessionOptions(activeSessionPath);
          // Refresh provider list
          const result = await getAuthProviders(activeSessionPath);
          if (result.success) setAuthProviders(result.providers);
        }}
      />
    </SidebarProvider>
  );
}

export default App;
