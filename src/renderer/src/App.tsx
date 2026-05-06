import { useEffect, useCallback, useState } from 'react'
import { useAppStore } from './state/appStore'
import { useTranscript } from './hooks/useTranscript'
import {
  resumeSession,
  createSession,
  prompt,
  abort,
  getProjects,
  getGitBranch,
  getState,
  getSessionOptions,
  listProjectSessions,
  onProjectSessionsChunk,
  openProjectDirectory,
  setActiveProject,
  touchSession,
  setModel,
  setThinkingLevel,
} from './services/piAgentClient'
import type {
  ModelInfo,
  PiSessionInfo,
  ProjectDirectory,
  ThinkingLevel,
} from '../../shared/ipcContract'
import Sidebar from './components/Sidebar'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'
import { SidebarProvider } from './components/ui/sidebar'

function App(): React.JSX.Element {
  const [sidebarWidth, setSidebarWidth] = useState(244)
  // Used only for immediate sidebar feedback while a persisted session is resuming.
  const [pendingSelectedSessionId, setPendingSelectedSessionId] = useState<string | null>(null)
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
  } = useAppStore()

  const activeSession = activeSessionId ? (sessions.get(activeSessionId) ?? null) : null
  const activeCwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd()
  const [gitBranch, setGitBranch] = useState<string | null>(null)
  const [modelOptions, setModelOptions] = useState<ModelInfo[]>([])
  const [thinkingLevelOptions, setThinkingLevelOptions] = useState<ThinkingLevel[]>([])
  // Keep transcript loading tied to activeSessionId; pending selection only affects sidebar highlight.
  const selectedSessionId = pendingSelectedSessionId ?? activeSession?.persistedSessionId ?? null
  const { state: transcript, controller } = useTranscript(activeSessionId)

  const refreshSessionState = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const sessionState = await getState(sessionId)
      useAppStore.getState().updateSession(sessionId, {
        model: sessionState.model,
        thinkingLevel: sessionState.thinkingLevel,
        contextUsage: sessionState.contextUsage,
        autoCompactionEnabled: sessionState.autoCompactionEnabled,
      })
    } catch (err) {
      console.error('Failed to refresh session state:', err)
    }
  }, [])

  const refreshSessionOptions = useCallback(async (sessionId: string): Promise<void> => {
    try {
      const options = await getSessionOptions(sessionId)
      setModelOptions(options.models)
      setThinkingLevelOptions(options.thinkingLevels)
    } catch (err) {
      console.error('Failed to refresh session options:', err)
      setModelOptions([])
      setThinkingLevelOptions([])
    }
  }, [])

  const handleSidebarResizeStart = useCallback(
    (event: React.PointerEvent<HTMLDivElement>) => {
      event.preventDefault()
      const startX = event.clientX
      const startWidth = sidebarWidth

      function handlePointerMove(moveEvent: PointerEvent): void {
        const nextWidth = Math.min(360, Math.max(220, startWidth + moveEvent.clientX - startX))
        setSidebarWidth(nextWidth)
      }

      function handlePointerUp(): void {
        window.removeEventListener('pointermove', handlePointerMove)
        window.removeEventListener('pointerup', handlePointerUp)
      }

      window.addEventListener('pointermove', handlePointerMove)
      window.addEventListener('pointerup', handlePointerUp)
    },
    [sidebarWidth],
  )

  const refreshProjectSessions = useCallback(
    async (projects: ProjectDirectory[]): Promise<void> => {
      await listProjectSessions(projects.map((project) => project.path))
    },
    [],
  )

  useEffect(() => {
    return onProjectSessionsChunk((chunk) => {
      if (chunk.success) {
        setProjectSessionList(chunk.cwd, chunk.sessions ?? [])
      }
    })
  }, [setProjectSessionList])

  useEffect(() => {
    void getProjects().then((result) => {
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
        void refreshProjectSessions(result.recentProjects)
      }
    })
  }, [refreshProjectSessions])

  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    useAppStore.getState().updateSession(activeSessionId, { status: transcript.status })
    void refreshSessionState(activeSessionId)
  }, [activeSessionId, refreshSessionState, transcript.status])

  useEffect(() => {
    if (!activeSessionId) {
      return
    }

    let cancelled = false
    void getSessionOptions(activeSessionId)
      .then((options) => {
        if (cancelled) {
          return
        }
        setModelOptions(options.models)
        setThinkingLevelOptions(options.thinkingLevels)
      })
      .catch((err) => {
        if (cancelled) {
          return
        }
        console.error('Failed to refresh session options:', err)
        setModelOptions([])
        setThinkingLevelOptions([])
      })

    return () => {
      cancelled = true
    }
  }, [activeSessionId])

  useEffect(() => {
    let cancelled = false
    void getGitBranch(activeCwd).then((result) => {
      if (cancelled) {
        return
      }
      setGitBranch(result.success ? result.branch : null)
    })
    return () => {
      cancelled = true
    }
  }, [activeCwd, transcript.status])

  useEffect(() => {
    return window.piApi.onProcessExit(({ sessionId }) => {
      removeSession(sessionId)
    })
  }, [removeSession])

  useEffect(() => {
    if (!activeSessionId) {
      return
    }
    void touchSession(activeSessionId)
  }, [activeSessionId])

  async function handleSend(message: string): Promise<void> {
    const cwd = activeSession?.cwd ?? activeProject?.path ?? window.piApi.getCwd()
    let sessionId = activeSessionId
    if (!sessionId) {
      sessionId = await createSession(cwd)
      addSession(sessionId, cwd)
      setActiveSession(sessionId)
    }
    const existing = useAppStore.getState().sessions.get(sessionId)
    if (existing?.title === 'New chat') {
      useAppStore.getState().updateSession(sessionId, { title: message.slice(0, 48) })
    }
    controller.current.addUserMessage(message)
    await prompt(sessionId, message)
    void listProjectSessions([cwd])
  }

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) {
      return
    }
    await abort(activeSessionId)
  }, [activeSessionId])

  async function createAndActivateSession(cwd: string): Promise<void> {
    const sessionId = await createSession(cwd)
    addSession(sessionId, cwd)
    setPendingSelectedSessionId(null)
    setActiveSession(sessionId)
    void listProjectSessions([cwd])
  }

  async function handleNewSession(): Promise<void> {
    try {
      const cwd = activeProject?.path ?? window.piApi.getCwd()
      await createAndActivateSession(cwd)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  async function handleNewSessionForProject(path: string): Promise<void> {
    try {
      const result = await setActiveProject(path)
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
      }

      await createAndActivateSession(path)
    } catch (err) {
      console.error('Failed to create project session:', err)
    }
  }

  async function handleResumeSession(session: PiSessionInfo): Promise<void> {
    setPendingSelectedSessionId(session.id)
    const existing = Array.from(useAppStore.getState().sessions.values()).find(
      (entry) => entry.persistedSessionId === session.id || entry.sessionPath === session.path,
    )
    if (existing) {
      setPendingSelectedSessionId(null)
      setActiveSession(existing.sessionId)
      return
    }

    try {
      const sessionId = await resumeSession(session.path)
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
      })
      setActiveSession(sessionId)
    } finally {
      setPendingSelectedSessionId(null)
    }
  }

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setPendingSelectedSessionId(null)
      setActiveSession(sessionId)
    },
    [setActiveSession],
  )

  const handleOpenProject = useCallback(async () => {
    const result = await openProjectDirectory()
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
      await refreshProjectSessions(result.recentProjects)
      setPendingSelectedSessionId(null)
      setActiveSession(null)
    }
  }, [refreshProjectSessions, setActiveSession])

  const handleSelectProject = useCallback(async (path: string) => {
    const result = await setActiveProject(path)
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
    }
  }, [])

  const handleSelectModel = useCallback(
    async (model: ModelInfo) => {
      if (!activeSessionId) {
        return
      }
      await setModel(activeSessionId, model.provider, model.id)
      await refreshSessionState(activeSessionId)
      await refreshSessionOptions(activeSessionId)
    },
    [activeSessionId, refreshSessionOptions, refreshSessionState],
  )

  const handleSelectThinkingLevel = useCallback(
    async (thinkingLevel: ThinkingLevel) => {
      if (!activeSessionId) {
        return
      }
      await setThinkingLevel(activeSessionId, thinkingLevel)
      await refreshSessionState(activeSessionId)
      await refreshSessionOptions(activeSessionId)
    },
    [activeSessionId, refreshSessionOptions, refreshSessionState],
  )

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
          isStreaming={transcript.status !== 'idle'}
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
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={transcript.status !== 'idle'}
          gitBranch={gitBranch}
          session={activeSession}
          modelOptions={activeSessionId ? modelOptions : []}
          thinkingLevelOptions={activeSessionId ? thinkingLevelOptions : []}
          onSelectModel={handleSelectModel}
          onSelectThinkingLevel={handleSelectThinkingLevel}
        />
      </main>
    </SidebarProvider>
  )
}

export default App
