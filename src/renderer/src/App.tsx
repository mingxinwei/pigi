import { useEffect, useCallback, useState } from 'react';
import { toast } from 'sonner';
import { useAppStore } from './state/appStore';
import {
  disposeTranscriptSession,
  ensureTranscriptSession,
  useTranscript,
} from './hooks/useTranscript';
import {
  resumeSession,
  createSession,
  prompt,
  steer,
  abort,
  compact,
  cycleModel,
  cycleThinkingLevel,
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
} from './services/piAgentClient';
import type {
  AuthProviderInfo,
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
  ThinkingLevel,
} from '../../shared/ipcContract';
import Sidebar from './components/Sidebar';
import MessageList from './components/MessageList';
import ChatInput from './components/ChatInput';
import StreamingQueue from './components/StreamingQueue';
import LoginDialog from './components/LoginDialog';
import { SidebarProvider } from './components/ui/sidebar';

function App(): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(244);
  // Used only for immediate sidebar feedback while a persisted session is resuming.
  const [pendingSelectedSessionId, setPendingSelectedSessionId] = useState<string | null>(null);
  const {
    activeSessionId,
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

  const activeSession = activeSessionId ? (sessions.get(activeSessionId) ?? null) : null;
  const activeCwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd();
  const [gitBranch, setGitBranch] = useState<string | null>(null);
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([]);
  const [thinkingLevelOptions, setThinkingLevelOptions] = useState<ThinkingLevel[]>([]);
  // Keep transcript loading tied to activeSessionId; pending selection only affects sidebar highlight.
  const selectedSessionId = pendingSelectedSessionId ?? activeSession?.persistedSessionId ?? null;
  const { state: transcript, controller: transcriptControllerRef } = useTranscript(activeSessionId);
  const [loginDialogOpen, setLoginDialogOpen] = useState(false);
  const [authProviders, setAuthProviders] = useState<AuthProviderInfo[]>([]);
  const [restoreText, setRestoreText] = useState<string | null>(null);

  const refreshSessionState = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const sessionState = await getState(sessionId);
      useAppStore.getState().updateSession(sessionId, {
        model: sessionState.model,
        thinkingLevel: sessionState.thinkingLevel,
        contextUsage: sessionState.contextUsage,
        autoCompactionEnabled: sessionState.autoCompactionEnabled,
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
    } catch (err) {
      console.error('Failed to refresh session options:', err);
      setModelOptions([]);
      setThinkingLevelOptions([]);
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
    if (!activeSessionId) {
      return;
    }
    useAppStore.getState().updateSession(activeSessionId, { status: transcript.status });
    void refreshSessionState(activeSessionId);
  }, [activeSessionId, refreshSessionState, transcript.status]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }

    let cancelled = false;
    void getSessionOptions(activeSessionId)
      .then((options) => {
        if (cancelled) {
          return;
        }
        setModelOptions(options.models);
        setThinkingLevelOptions(options.thinkingLevels);
      })
      .catch((err) => {
        if (cancelled) {
          return;
        }
        console.error('Failed to refresh session options:', err);
        setModelOptions([]);
        setThinkingLevelOptions([]);
      });

    return () => {
      cancelled = true;
    };
  }, [activeSessionId]);

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
    return window.piApi.onProcessExit(({ sessionId }) => {
      disposeTranscriptSession(sessionId);
      removeSession(sessionId);
    });
  }, [removeSession]);

  useEffect(() => {
    if (!activeSessionId) {
      return;
    }
    void touchSession(activeSessionId);
  }, [activeSessionId]);

  async function handleSend(message: string): Promise<void> {
    const cwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd();
    let sessionId = activeSessionId;
    if (!sessionId) {
      sessionId = await createSession(cwd);
      addSession(sessionId, cwd);
      setActiveSession(sessionId);
    }
    const existing = useAppStore.getState().sessions.get(sessionId);
    if (existing?.title === 'New chat') {
      useAppStore.getState().updateSession(sessionId, { title: message.slice(0, 48) });
    }

    // If the session is already streaming, steer instead of prompting
    if (transcript.status !== 'idle') {
      await steer(sessionId, message);
    } else {
      ensureTranscriptSession(sessionId).addUserMessage(message);
      await prompt(sessionId, message);
    }
    void listProjectSessions([cwd]);
  }

  const handleFollowUp = useCallback(
    async (message: string): Promise<void> => {
      const sessionId = activeSessionId;
      if (!sessionId) return;
      if (transcript.status !== 'idle') {
        await followUp(sessionId, message);
      } else {
        ensureTranscriptSession(sessionId).addUserMessage(message);
        await prompt(sessionId, message);
      }
    },
    [activeSessionId, transcript.status],
  );

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) {
      return;
    }
    // Clear local queue state to prevent false delivery detection
    transcriptControllerRef.current?.clearLocalQueue();
    // Clear queued messages and restore them to input
    const result = await clearQueue(activeSessionId);
    let queued = [...(result.steering ?? []), ...(result.followUp ?? [])];
    // Fallback: use local transcript state if clearQueue returned nothing
    if (queued.length === 0) {
      const ts = ensureTranscriptSession(activeSessionId).state;
      queued = [...ts.queuedSteering, ...ts.queuedFollowUp];
    }
    await abort(activeSessionId);
    if (queued.length > 0) {
      setRestoreText(queued.join('\n\n'));
    }
  }, [activeSessionId, transcriptControllerRef]);

  const handleEditQueuedMessage = useCallback(
    async (type: 'steer' | 'followUp', index: number) => {
      if (!activeSessionId) return;
      // Clear local queue state to prevent false delivery detection
      transcriptControllerRef.current?.clearLocalQueue();
      try {
        const result = await clearQueue(activeSessionId);
        const steeringMsgs = [...(result.steering ?? [])];
        const followUpMsgs = [...(result.followUp ?? [])];
        const editedMsg =
          type === 'steer' ? steeringMsgs.splice(index, 1)[0] : followUpMsgs.splice(index, 1)[0];
        // Re-queue remaining
        for (const msg of steeringMsgs) await steer(activeSessionId, msg);
        for (const msg of followUpMsgs) await followUp(activeSessionId, msg);
        // Restore edited message to input
        if (editedMsg) setRestoreText(editedMsg);
      } catch (err) {
        console.error('Failed to edit queued message:', err);
      }
    },
    [activeSessionId, transcriptControllerRef],
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
      setPendingSelectedSessionId(null);
      setActiveSession(sessionId);
      void listProjectSessions([cwd]);
    },
    [addSession, setActiveSession],
  );

  const handleNewSession = useCallback(async (): Promise<void> => {
    try {
      await createAndActivateSession(activeCwd);
    } catch (err) {
      console.error('Failed to create session:', err);
    }
  }, [activeCwd, createAndActivateSession]);

  async function handleNewSessionForProject(path: string): Promise<void> {
    try {
      const result = await setActiveProject(path);
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
      }

      await createAndActivateSession(path);
    } catch (err) {
      console.error('Failed to create project session:', err);
    }
  }

  async function handleResumeSession(session: PiSessionInfo): Promise<void> {
    setPendingSelectedSessionId(session.id);
    const existing = Array.from(useAppStore.getState().sessions.values()).find(
      (entry) => entry.persistedSessionId === session.id || entry.sessionPath === session.path,
    );
    if (existing) {
      setPendingSelectedSessionId(null);
      setActiveSession(existing.sessionId);
      return;
    }

    try {
      const sessionId = await resumeSession(session.path);
      addSessionEntry({
        sessionId,
        persistedSessionId: session.id,
        sessionPath: session.path,
        status: 'idle',
        title: session.name ?? session.firstMessage,
        cwd: session.cwd,
        createdAt: session.created,
        model: null,
        thinkingLevel: null,
        contextUsage: null,
        autoCompactionEnabled: false,
        error: null,
      });
      setActiveSession(sessionId);
    } catch (err) {
      console.error('Failed to resume session:', err);
    } finally {
      setPendingSelectedSessionId(null);
    }
  }

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setPendingSelectedSessionId(null);
      setActiveSession(sessionId);
    },
    [setActiveSession],
  );

  const handleOpenProject = useCallback(async () => {
    const result = await openProjectDirectory();
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
      await refreshProjectSessions(result.recentProjects);
      setPendingSelectedSessionId(null);
      setActiveSession(null);
    }
  }, [refreshProjectSessions, setActiveSession]);

  const handleSelectProject = useCallback(async (path: string) => {
    const result = await setActiveProject(path);
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject);
    }
  }, []);

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      if (!activeSessionId) {
        return;
      }
      await setModel(activeSessionId, model.provider, model.id);
      await refreshSessionState(activeSessionId);
      await refreshSessionOptions(activeSessionId);
    },
    [activeSessionId, refreshSessionOptions, refreshSessionState],
  );

  const handleSelectThinkingLevel = useCallback(
    async (thinkingLevel: ThinkingLevel) => {
      if (!activeSessionId) {
        return;
      }
      await setThinkingLevel(activeSessionId, thinkingLevel);
      await refreshSessionState(activeSessionId);
      await refreshSessionOptions(activeSessionId);
    },
    [activeSessionId, refreshSessionOptions, refreshSessionState],
  );

  const handleSlashCommand = useCallback(
    async (command: string, arg: string) => {
      try {
        switch (command) {
          case 'compact': {
            if (!activeSessionId) return;
            await compact(activeSessionId);
            break;
          }
          case 'model': {
            if (!activeSessionId) return;
            await cycleModel(activeSessionId);
            await refreshSessionState(activeSessionId);
            await refreshSessionOptions(activeSessionId);
            break;
          }
          case 'thinking': {
            if (!activeSessionId) return;
            await cycleThinkingLevel(activeSessionId);
            await refreshSessionState(activeSessionId);
            await refreshSessionOptions(activeSessionId);
            break;
          }
          case 'name': {
            if (!activeSessionId || !arg) return;
            useAppStore.getState().updateSession(activeSessionId, { title: arg });
            break;
          }
          case 'new':
          case 'clear': {
            await handleNewSession();
            break;
          }
          case 'login': {
            let sessionId = activeSessionId;
            if (!sessionId) {
              await handleNewSession();
              sessionId = useAppStore.getState().activeSessionId;
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
            if (!activeSessionId || !arg) return;
            await logout(activeSessionId, arg);
            await refreshSessionOptions(activeSessionId);
            break;
          }
        }
      } catch (err) {
        console.error(`[slash command /${command}] failed:`, err);
      }
    },
    [activeSessionId, handleNewSession, refreshSessionOptions, refreshSessionState],
  );

  return (
    <SidebarProvider
      style={{ '--sidebar-width': `${sidebarWidth}px` } as React.CSSProperties}
      className="h-screen min-h-0 bg-background"
      data-testid="app-shell"
    >
      <div className="relative flex h-full shrink-0">
        <Sidebar
          sessions={sessions}
          selectedSessionId={selectedSessionId}
          recentProjects={recentProjects}
          projectSessions={projectSessions}
          onNewSession={handleNewSession}
          onNewSessionForProject={handleNewSessionForProject}
          onSwitchSession={handleSwitchSession}
          onResumeSession={handleResumeSession}
          onOpenProject={handleOpenProject}
          onSelectProject={handleSelectProject}
        />
        <div
          aria-label="Resize sidebar"
          role="separator"
          aria-orientation="vertical"
          className="absolute inset-y-0 right-0 w-2 cursor-col-resize"
          onPointerDown={handleSidebarResizeStart}
        />
      </div>

      <main className="relative flex min-w-0 flex-1 flex-col overflow-hidden bg-background">
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
          modelOptions={activeSessionId ? modelOptions : []}
          thinkingLevelOptions={activeSessionId ? thinkingLevelOptions : []}
          onSelectModel={handleSelectModel}
          onSelectThinkingLevel={handleSelectThinkingLevel}
        />
      </main>

      <LoginDialog
        open={loginDialogOpen}
        onOpenChange={setLoginDialogOpen}
        providers={authProviders}
        onLoginOAuth={async (providerId) => {
          if (!activeSessionId) return;
          const result = await loginOAuth(activeSessionId, providerId);
          if (!result.success) throw new Error(result.error || 'Login failed');
          await refreshSessionOptions(activeSessionId);
          const updated = await getAuthProviders(activeSessionId);
          if (updated.success) setAuthProviders(updated.providers);
        }}
        onLoginApiKey={async (providerId, apiKey) => {
          if (!activeSessionId) return;
          const result = await loginApiKey(activeSessionId, providerId, apiKey);
          if (!result.success) throw new Error(result.error || 'Failed to save API key');
          await refreshSessionOptions(activeSessionId);
          const updated = await getAuthProviders(activeSessionId);
          if (updated.success) setAuthProviders(updated.providers);
        }}
        onLogout={async (providerId) => {
          if (!activeSessionId) return;
          await logout(activeSessionId, providerId);
          await refreshSessionOptions(activeSessionId);
          // Refresh provider list
          const result = await getAuthProviders(activeSessionId);
          if (result.success) setAuthProviders(result.providers);
        }}
      />
    </SidebarProvider>
  );
}

export default App;
