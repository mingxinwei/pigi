import { useRef, useEffect, useCallback } from 'react'
import type {
  TranscriptNode,
  AssistantNode,
  ToolNode,
  TranscriptController,
} from '../state/transcriptController'

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
  const streamingRef = useRef<HTMLPreElement>(null)
  const isAutoScrollRef = useRef(true)

  const scrollToBottom = useCallback(() => {
    const el = containerRef.current
    if (el && isAutoScrollRef.current) {
      el.scrollTop = el.scrollHeight
    }
  }, [])

  // Auto-scroll on structural changes
  useEffect(() => {
    scrollToBottom()
  }, [nodes, scrollToBottom])

  // RAF loop for streaming DOM updates
  useEffect(() => {
    if (!activeAssistantId) return

    let rafId: number
    const update = (): void => {
      const pre = streamingRef.current
      if (pre) {
        const state = controller.current.state
        const assistant = state.nodes.find((n) => n.id === activeAssistantId) as
          | AssistantNode
          | undefined
        if (assistant) {
          pre.textContent = assistant.text
        }
      }
      scrollToBottom()
      rafId = requestAnimationFrame(update)
    }
    rafId = requestAnimationFrame(update)
    return () => cancelAnimationFrame(rafId)
  }, [activeAssistantId, controller, scrollToBottom])

  const handleScroll = useCallback(() => {
    const el = containerRef.current
    if (!el) return
    const atBottom = el.scrollHeight - el.scrollTop - el.clientHeight < 40
    isAutoScrollRef.current = atBottom
  }, [])

  return (
    <div ref={containerRef} onScroll={handleScroll} className="flex-1 overflow-y-auto">
      <div className="max-w-3xl mx-auto px-4 py-6 space-y-4">
        {nodes.length === 0 && (
          <div className="text-center text-text-muted py-20">
            <div className="text-sm">Start a conversation with pi</div>
          </div>
        )}

        {nodes.map((node) => (
          <NodeRenderer
            key={node.id}
            node={node}
            isStreaming={node.id === activeAssistantId}
            streamingRef={node.id === activeAssistantId ? streamingRef : undefined}
          />
        ))}
      </div>
    </div>
  )
}

// =============================================================================
// Node renderers
// =============================================================================

function NodeRenderer({
  node,
  isStreaming,
  streamingRef,
}: {
  node: TranscriptNode
  isStreaming: boolean
  streamingRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return <UserBubble text={node.text} />
    case 'assistant':
      return <AssistantBubble node={node} isStreaming={isStreaming} streamingRef={streamingRef} />
    case 'tool':
      return <ToolBubble node={node} />
    case 'system':
      return <SystemBubble text={node.text} />
  }
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-end">
      <div className="max-w-[80%] bg-accent/10 border border-accent/20 rounded-lg px-4 py-2.5">
        <pre className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary">
          {text}
        </pre>
      </div>
    </div>
  )
}

function AssistantBubble({
  node,
  isStreaming,
  streamingRef,
}: {
  node: AssistantNode
  isStreaming: boolean
  streamingRef?: React.RefObject<HTMLPreElement | null>
}): React.JSX.Element {
  return (
    <div className="flex justify-start">
      <div className="max-w-[90%]">
        {node.thinking && !isStreaming && (
          <details className="mb-2">
            <summary className="text-xs text-text-muted cursor-pointer hover:text-text-secondary">
              Thinking...
            </summary>
            <pre className="text-xs text-text-muted whitespace-pre-wrap break-words font-mono mt-1 pl-3 border-l border-border-secondary">
              {node.thinking}
            </pre>
          </details>
        )}
        {isStreaming ? (
          <pre
            ref={streamingRef}
            className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary leading-relaxed"
          />
        ) : (
          <pre className="text-sm whitespace-pre-wrap break-words font-sans text-text-primary leading-relaxed">
            {node.text}
          </pre>
        )}
        {node.errorMessage && (
          <div className="text-xs text-red mt-1">Error: {node.errorMessage}</div>
        )}
      </div>
    </div>
  )
}

function ToolBubble({ node }: { node: ToolNode }): React.JSX.Element {
  const statusIcon = node.status === 'running' ? '⏳' : node.status === 'error' ? '❌' : '✓'

  return (
    <div className="flex justify-start">
      <div className="max-w-[90%] bg-bg-tertiary border border-border-secondary rounded-lg px-3 py-2">
        <div className="flex items-center gap-2 text-xs text-text-muted mb-1">
          <span>{statusIcon}</span>
          <span className="font-mono">{node.name}</span>
        </div>
        {node.output && (
          <pre className="text-xs text-text-secondary whitespace-pre-wrap break-words font-mono max-h-40 overflow-y-auto">
            {node.output}
          </pre>
        )}
      </div>
    </div>
  )
}

function SystemBubble({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="flex justify-center">
      <div className="text-xs text-text-muted italic">{text}</div>
    </div>
  )
}
