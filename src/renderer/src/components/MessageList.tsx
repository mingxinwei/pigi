import { useRef, useEffect, useCallback } from 'react'
import type { ChatMessage } from '../state/appStore'

interface MessageListProps {
  messages: ChatMessage[]
  streamingRef: React.RefObject<HTMLPreElement | null>
}

export default function MessageList({
  messages,
  streamingRef,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const isAutoScrollRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el && isAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Auto-scroll on new messages
  useEffect(() => {
    scrollToBottom()
  }, [messages, scrollToBottom])

  // Set up MutationObserver for streaming text changes
  useEffect(() => {
    const pre = streamingRef.current
    if (!pre) return
    const observer = new MutationObserver(() => {
      scrollToBottom()
    })
    observer.observe(pre, { childList: true, characterData: true, subtree: true })
    return () => observer.disconnect()
  }, [streamingRef, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    isAutoScrollRef.current = atBottom
  }, [])

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {messages.length === 0 && (
          <div className="text-center text-text-muted py-20">
            <div className="text-2xl mb-2">🥧</div>
            <div className="text-sm">Start a conversation with pi</div>
          </div>
        )}

        {messages.map((msg) => (
          <MessageBubble
            key={msg.id}
            message={msg}
            streamingRef={msg.isStreaming ? streamingRef : undefined}
          />
        ))}
      </div>
    </div>
  )
}

function MessageBubble({
  message,
  streamingRef,
}: {
  message: ChatMessage
  streamingRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  if (message.role === 'user') {
    return (
      <div className="flex justify-end">
        <div className="max-w-[80%] bg-accent/10 border border-accent/20 rounded-lg px-4 py-2.5">
          <pre className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary">
            {message.content}
          </pre>
        </div>
      </div>
    )
  }

  if (message.role === 'tool') {
    return (
      <div className="flex justify-start">
        <div className="max-w-[90%] bg-bg-tertiary border border-border-secondary rounded-lg px-3 py-2">
          <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
            <span className="text-orange">⚡</span>
            <span className="font-mono">{message.toolName || 'tool'}</span>
          </div>
          <pre className="text-xs text-text-secondary whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
            {message.content}
          </pre>
        </div>
      </div>
    )
  }

  // Assistant message
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        {message.isStreaming ? (
          <pre
            ref={streamingRef}
            className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary leading-relaxed"
          />
        ) : (
          <pre className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary leading-relaxed">
            {message.content}
          </pre>
        )}
      </div>
    </div>
  )
}
