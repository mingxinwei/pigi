import { useRef, useCallback, KeyboardEvent } from 'react'

interface ChatInputProps {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
}

export default function ChatInput({
  onSend,
  onAbort,
  isStreaming,
}: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    const msg = el.value.trim()
    if (!msg) return
    el.value = ''
    el.style.height = 'auto'
    onSend(msg)
  }, [onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isStreaming) handleSend()
      }
    },
    [handleSend, isStreaming],
  )

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) return
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 160) + 'px'
  }, [])

  return (
    <div className="border-t border-border-primary px-4 py-3">
      <div className="max-w-3xl mx-auto flex items-end gap-2">
        <textarea
          ref={textareaRef}
          onKeyDown={handleKeyDown}
          onInput={handleInput}
          placeholder="Send a message…"
          rows={1}
          className="flex-1 bg-bg-input border border-border-primary rounded-lg px-3 py-2 text-sm text-text-primary placeholder-text-muted resize-none focus:outline-none focus:border-accent transition-colors"
          style={{ minHeight: 38, maxHeight: 160 }}
        />
        {isStreaming ? (
          <button
            onClick={onAbort}
            className="px-4 py-2 rounded-lg bg-red text-white text-sm font-medium hover:opacity-90 transition-opacity"
          >
            Stop
          </button>
        ) : (
          <button
            onClick={handleSend}
            className="px-4 py-2 rounded-lg bg-accent text-bg-primary text-sm font-medium hover:bg-accent-hover transition-colors"
          >
            Send
          </button>
        )}
      </div>
    </div>
  )
}
