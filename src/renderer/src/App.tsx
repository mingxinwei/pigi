import { useEffect, useRef, useCallback } from 'react'
import { useAppStore } from './state/app-store'
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
 * This is acknowledged technical debt per plan.md Phase 1 tasks.
 */
function App(): React.JSX.Element {
  const {
    runtimeStatus,
    runtimeError,
    agentStatus,
    model,
    setRuntimeReady,
    setRuntimeError,
    setAgentStatus,
    setModel,
    setThinkingLevel,
    setSession,
  } = useAppStore()

  const messagesRef = useRef<ChatMessage[]>([])
  const setMessagesState = useRef<React.Dispatch<React.SetStateAction<ChatMessage[]>> | null>(null)
  const streamingRef = useRef<HTMLPreElement>(null)
  const streamingTextRef = useRef('')
  const currentAssistantIdRef = useRef<string | null>(null)

  // Use a simple state for messages (will move to transcript controller in Phase 1)
  const [messages, setMessages] = useMessagesState()
  setMessagesState.current = setMessages
  messagesRef.current = messages

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
  }, [setMessages])

  // Listen for runtime lifecycle events
  useEffect(() => {
    const removeReady = window.piApi.onRuntimeReady((data) => {
      setRuntimeReady()
      if (data.model) setModel(data.model)
      if (data.thinkingLevel) setThinkingLevel(data.thinkingLevel)
      setSession({ sessionId: data.sessionId })
    })

    const removeError = window.piApi.onRuntimeError((data) => {
      setRuntimeError(data.error)
    })

    return () => {
      removeReady()
      removeError()
    }
  }, [setRuntimeReady, setRuntimeError, setModel, setThinkingLevel, setSession])

  // Listen for agent events
  useEffect(() => {
    const removeEvent = window.piApi.onEvent((raw: unknown) => {
      const event = raw as PiEvent

      switch (event.type) {
        case 'agent_start': {
          setAgentStatus('streaming')
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
          setAgentStatus('idle')
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
          setAgentStatus('tool_running')
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'tool',
              content: '',
              toolName: event.toolName as string,
            },
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
          setAgentStatus('streaming')
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
          // Prepare for next assistant text
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

    const removeError = window.piApi.onError((err) => {
      console.error('[pi:error]', err.error)
    })

    return () => {
      removeEvent()
      removeError()
    }
  }, [appendStreamDelta, finalizeStreaming, setAgentStatus, setMessages])

  const handleSend = useCallback(async (message: string) => {
    setMessages((prev) => [...prev, { id: nextId(), role: 'user', content: message }])
    await window.piApi.prompt(message)
  }, [setMessages])

  const handleAbort = useCallback(async () => {
    await window.piApi.abort()
  }, [])

  const handleNewSession = useCallback(async () => {
    await window.piApi.newSession()
    setMessages([])
    setAgentStatus('idle')
  }, [setMessages, setAgentStatus])

  // Runtime initialization overlay
  if (runtimeStatus === 'initializing') {
    return (
      <div className="flex h-screen items-center justify-center" data-testid="init-screen">
        <div className="text-center">
          <div className="text-sm text-text-secondary mb-2">Initializing pi runtime...</div>
          <div className="w-4 h-4 border-2 border-accent border-t-transparent rounded-full animate-spin mx-auto" />
        </div>
      </div>
    )
  }

  if (runtimeStatus === 'error') {
    return (
      <div className="flex h-screen items-center justify-center" data-testid="error-screen">
        <div className="text-center max-w-md">
          <div className="text-sm text-red mb-2">Failed to initialize pi runtime</div>
          <div className="text-xs text-text-muted font-mono bg-bg-tertiary rounded p-3">
            {runtimeError}
          </div>
        </div>
      </div>
    )
  }

  return (
    <div className="flex h-screen" data-testid="app-shell">
      <Sidebar isStreaming={agentStatus !== 'idle'} onNewSession={handleNewSession} />

      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={agentStatus} model={model?.name ?? ''} />
        <MessageList messages={messages} streamingRef={streamingRef} />
        <ChatInput onSend={handleSend} onAbort={handleAbort} isStreaming={agentStatus !== 'idle'} />
      </div>
    </div>
  )
}

// Temporary hook until transcript controller in Phase 1
import { useState } from 'react'
function useMessagesState(): [ChatMessage[], React.Dispatch<React.SetStateAction<ChatMessage[]>>] {
  return useState<ChatMessage[]>([])
}

export default App
