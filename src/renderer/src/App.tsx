import { useEffect, useCallback, useState } from 'react'
import { useAppStore } from './state/appStore'
import { useTranscript } from './hooks/useTranscript'
import {
  resumeSession,
  createSession,
  prompt,
  abort,
  getProjects,
  listProjectSessions,
  onProjectSessionsChunk,
  openProjectDirectory,
  setActiveProject,
} from './services/piAgentClient'
import type { PiSessionInfo, ProjectDirectory } from '../../shared/ipcContract'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
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
    activeProject,
    recentProjects,
    projectSessions,
    setProjectSessionList,
  } = useAppStore()

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
  const activeProjectPath = activeSession?.cwd ?? activeProject?.path ?? null
  // Keep transcript loading tied to activeSessionId; pending selection only affects sidebar highlight.
  const selectedSessionId = pendingSelectedSessionId ?? activeSessionId
  const { state: transcript, controller } = useTranscript(activeSessionId)

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
  }, [activeSessionId, transcript.status])

  useEffect(() => {
    return window.piApi.onProcessExit(() => {
      // Process crashed — could mark affected sessions.
    })
  }, [])

  async function handleSend(message: string): Promise<void> {
    const cwd = activeProject?.path ?? window.piApi.getCwd()
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

  async function handleNewSession(): Promise<void> {
    try {
      const cwd = activeProject?.path ?? window.piApi.getCwd()
      const sessionId = await createSession(cwd)
      addSession(sessionId, cwd)
      setPendingSelectedSessionId(null)
      setActiveSession(sessionId)
      void listProjectSessions([cwd])
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  async function handleResumeSession(session: PiSessionInfo): Promise<void> {
    setPendingSelectedSessionId(session.id)
    const existing = sessions.get(session.id)
    if (existing) {
      setPendingSelectedSessionId(null)
      setActiveSession(existing.sessionId)
      return
    }

    try {
      const sessionId = await resumeSession(session.path)
      addSessionEntry({
        sessionId,
        status: 'idle',
        title: session.name ?? session.firstMessage,
        cwd: session.cwd,
        model: null,
        thinkingLevel: null,
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

  const handleSelectProject = useCallback(
    async (path: string) => {
      const result = await setActiveProject(path)
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
        setPendingSelectedSessionId(null)
        setActiveSession(null)
      }
    },
    [setActiveSession],
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
          activeProjectPath={activeProjectPath}
          isStreaming={transcript.status !== 'idle'}
          recentProjects={recentProjects}
          projectSessions={projectSessions}
          onNewSession={handleNewSession}
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
        <StatusBar status={transcript.status} model={activeSession?.title ?? 'New chat'} />
        <MessageList
          nodes={transcript.nodes}
          activeAssistantId={transcript.activeAssistantId}
          controller={controller}
        />
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={transcript.status !== 'idle'}
          project={activeProject}
        />
      </main>
    </SidebarProvider>
  )
}

export default App
