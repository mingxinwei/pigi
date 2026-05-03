import { useEffect, useRef, useCallback, useState } from 'react'
import { useAppStore } from './state/app-store'
import { createSession } from './services/piAgentClient'
import Sidebar from './components/Sidebar'
import StatusBar from './components/StatusBar'
import MessageList, { ChatMessage } from './components/MessageList'
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
 * Temporary: event handling lives here until Phase 1 transcript controller.
 */
function App(): React.JSX.Element {
  const {
    activeSessionId,
    sessions,
    addSession,
    setActiveSession,
    updateSession,
  } = useAppStore()

  const [messages, setMessages] = useState<ChatMessage[]>([])
  const streamingRef = useRef<HTMLPreElement>(null)
  const streamingTextRef = useRef('')
  const currentAssistantIdRef = useRef<string | null>(null)

  const activeSession = activeSessionId ? sessions.get(activeSessionId) : null
  const agentStatus = activeSession?.status ?? 'idle'

  const appendStreamDelta = useCallback((delta: string) => {
    streamingTextRef.current += delta
    if (streamingRef.current) {
      streamingRef.current.textContent = streamingTextRef.current
    }
  }, [])

  const finalizeStreaming = useCallback(() => {
    const id = currentAssistantIdRef.current
    const text = streamingTextRef.current
    if (id) {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, content: text, isStreaming: false } : m)),
      )
    }
    currentAssistantIdRef.current = null
    streamingTextRef.current = ''
  }, [])

  // Listen for session lifecycle
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

    const removeProcessExit = window.piApi.onAgentProcessExit(() => {
      // All sessions are gone
    })

    return () => {
      removeReady()
      removeError()
      removeProcessExit()
    }
  }, [updateSession])

  // Listen for session events (scoped by activeSessionId)
  useEffect(() => {
    const removeEvent = window.piApi.onEvent(({ sessionId, event: raw }) => {
      // Only process events for the active session
      if (sessionId !== activeSessionId) return
      const event = raw as PiEvent

      switch (event.type) {
        case 'agent_start': {
          if (activeSessionId) updateSession(activeSessionId, { status: 'streaming' })
          streamingTextRef.current = ''
          const id = nextId()
          currentAssistantIdRef.current = id
          setMessages((prev) => [
            ...prev,
            { id, role: 'assistant', content: '', isStreaming: true },
          ])
          break
        }

        case 'agent_end':
          finalizeStreaming()
          if (activeSessionId) updateSession(activeSessionId, { status: 'idle' })
          break

        case 'message_update': {
          const ame = event.assistantMessageEvent as
            | { type: string; delta?: string }
            | undefined
          if (ame?.type === 'text_delta' && ame.delta) {
            appendStreamDelta(ame.delta)
          }
          break
        }

        case 'message_end': {
          const endMsg = event.message as { role?: string; errorMessage?: string } | undefined
          if (endMsg?.role === 'assistant') {
            if (endMsg?.errorMessage) {
              streamingTextRef.current = `Error: ${endMsg.errorMessage}`
            }
            finalizeStreaming()
          }
          break
        }

        case 'tool_execution_start': {
          if (activeSessionId) updateSession(activeSessionId, { status: 'tool_running' })
          setMessages((prev) => [
            ...prev,
            { id: nextId(), role: 'tool', content: '', toolName: event.toolName as string },
          ])
          break
        }

        case 'tool_execution_update': {
          const partialResult = event.partialResult as
            | { content?: Array<{ text?: string }> }
            | undefined
          const text = partialResult?.content?.[0]?.text || ''
          if (text) {
            setMessages((prev) => {
              const lastTool = [...prev].reverse().find((m) => m.role === 'tool')
              if (lastTool) {
                return prev.map((m) => (m.id === lastTool.id ? { ...m, content: text } : m))
              }
              return prev
            })
          }
          break
        }

        case 'tool_execution_end': {
          if (activeSessionId) updateSession(activeSessionId, { status: 'streaming' })
          const result = event.result as
            | { content?: Array<{ text?: string }> }
            | undefined
          const text = result?.content?.[0]?.text || ''
          setMessages((prev) => {
            const lastTool = [...prev].reverse().find((m) => m.role === 'tool')
            if (lastTool) {
              return prev.map((m) =>
                m.id === lastTool.id ? { ...m, content: text || m.content } : m,
              )
            }
            return prev
          })
          if (!currentAssistantIdRef.current) {
            streamingTextRef.current = ''
            const id = nextId()
            currentAssistantIdRef.current = id
            setMessages((prev) => [
              ...prev,
              { id, role: 'assistant', content: '', isStreaming: true },
            ])
          }
          break
        }

        case 'turn_start': {
          if (!currentAssistantIdRef.current) {
            streamingTextRef.current = ''
            const id = nextId()
            currentAssistantIdRef.current = id
            setMessages((prev) => [
              ...prev,
              { id, role: 'assistant', content: '', isStreaming: true },
            ])
          }
          break
        }
      }
    })

    const removeError = window.piApi.onError(({ sessionId, error }) => {
      if (sessionId === activeSessionId) {
        console.error('[pi:error]', error)
      }
    })

    return () => {
      removeEvent()
      removeError()
    }
  }, [activeSessionId, appendStreamDelta, finalizeStreaming, updateSession])

  // Subscribe to stream batches for active session
  useEffect(() => {
    if (!activeSessionId) return
    return window.piApi.onStreamBatch(activeSessionId, (batch) => {
      const b = batch as { text?: Record<string, string> }
      if (b.text) {
        for (const delta of Object.values(b.text)) {
          appendStreamDelta(delta)
        }
      }
    })
  }, [activeSessionId, appendStreamDelta])

  const handleSend = useCallback(async (message: string) => {
    if (!activeSessionId) return
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: message }])
    await window.piApi.prompt(activeSessionId, message)
  }, [activeSessionId])

  const handleAbort = useCallback(async () => {
    if (!activeSessionId) return
    await window.piApi.abort(activeSessionId)
  }, [activeSessionId])

  const handleNewSession = useCallback(async () => {
    try {
      const sessionId = await createSession(process.cwd?.() || '.')
      addSession(sessionId)
      setActiveSession(sessionId)
      setMessages([])
    } catch (err) {
      console.error('Failed to create session:', err)
    }
  }, [addSession, setActiveSession])

  // No active session — show welcome
  if (!activeSessionId) {
    return (
      <div className="flex h-screen" data-testid="app-shell">
        <Sidebar isStreaming={false} onNewSession={handleNewSession} />
        <div className="flex flex-1 items-center justify-center">
          <div className="text-center">
            <div className="text-2xl mb-2">🥧</div>
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
      <Sidebar isStreaming={agentStatus !== 'idle'} onNewSession={handleNewSession} />

      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={agentStatus} model={activeSession?.model?.name ?? ''} />
        <MessageList messages={messages} streamingRef={streamingRef} />
        <ChatInput onSend={handleSend} onAbort={handleAbort} isStreaming={agentStatus !== 'idle'} />
      </div>
    </div>
  )
}

export default App
