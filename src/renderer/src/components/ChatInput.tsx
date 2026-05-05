import { useRef, useCallback, KeyboardEvent } from 'react'
import {
  IconArrowUp,
  IconDeviceDesktop,
  IconGitBranch,
  IconPlus,
  IconSquare,
} from '@tabler/icons-react'
import type { ProjectDirectory } from '../../../shared/ipcContract'
import { InputGroup, InputGroupAddon, InputGroupButton, InputGroupTextarea } from './ui/input-group'

interface ChatInputProps {
  onSend: (message: string) => void
  onAbort: () => void
  isStreaming: boolean
  project: ProjectDirectory | null
}

const CONTENT_MAX_WIDTH = 680

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
      className="pointer-events-none absolute inset-x-0 bottom-0 z-10 bg-linear-to-t from-background via-background/95 to-transparent px-8 pb-3 pt-10"
      data-testid="chat-input"
    >
      <div
        className="pointer-events-auto mx-auto w-full"
        style={{ maxWidth: `${CONTENT_MAX_WIDTH}px` }}
      >
        <InputGroup className="h-auto flex-col rounded-3xl bg-background shadow-[0_10px_34px_rgb(0_0_0_/_0.075)] has-[[data-slot=input-group-control]:focus-visible]:border-input has-[[data-slot=input-group-control]:focus-visible]:ring-0">
          <InputGroupTextarea
            ref={textareaRef}
            onKeyDown={handleKeyDown}
            onInput={handleInput}
            placeholder="Ask for follow-up changes"
            rows={1}
            className="min-h-12 max-h-32 px-4 pt-3.5 pb-2 text-sm leading-5 placeholder:text-muted-foreground/70"
            data-testid="chat-textarea"
          />
          <InputGroupAddon align="block-end" className="justify-between px-2.5 pb-2.5 pt-0">
            <InputGroupButton size="icon-sm" variant="ghost" className="rounded-full">
              <IconPlus />
            </InputGroupButton>
            {isStreaming ? (
              <InputGroupButton
                onClick={onAbort}
                size="icon-sm"
                variant="default"
                className="rounded-full"
                data-testid="abort-button"
              >
                <IconSquare className="fill-current" />
              </InputGroupButton>
            ) : (
              <InputGroupButton
                onClick={handleSend}
                size="icon-sm"
                variant="default"
                className="rounded-full bg-muted-foreground text-background hover:bg-foreground"
                data-testid="send-button"
              >
                <IconArrowUp />
              </InputGroupButton>
            )}
          </InputGroupAddon>
        </InputGroup>

        <div className="flex items-center gap-4 px-4 pt-1.5 text-sm text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <IconDeviceDesktop className="size-4" />
            Work locally
          </span>
          <span className="flex min-w-0 items-center gap-1.5">
            <IconGitBranch className="size-4 shrink-0" />
            <span className="truncate">{project?.name ?? 'current directory'}</span>
          </span>
        </div>
      </div>
    </div>
  )
}
