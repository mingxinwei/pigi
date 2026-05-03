import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from './state/appStore'
import { createSession } from './services/piAgentClient'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import MessageList from './components/MessageList'
import ChatInput from './components/ChatInput'

interface PiEvent {
  type: string
  [key: string]: unknown
}

let messageIdCounter = 0
function nextId(): string {
  return `msg-${++messageIdCounter}`
}

/**
 * Tracks per-session streaming state (which assistant message is currently streaming).
 * This is mutable state that doesn't need to trigger re-renders.
 */
const streamingState = new Map<string, { assistantId: string; text: string }>()

function App(): React.JSX.Element {
  const {
    activeSessionId,
    sessions,
    addSession,
    setActiveSession,
    updateSession,
    appendMessage,
  } = useAppStore()

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
  const agentStatus = activeSession?.status ?? 'idle'

  // Ref to the streaming <pre> element for the active session (direct DOM mutation)
  const streamingRef = useRef<HTMLPreElement>(null)

  // Sync streaming text to DOM for active session
  const syncStreamingDom = useCallback(() => {
    if (!activeSessionId) return
    const state = streamingState.get(activeSessionId)
    if (streamingRef.current && state) {
      streamingRef.current.textContent = state.text
    }
  }, [activeSessionId])

  // Process events from ALL sessions (not just active)
  useEffect(() => {
    const removeEvent = window.piApi.onEvent(({ sessionId, event: raw }) => {
      const event = raw as PiEvent
      const store = useAppStore.getState()

      if (!store.sessions.has(sessionId)) return

      switch (event.type) {
        case 'agent_start': {
          store.updateSession(sessionId, { status: 'streaming' })
          const id = nextId()
          streamingState.set(sessionId, { assistantId: id, text: '' })
          store.appendMessage(sessionId, { id, role: 'assistant', content: '', isStreaming: true })
          break
        }

        case 'agent_end': {
          const state = streamingState.get(sessionId)
          if (state) {
            store.updateMessage(sessionId, state.assistantId, {
              content: state.text,
              isStreaming: false,
            })
            streamingState.delete(sessionId)
          }
          store.updateSession(sessionId, { status: 'idle' })
          break
        }

        case 'message_update': {
          const ame = event.assistantMessageEvent as { type: string; delta?: string } | undefined
          if (ame?.type === 'text_delta' && ame.delta) {
            const state = streamingState.get(sessionId)
            if (state) {
              state.text += ame.delta
              // Only mutate DOM if this is the active session
              if (sessionId === store.activeSessionId) {
                syncStreamingDom()
              }
            }
          }
          break
        }

        case 'message_end': {
          const endMsg = event.message as { role?: string; errorMessage?: string } | undefined
          if (endMsg?.role === 'assistant') {
            const state = streamingState.get(sessionId)
            if (state) {
              if (endMsg.errorMessage) {
                state.text = `Error: ${endMsg.errorMessage}`
              }
              store.updateMessage(sessionId, state.assistantId, {
                content: state.text,
                isStreaming: false,
              })
              streamingState.delete(sessionId)
            }
          }
          break
        }

        case 'tool_execution_start': {
          store.updateSession(sessionId, { status: 'tool_running' })
          store.appendMessage(sessionId, {
            id: nextId(),
            role: 'tool',
            content: '',
            toolName: event.toolName as string,
          })
          break
        }

        case 'tool_execution_update': {
          const partialResult = event.partialResult as { content?: Array<{ text?: string }> } | undefined
          const text = partialResult?.content?.[0]?.text || ''
          if (text) {
            const session = store.sessions.get(sessionId)
            if (session) {
              const lastTool = [...session.messages].reverse().find((m) => m.role === 'tool')
              if (lastTool) {
                store.updateMessage(sessionId, lastTool.id, { content: text })
              }
            }
          }
          break
        }

        case 'tool_execution_end': {
          store.updateSession(sessionId, { status: 'streaming' })
          const result = event.result as { content?: Array<{ text?: string }> } | undefined
          const text = result?.content?.[0]?.text || ''
          const session = store.sessions.get(sessionId)
          if (session) {
            const lastTool = [...session.messages].reverse().find((m) => m.role === 'tool')
            if (lastTool && text) {
              store.updateMessage(sessionId, lastTool.id, { content: text })
            }
          }
          // Prepare next assistant message if needed
          if (!streamingState.has(sessionId)) {
            const id = nextId()
            streamingState.set(sessionId, { assistantId: id, text: '' })
            store.appendMessage(sessionId, { id, role: 'assistant', content: '', isStreaming: true })
          }
          break
        }

        case 'turn_start': {
          if (!streamingState.has(sessionId)) {
            const id = nextId()
            streamingState.set(sessionId, { assistantId: id, text: '' })
            store.appendMessage(sessionId, { id, role: 'assistant', content: '', isStreaming: true })
          }
          break
        }
      }
    })

    const removeError = window.piApi.onError(({ sessionId, error }) => {
      console.error(`[pi:error] session=${sessionId}`, error)
    })

    return () => {
      removeEvent()
      removeError()
    }
  }, [syncStreamingDom])

  // Subscribe to stream batches for ALL sessions
  useEffect(() => {
    const unsubscribes: Array<() => void> = []

    for (const [sessionId] of sessions) {
      const unsub = window.piApi.onStreamBatch(sessionId, (batch) => {
        const b = batch as { text?: Record<string, string> }
        if (b.text) {
          const state = streamingState.get(sessionId)
          if (state) {
            for (const delta of Object.values(b.text)) {
              state.text += delta
            }
            if (sessionId === useAppStore.getState().activeSessionId) {
              syncStreamingDom()
            }
          }
        }
      })
      unsubscribes.push(unsub)
    }

    return () => unsubscribes.forEach((fn) => fn())
  }, [sessions, syncStreamingDom])

  // When switching to a session, sync its streaming state to DOM
  useEffect(() => {
    syncStreamingDom()
  }, [activeSessionId, syncStreamingDom])

  // Session lifecycle listeners
  useEffect(() => {
    const removeReady = window.piApi.onSessionReady((data) => {
      updateSession(data.sessionId, {
        model: data.model as { name: string; provider: string; id: string } | null,
        thinkingLevel: data.thinkingLevel,
        status: 'idle',
      })
    })

    const removeError = window.piApi.onSessionError((data) => {
      updateSession(data.sessionId, { error: data.error, status: 'error' })
    })

    const removeProcessExit = window.piApi.onProcessExit(() => {
      // All sessions are gone if process crashes
    })

    return () => {
      removeReady()
      removeError()
      removeProcessExit()
    }
  }, [updateSession])

  const handleSend = useCallback(async (message: string) => {
    if (!activeSessionId) return
    appendMessage(activeSessionId, { id: nextId(), role: 'user', content: message })
    await window.piApi.prompt(activeSessionId, message)
  }, [activeSessionId, appendMessage])

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return
    await window.piApi.abort(activeSessionId)
  }, [activeSessionId])

  const handleNewSession = useCallback(async () => {
    try {
      const sessionId = await createSession(process.cwd?.() || '.')
      addSession(sessionId)
      setActiveSession(sessionId)
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [addSession, setActiveSession])

  const handleSwitchSession = useCallback((sessionId: string) => {
    setActiveSession(sessionId)
  }, [setActiveSession])

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

  const activeMessages = activeSession?.messages ?? []

  return (
    <div className="flex h-screen" data-testid="app-shell">
      <Sidebar
        sessions={sessions}
        activeSessionId={activeSessionId}
        isStreaming={agentStatus !== 'idle'}
        onNewSession={handleNewSession}
        onSwitchSession={handleSwitchSession}
      />

      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={agentStatus} model={activeSession?.model?.name ?? ''} />
        <MessageList messages={activeMessages} streamingRef={streamingRef} />
        <ChatInput onSend={handleSend} onAbort={handleAbort} isStreaming={agentStatus !== 'idle'} />
      </div>
    </div>
  )
}

export default App
