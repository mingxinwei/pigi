import { useEffect, useCallback } from 'react'
import { useAppStore } from './state/appStore'
import { useTranscript } from './hooks/useTranscript'
import { createSession, prompt, abort } from './services/piAgentClient'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'

function App(): React.JSX.Element {
  const { activeSessionId, sessions, addSession, setActiveSession } = useAppStore()

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
  const { state: transcript, controller } = useTranscript(activeSessionId)

  // Sync transcript status to app store
  useEffect(() => {
    if (!activeSessionId) return
    useAppStore.getState().updateSession(activeSessionId, { status: transcript.status })
  }, [activeSessionId, transcript.status])

  // Process exit listener
  useEffect(() => {
    return window.piApi.onProcessExit(() => {
      // Process crashed — could mark affected sessions
    })
  }, [])

  const handleSend = useCallback(
    async (message: string) => {
      if (!activeSessionId) return
      controller.current.addUserMessage(message)
      await prompt(activeSessionId, message)
    },
    [activeSessionId, controller],
  )

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return
    await abort(activeSessionId)
  }, [activeSessionId])

  const handleNewSession = useCallback(async () => {
    try {
      const sessionId = await createSession(window.piApi.getCwd())
      addSession(sessionId)
      setActiveSession(sessionId)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [addSession, setActiveSession])

  const handleSwitchSession = useCallback(
    (sessionId: string) => {
      setActiveSession(sessionId)
    },
    [setActiveSession],
  )

  // No active session — show welcome
  if (!activeSessionId) {
    return (
      <div className="flex h-screen" data-testid="app-shell">
        <Sidebar
          sessions={sessions}
          activeSessionId={activeSessionId}
          isStreaming={false}
          onNewSession={handleNewSession}
          onSwitchSession={handleSwitchSession}
        />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">pi</div>
            <div className="text-sm text-text-secondary mb-4">Start a new session</div>
            <button
              onClick={handleNewSession}
              className="px-4 py-2 rounded-lg bg-accent text-bg-primary text-sm font-medium hover:bg-accent-hover transition-colors"
            >
              New Session
            </button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen" data-testid="app-shell">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isStreaming={transcript.status !== 'idle'}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={transcript.status} model={activeSession?.model?.name ?? ''} />
        <MessageList
          nodes={transcript.nodes}
          activeAssistantId={transcript.activeAssistantId}
          controller={controller}
        />
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={transcript.status !== 'idle'}
        />
      </div>
    </div>
  )
}

export default App
