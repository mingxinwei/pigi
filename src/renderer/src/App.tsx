import { useEffect, useCallback } from 'react'
import { useAppStore } from './state/appStore'
import { useTranscript } from './hooks/useTranscript'
import {
  createSession,
  prompt,
  abort,
  getProjects,
  openProjectDirectory,
  setActiveProject,
} from './services/piAgentClient'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'
import { SidebarProvider } from './components/ui/sidebar'

function App(): React.JSX.Element {
  const { activeSessionId, sessions, addSession, setActiveSession, activeProject, recentProjects } =
    useAppStore()

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
  const { state: transcript, controller } = useTranscript(activeSessionId)

  useEffect(() => {
    void getProjects().then((result) => {
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
      }
    })
  }, [])

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
      setActiveSession(sessionId)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId)
    },
    [setActiveSession],
  )

  const handleOpenProject = useCallback(async () => {
    const result = await openProjectDirectory()
    if (result.success) {
      useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
      setActiveSession(null)
    }
  }, [setActiveSession])

  const handleSelectProject = useCallback(
    async (path: string) => {
      const result = await setActiveProject(path)
      if (result.success) {
        useAppStore.getState().setProjects(result.recentProjects, result.activeProject)
        setActiveSession(null)
      }
    },
    [setActiveSession],
  )

  return (
    <SidebarProvider
      style={{ '--sidebar-width': '15.25rem' } as React.CSSProperties}
      className="h-screen min-h-0 bg-background"
      data-testid="app-shell"
    >
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isStreaming={transcript.status !== 'idle'}
        recentProjects={recentProjects}
        activeProject={activeProject}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
        onOpenProject={handleOpenProject}
        onSelectProject={handleSelectProject}
      />

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
