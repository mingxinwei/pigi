import { useEffect, useCallback, useMemo, useRef, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from './state/appStore';
import { useKeyboardShortcuts } from './hooks/useKeyboardShortcuts';
import { detectPlatform } from './lib/platform';
import {
  disposeTranscriptSession,
  ensureTranscriptSession,
  getTranscriptController,
  markSessionHydrated,
  useTranscript,
} from './hooks/useTranscript';
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
  } = useAppStore();

  const activeSession = activeSessionPath ? (sessions.get(activeSessionPath) ?? null) : null;
  const activeCwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd();
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [thinkingLevelOptions, setThinkingLevelOptions] = useState<ThinkingLevel[]>([]);
  const [skillOptions, setSkillOptions] = useState<SkillSlashCommand[]>([]);
  // Keep transcript loading tied to activeSessionPath; pending selection only affects sidebar highlight.
  const selectedSessionPath = pendingSelectedPath ?? activeSessionPath ?? null;
  const { state: transcript, controller: transcriptControllerRef } =
    useTranscript(activeSessionPath);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [restoreText, setRestoreText] = useState<string | null>(null);
  const lastModelRef = useRef<{ provider: string; id: string } | null>(null);
  const lastThinkingLevelRef = useRef<ThinkingLevel | null>(null);

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
    void refreshSessionState(activeSessionPath);
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
      removeSession(sessionPath);
    });
  }, [removeSession]);

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
    let sessionId = activeSessionPath;
    if (!sessionId) {
      sessionId = await createSession(cwd);
      addSession(sessionId, cwd);
      setActiveSession(sessionId);

      // Apply last-used model and thinking level to the new session
      if (lastModelRef.current) {
        void setModel(sessionId, lastModelRef.current.provider, lastModelRef.current.id).catch(
          () => {},
        );
      }
      if (lastThinkingLevelRef.current) {
        void setThinkingLevel(sessionId, lastThinkingLevelRef.current).catch(() => {});
      }
    }
    const existing = useAppStore.getState().sessions.get(sessionId);
    if (existing?.title === 'New chat') {
      useAppStore.getState().updateSession(sessionId, { title: message.slice(0, 48) });
    }

    // If the session is still pending (utility process not ready), buffer the prompt
    if (pendingResumesRef.current.has(sessionId)) {
      const queue = pendingPromptsRef.current.get(sessionId) ?? [];
      queue.push(message);
      pendingPromptsRef.current.set(sessionId, queue);
      // Show optimistic user message
      getTranscriptController(sessionId).addUserMessage(message);
      return;
    }

    // Queue locally during compaction — messages are replayed after compaction ends.
    if (transcript.isCompacting) {
      transcriptControllerRef.current?.addCompactionMessage(message, 'steer');
      void listProjectSessions([cwd]);
      return;
    }

    // If the session is already streaming, steer instead of prompting
    if (transcript.status !== 'idle') {
      await steer(sessionId, message);
    } else {
      // Skill commands: skip optimistic message — SDK echoes back the expanded version
      if (!message.startsWith('/skill:')) {
        ensureTranscriptSession(sessionId).addUserMessage(message);
      }
      await prompt(sessionId, message);
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

  const createAndActivateSession = useCallback(
    async (cwd: string): Promise<void> => {
      const sessionId = await createSession(cwd);
      addSession(sessionId, cwd);

      // Apply last-used model and thinking level to the new session
      if (lastModelRef.current) {
        void setModel(sessionId, lastModelRef.current.provider, lastModelRef.current.id).catch(
          () => {},
        );
      }
      if (lastThinkingLevelRef.current) {
        void setThinkingLevel(sessionId, lastThinkingLevelRef.current).catch(() => {});
      }

      setPendingSelectedPath(null);
      setActiveSession(sessionId);
      void listProjectSessions([cwd]);
    },
    [addSession, setActiveSession],
  );

  const createSessionIfNoDuplicate = useCallback(
    async (cwd: string): Promise<void> => {
      const existingEmptySession = Array.from(useAppStore.getState().sessions.values()).find(
        (entry) => entry.cwd === cwd && entry.messageCount === 0,
      );
      if (existingEmptySession) {
        setActiveSession(existingEmptySession.sessionPath);
        return;
      }
      await createAndActivateSession(cwd);
    },
    [createAndActivateSession, setActiveSession],
  );

  const handleNewSession = useCallback(async (): Promise<void> => {
    try {
      await createSessionIfNoDuplicate(activeCwd);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [activeCwd, createSessionIfNoDuplicate]);

  async function handleNewSessionForProject(path: string): Promise<void> {
    try {
      const result = await setActiveProject(path);
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
      }

      await createSessionIfNoDuplicate(path);
    } catch (err) {
      console.error('Failed to create project session:', err);
    }
  }

  async function handleResumeSession(session: PiSessionInfo): Promise<void> {
    setPendingSelectedPath(session.path);
    const existing = Array.from(useAppStore.getState().sessions.values()).find(
      (entry) => entry.persistedSessionId === session.id || entry.sessionPath === session.path,
    );
    if (existing) {
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
          thinkingLevel,
          ...(matchedModel ? { model: matchedModel } : {}),
        });
      } else {
        useAppStore.getState().updateSession(sessionPath, { thinkingLevel });
      }
    } catch (err) {
      console.error('Failed to hydrate session from file:', err);
    }

    // Show the session — messages and metadata are ready
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
  }

  const handleSwitchSession = useCallback(
    (sessionPath: string) => {
      setPendingSelectedPath(null);
      setActiveSession(sessionPath);
    },
    [setActiveSession],
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

  const shortcutActions = useMemo(
    () => ({
      'sidebar.newChat': () => {
        handleNewSession();
      },
      'sidebar.openProject': () => {
        handleOpenProject();
      },
    }),
    [handleNewSession, handleOpenProject],
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
    let sessionId = activeSessionPath;
    if (!sessionId) {
      await handleNewSession();
      sessionId = useAppStore.getState().activeSessionPath;
    }
    if (!sessionId) return;
    const result = await getAuthProviders(sessionId);
    if (result.success) {
      setAuthProviders(result.providers);
    }
    setLoginDialogOpen(true);
  }, [activeSessionPath, handleNewSession]);

  const handleRenameSession = useCallback(
    async (sessionId: string, name: string) => {
      // Find the running session that matches this persisted session ID
      const entry = Array.from(sessions.values()).find((s) => s.persistedSessionId === sessionId);
      if (entry) {
        // Session is running, rename via SDK
        try {
          await renameSession(entry.sessionPath, name);
          useAppStore.getState().updateSession(entry.sessionPath, { title: name });
        } catch (err) {
          console.error('Failed to rename session:', err);
        }
      } else {
        // Session is not running; rename directly via persisted session file
        const sessionInfo = Object.values(projectSessions)
          .flat()
          .find((s) => s.id === sessionId);
        if (sessionInfo) {
          const result = await window.piApi.renamePersistedSession(sessionInfo.path, name);
          if (!result.success) {
            console.error('Failed to rename persisted session:', result.error);
          }
        }
      }
      // Refresh session list to reflect new name
      const activeCwdNow = activeProject?.path ?? window.piApi.getCwd();
      void listProjectSessions([activeCwdNow]);
    },
    [sessions, activeProject, projectSessions],
  );

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      if (!activeSessionPath) {
        return;
      }
      await setModel(activeSessionPath, model.provider, model.id);
      lastModelRef.current = { provider: model.provider, id: model.id };
      await refreshSessionState(activeSessionPath);
      await refreshSessionOptions(activeSessionPath);
    },
    [activeSessionPath, refreshSessionOptions, refreshSessionState],
  );

  const handleSelectThinkingLevel = useCallback(
    async (thinkingLevel: ThinkingLevel) => {
      if (!activeSessionPath) {
        return;
      }
      await setThinkingLevel(activeSessionPath, thinkingLevel);
      lastThinkingLevelRef.current = thinkingLevel;
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
            await handleNewSession();
            break;
          }
          case 'login': {
            let sessionId = activeSessionPath;
            if (!sessionId) {
              await handleNewSession();
              sessionId = useAppStore.getState().activeSessionPath;
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
    [activeSessionPath, handleNewSession, refreshSessionOptions],
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
          onSwitchSession={handleSwitchSession}
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
            <MessageList nodes={transcript.nodes} />
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
