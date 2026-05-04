import { useRef, useEffect, useCallback } from 'react'
import type {
  TranscriptNode,
  AssistantNode,
  TranscriptController,
} from '../state/transcriptController'
import ToolBlock from './ToolBlock'
import { ScrollArea } from './ui/scroll-area'

interface MessageListProps {
  nodes: TranscriptNode[]
  activeAssistantId: string | null
  controller: React.RefObject<TranscriptController>
}

export default function MessageList({
  nodes,
  activeAssistantId,
  controller,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef<HTMLDivElement>(null)
  const thinkingRef = useRef<HTMLPreElement>(null)
  const isAutoScrollRef = useRef(true)

  const getViewport = useCallback((): HTMLDivElement | null => {
    return containerRef.current?.querySelector('[data-slot="scroll-area-viewport"]') ?? null
  }, [])

  const scrollToBottom = useCallback(() => {
    const el = getViewport()
    if (el && isAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [getViewport])

  useEffect(() => {
    scrollToBottom()
  }, [nodes, scrollToBottom])

  useEffect(() => {
    if (!activeAssistantId) {
      return
    }

    let rafId: number
    const update = (): void => {
      const state = controller.current.state
      const assistant = state.nodes.find((n) => n.id === activeAssistantId) as
        | AssistantNode
        | undefined
      if (assistant) {
        const el = streamingRef.current
        if (el && el.textContent !== assistant.text) {
          el.textContent = assistant.text
        }
        const thinkPre = thinkingRef.current
        if (thinkPre && thinkPre.textContent !== assistant.thinking) {
          thinkPre.textContent = assistant.thinking
        }
      }
      scrollToBottom()
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [activeAssistantId, controller, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = getViewport()
    if (!el) {
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    isAutoScrollRef.current = atBottom
  }, [getViewport])

  return (
    <ScrollArea
      ref={containerRef}
      onScrollCapture={handleScroll}
      className="flex-1 bg-background"
      data-testid="message-list"
    >
      <div className="mx-auto max-w-[720px] px-5 pb-48 pt-12">
        {nodes.length === 0 && <div style={{ minHeight: '60vh' }} />}

        <div className="space-y-9">
          {nodes.map((node) => (
            <NodeRenderer
              key={node.id}
              node={node}
              isStreaming={node.id === activeAssistantId}
              streamingRef={node.id === activeAssistantId ? streamingRef : undefined}
              thinkingRef={node.id === activeAssistantId ? thinkingRef : undefined}
            />
          ))}
        </div>
      </div>
    </ScrollArea>
  )
}

function NodeRenderer({
  node,
  isStreaming,
  streamingRef,
  thinkingRef,
}: {
  node: TranscriptNode
  isStreaming: boolean
  streamingRef?: React.RefObject<HTMLDivElement | null>
  thinkingRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return <UserBubble text={node.text} />
    case 'assistant':
      return (
        <AssistantBubble
          node={node}
          isStreaming={isStreaming}
          streamingRef={streamingRef}
          thinkingRef={thinkingRef}
        />
      )
    case 'tool':
      return <ToolBlock node={node} />
    case 'system':
      return <SystemBubble text={node.text} />
  }
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-end" data-testid="user-message">
      <div className="max-w-[58%] rounded-2xl bg-muted px-3.5 py-1.5 text-[14px] leading-6 text-foreground">
        {text}
      </div>
    </div>
  )
}

function AssistantBubble({
  node,
  isStreaming,
  streamingRef,
  thinkingRef,
}: {
  node: AssistantNode
  isStreaming: boolean
  streamingRef?: React.RefObject<HTMLDivElement | null>
  thinkingRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  return (
    <div className="flex justify-start" data-testid="assistant-message">
      <div className="max-w-[680px] min-w-0 text-[14px] leading-6 text-foreground">
        {isStreaming && (
          <pre
            ref={thinkingRef}
            className="mb-3 whitespace-pre-wrap break-words border-l-2 border-border pl-3 font-mono text-[12px] leading-5 text-muted-foreground"
          />
        )}

        {!isStreaming && node.thinking && (
          <details className="mb-3 text-[13px] text-muted-foreground">
            <summary className="cursor-pointer select-none hover:text-foreground">Thinking</summary>
            <pre className="mt-2 max-h-44 overflow-y-auto whitespace-pre-wrap break-words border-l-2 border-border pl-3 font-mono text-[12px] leading-5">
              {node.thinking}
            </pre>
          </details>
        )}

        {isStreaming ? (
          <div ref={streamingRef} className="whitespace-pre-wrap break-words" />
        ) : (
          <div className="whitespace-pre-wrap break-words">{node.text}</div>
        )}

        {node.errorMessage && (
          <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[13px] text-destructive">
            {node.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function SystemBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-center" data-testid="system-message">
      <div className="text-[13px] text-muted-foreground">{text}</div>
    </div>
  )
}
