import { useState, useEffect, useRef, useCallback } from 'react'
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

function App(): React.JSX.Element {
  const [status, setStatus] = useState<'idle' | 'streaming' | 'tool_executing'>('idle')
  const [messages, setMessages] = useState<ChatMessage[]>([])
  const [model, setModel] = useState<string>('')
  const streamingRef = useRef<HTMLPreElement>(null)
  const streamingTextRef = useRef('')
  const currentAssistantIdRef = useRef<string | null>(null)

  // Fetch initial state
  useEffect(() => {
    window.api.getState().then((state) => {
      if (state?.model?.name) setModel(state.model.name)
    })
  }, [])

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
        prev.map((m) =>
          m.id === id ? { ...m, content: text, isStreaming: false } : m
        )
      )
    }
    currentAssistantIdRef.current = null
    streamingTextRef.current = ''
  }, [])

  useEffect(() => {
    const removeEvent = window.api.onEvent((raw: unknown) => {
      const event = raw as PiEvent

      switch (event.type) {
        case 'agent_start': {
          setStatus('streaming')
          streamingTextRef.current = ''
          const id = nextId()
          currentAssistantIdRef.current = id
          setMessages((prev) => [
            ...prev,
            { id, role: 'assistant', content: '', isStreaming: true }
          ])
          break
        }

        case 'agent_end':
          finalizeStreaming()
          setStatus('idle')
          break

        case 'message_update': {
          const ame = event.assistantMessageEvent as {
            type: string
            delta?: string
          } | undefined
          if (ame?.type === 'text_delta' && ame.delta) {
            appendStreamDelta(ame.delta)
          }
          break
        }

        case 'message_end':
          finalizeStreaming()
          break

        case 'tool_execution_start': {
          setStatus('tool_executing')
          setMessages((prev) => [
            ...prev,
            {
              id: nextId(),
              role: 'tool',
              content: '',
              toolName: event.toolName as string
            }
          ])
          break
        }

        case 'tool_execution_update': {
          const partialResult = event.partialResult as {
            content?: Array<{ text?: string }>
          } | undefined
          const text = partialResult?.content?.[0]?.text || ''
          if (text) {
            setMessages((prev) => {
              const lastTool = [...prev].reverse().find((m) => m.role === 'tool')
              if (lastTool) {
                return prev.map((m) =>
                  m.id === lastTool.id ? { ...m, content: text } : m
                )
              }
              return prev
            })
          }
          break
        }

        case 'tool_execution_end': {
          setStatus('streaming')
          const result = event.result as {
            content?: Array<{ text?: string }>
          } | undefined
          const text = result?.content?.[0]?.text || ''
          setMessages((prev) => {
            const lastTool = [...prev].reverse().find((m) => m.role === 'tool')
            if (lastTool) {
              return prev.map((m) =>
                m.id === lastTool.id ? { ...m, content: text || m.content } : m
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
              { id, role: 'assistant', content: '', isStreaming: true }
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
              { id, role: 'assistant', content: '', isStreaming: true }
            ])
          }
          break
        }
      }
    })

    const removeError = window.api.onError((err) => {
      console.error('[pi:error]', err.error)
    })

    return () => {
      removeEvent()
      removeError()
    }
  }, [appendStreamDelta, finalizeStreaming])

  const handleSend = useCallback(async (message: string) => {
    setMessages((prev) => [
      ...prev,
      { id: nextId(), role: 'user', content: message }
    ])
    await window.api.prompt(message)
  }, [])

  const handleAbort = useCallback(async () => {
    await window.api.abort()
  }, [])

  const handleNewSession = useCallback(async () => {
    await window.api.newSession()
    setMessages([])
    setStatus('idle')
  }, [])

  return (
    <div className="flex h-screen">
      <Sidebar isStreaming={status !== 'idle'} onNewSession={handleNewSession} />

      <div className="flex flex-col flex-1 min-w-0">
        <StatusBar status={status} model={model} />
        <MessageList messages={messages} streamingRef={streamingRef} />
        <ChatInput
          onSend={handleSend}
          onAbort={handleAbort}
          isStreaming={status !== 'idle'}
        />
      </div>
    </div>
  )
}

export default App
