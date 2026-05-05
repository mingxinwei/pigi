import { useRef, useEffect, useCallback } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type {
  TranscriptNode,
  AssistantNode,
  TranscriptController,
} from '../state/transcriptController'
import { MESSAGE_LIST_MAX_WIDTH } from '../lib/layoutConstants'
import ToolBlock from './ToolBlock'

interface MessageListProps {
  nodes: TranscriptNode[]
  activeAssistantId: string | null
  controller: React.RefObject<TranscriptController>
}

const CHAT_INPUT_AREA_HEIGHT = 172

export default function MessageList({
  nodes,
  activeAssistantId,
  controller,
}: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const streamingRef = useRef<HTMLDivElement>(null)
  const thinkingRef = useRef<HTMLPreElement>(null)
  const isAutoScrollRef = useRef(true)

  // TanStack Virtual returns imperative measurement helpers; this follows its documented React pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: nodes.length,
    getScrollElement: () => containerRef.current,
    estimateSize: (index) => estimateNodeHeight(nodes[index]),
    overscan: 8,
  })

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el && isAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  useEffect(() => {
    scrollToBottom()
    rowVirtualizer.measure()
  }, [nodes, rowVirtualizer, scrollToBottom])

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
      rowVirtualizer.measure()
      scrollToBottom()
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [activeAssistantId, controller, rowVirtualizer, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) {
      return
    }
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    isAutoScrollRef.current = atBottom
  }, [])

  const virtualItems = rowVirtualizer.getVirtualItems()

  return (
    <div
      ref={containerRef}
      onScroll={handleScroll}
      className="min-h-0 flex-1 overflow-y-auto bg-background"
      style={{ paddingBottom: `${CHAT_INPUT_AREA_HEIGHT}px` }}
      data-testid="message-list"
    >
      <div className="mx-auto px-5 pb-8 pt-14" style={{ maxWidth: `${MESSAGE_LIST_MAX_WIDTH}px` }}>
        {nodes.length === 0 && <div style={{ minHeight: '60vh' }} />}

        <div
          className="relative"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          data-testid="message-virtualizer"
        >
          {virtualItems.map((virtualItem) => {
            const node = nodes[virtualItem.index]
            return (
              <div
                key={node.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute left-0 top-0 w-full py-2.5"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <NodeRenderer
                  node={node}
                  isStreaming={node.id === activeAssistantId}
                  streamingRef={node.id === activeAssistantId ? streamingRef : undefined}
                  thinkingRef={node.id === activeAssistantId ? thinkingRef : undefined}
                />
              </div>
            )
          })}
        </div>
      </div>
    </div>
  )
}

function estimateNodeHeight(node: TranscriptNode | undefined): number {
  if (!node) {
    return 96
  }
  switch (node.role) {
    case 'user':
      return Math.max(56, Math.ceil(node.text.length / 72) * 24 + 32)
    case 'assistant':
      return Math.max(80, Math.ceil((node.text.length + node.thinking.length) / 84) * 24 + 56)
    case 'tool':
      return Math.max(72, Math.ceil(node.output.length / 88) * 20 + 40)
    case 'system':
      return 56
  }
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
      <div className="w-fit min-w-16 max-w-[min(76%,680px)] rounded-2xl bg-muted px-3.5 py-1.5 text-[15px] leading-6 text-foreground">
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
      <div className="max-w-[680px] min-w-0 text-[15px] leading-6 text-foreground">
        {isStreaming && <ThinkingBlock text="" contentRef={thinkingRef} />}

        {!isStreaming && node.thinking && <ThinkingBlock text={node.thinking} />}

        {isStreaming ? (
          <div ref={streamingRef} className="whitespace-pre-wrap break-words" />
        ) : (
          <div className="whitespace-pre-wrap break-words">{node.text}</div>
        )}

        {node.errorMessage && (
          <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
            {node.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({
  text,
  contentRef,
}: {
  text: string
  contentRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  return (
    <div className="mb-4 rounded-md bg-muted/35 px-3 py-2 text-muted-foreground">
      <div className="mb-1.5 text-[14px] font-medium">Thinking</div>
      <pre
        ref={contentRef}
        className="whitespace-pre-wrap break-words font-sans text-[15px] leading-6 text-muted-foreground"
      >
        {text}
      </pre>
    </div>
  )
}

function SystemBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-center" data-testid="system-message">
      <div className="text-[14px] text-muted-foreground">{text}</div>
    </div>
  )
}
