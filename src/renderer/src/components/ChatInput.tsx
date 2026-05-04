import { useRef, useCallback, KeyboardEvent } from 'react'
import { ArrowUp, GitBranch, HardDrive, Plus, Square } from 'lucide-react'
import type { ProjectDirectory } from '../../../shared/ipcContract'
import { Button } from './ui/button'
import { Textarea } from './ui/textarea'

interface ChatInputProps {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
  project: ProjectDirectory | null
}

export default function ChatInput({
  onSend,
  onAbort,
  isStreaming,
  project,
}: ChatInputProps): React.JSX.Element {
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const handleSend = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    const msg = el.value.trim()
    if (!msg) {
      return
    }
    el.value = ''
    el.style.height = 'auto'
    onSend(msg)
  }, [onSend])

  const handleKeyDown = useCallback(
    (e: KeyboardEvent<HTMLTextAreaElement>) => {
      if (e.nativeEvent.isComposing || e.key === 'Process') {
        return
      }

      if (e.key === 'Escape' && isStreaming) {
        e.preventDefault()
        onAbort()
        return
      }

      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault()
        if (!isStreaming) {
          handleSend()
        }
      }
    },
    [handleSend, isStreaming, onAbort],
  )

  const handleInput = useCallback(() => {
    const el = textareaRef.current
    if (!el) {
      return
    }
    el.style.height = 'auto'
    el.style.height = Math.min(el.scrollHeight, 128) + 'px'
  }, [])

  return (
    <div
      className="pointer-events-none absolute left-0 right-0 z-10 flex justify-center"
      style={{ bottom: 36, paddingLeft: 32, paddingRight: 32 }}
      data-testid="chat-input"
    >
      <div className="pointer-events-auto" style={{ width: 'min(720px, 100%)' }}>
        <div
          className="border border-[#d9d9d5] bg-white shadow-[0_10px_34px_rgba(0,0,0,0.075)]"
          style={{ borderRadius: 18 }}
        >
          <Textarea
            ref={textareaRef}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Ask for follow-up changes"
            rows={1}
            className="resize-none border-0 bg-transparent text-[14px] leading-5 shadow-none placeholder:text-[#a1a1a1] focus-visible:ring-0"
            style={{ minHeight: 48, maxHeight: 128, padding: '13px 16px 8px' }}
            data-testid="chat-textarea"
          />
          <div
            className="flex items-center justify-between"
            style={{ padding: '0 10px 10px 10px' }}
          >
            <Button
              variant="ghost"
              size="icon-sm"
              className="rounded-full text-[#7c7c7c] hover:bg-[#f1f1ef]"
              style={{ width: 28, height: 28 }}
            >
              <Plus className="size-4" />
            </Button>
            {isStreaming ? (
              <Button
                onClick={onAbort}
                size="icon-sm"
                className="rounded-full bg-[#707070] text-white hover:bg-[#555]"
                style={{ width: 28, height: 28 }}
                data-testid="abort-button"
              >
                <Square className="size-3 fill-current" />
              </Button>
            ) : (
              <Button
                onClick={handleSend}
                size="icon-sm"
                className="rounded-full bg-[#8f8f8f] text-white hover:bg-[#6f6f6f]"
                style={{ width: 28, height: 28 }}
                data-testid="send-button"
              >
                <ArrowUp className="size-4" />
              </Button>
            )}
          </div>
        </div>

        <div
          className="flex items-center gap-4 text-[12px] text-[#8b8f94]"
          style={{ padding: '10px 16px 0' }}
        >
          <span className="flex items-center gap-1.5">
            <HardDrive className="size-3.5" />
            Work locally
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <GitBranch className="size-3.5 shrink-0" />
            <span className="truncate">{project?.name ?? 'current directory'}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
