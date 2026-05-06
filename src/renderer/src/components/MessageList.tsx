import { useRef, useEffect, useCallback, useMemo, useState } from 'react'
import { useVirtualizer } from '@tanstack/react-virtual'
import type { TranscriptNode, AssistantNode, ToolNode } from '../state/transcriptController'
import { MESSAGE_CONTENT_MAX_WIDTH, MESSAGE_LIST_MAX_WIDTH } from '../lib/layoutConstants'
import ToolBlock, { TOOL_OUTPUT_LINE_LIMIT } from './ToolBlock'
import MarkdownMessage from './markdownMessage'
import { cn } from '../lib/utils'

interface MessageListProps {
  nodes: TranscriptNode[]
}

const CHAT_INPUT_AREA_HEIGHT = 172
const MESSAGE_ROW_GAP = 16
const TOOL_BLOCK_ESTIMATE_BUFFER = 16
const TOOL_STATUS_LINE_ESTIMATE_HEIGHT = 24
const LONG_USER_MESSAGE_LINE_LIMIT = 100
const LONG_USER_MESSAGE_HEAD_LINES = 24
const LONG_USER_MESSAGE_TAIL_LINES = 12
const LONG_USER_MESSAGE_CHARACTER_LIMIT = 4_000
const LONG_USER_MESSAGE_HEAD_CHARACTERS = 2_400
const LONG_USER_MESSAGE_TAIL_CHARACTERS = 1_200
const USER_MESSAGE_WRAP_ESTIMATE_WIDTH = 72

interface UserMessagePreview {
  isLong: boolean
  text: string
}

export default function MessageList({ nodes }: MessageListProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null)
  const isAutoScrollRef = useRef(true)
  const displayNodes = useMemo(() => nodes.filter(isRenderableNode), [nodes])

  const getItemKey = useCallback(
    (index: number) => displayNodes[index]?.id ?? index,
    [displayNodes],
  )

  // TanStack Virtual returns imperative measurement helpers; this follows its documented React pattern.
  // eslint-disable-next-line react-hooks/incompatible-library
  const rowVirtualizer = useVirtualizer({
    count: displayNodes.length,
    getScrollElement: () => containerRef.current,
    getItemKey,
    estimateSize: (index) => estimateNodeHeight(displayNodes[index]),
    overscan: 8,
    gap: MESSAGE_ROW_GAP,
    useAnimationFrameWithResizeObserver: true,
    useFlushSync: false,
  })

  const scrollToBottom = useCallback(() => {
    if (isAutoScrollRef.current && displayNodes.length > 0) {
      rowVirtualizer.scrollToIndex(displayNodes.length - 1, { align: 'end' })
    }
  }, [displayNodes.length, rowVirtualizer])

  useEffect(() => {
    const measureAndScroll = (): void => {
      scrollToBottom()
    }
    const rafId = requestAnimationFrame(measureAndScroll)
    return () => {
      cancelAnimationFrame(rafId)
    }
  }, [displayNodes, rowVirtualizer, scrollToBottom])

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
        {displayNodes.length === 0 && <div style={{ minHeight: '60vh' }} />}

        <div
          className="relative"
          style={{ height: `${rowVirtualizer.getTotalSize()}px` }}
          data-testid="message-virtualizer"
        >
          {virtualItems.map((virtualItem) => {
            const node = displayNodes[virtualItem.index]
            return (
              <div
                key={node.id}
                ref={rowVirtualizer.measureElement}
                data-index={virtualItem.index}
                className="absolute left-0 top-0 w-full"
                style={{ transform: `translateY(${virtualItem.start}px)` }}
              >
                <NodeRenderer node={node} />
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
      return estimateUserHeight(node.text)
    case 'assistant':
      return estimateAssistantHeight(node)
    case 'tool':
      return estimateToolHeight(node)
    case 'system':
      return 56
  }
}

function estimateUserHeight(text: string): number {
  const preview = getUserMessagePreview(text)
  const visibleLineCount = countLines(preview.text)
  const characterLineCount = Math.ceil(preview.text.length / USER_MESSAGE_WRAP_ESTIMATE_WIDTH)
  const estimatedLineCount = Math.max(visibleLineCount, characterLineCount)
  const buttonHeight = preview.isLong ? 36 : 0
  return Math.max(56, estimatedLineCount * 24 + 32 + buttonHeight)
}

function estimateAssistantHeight(node: AssistantNode): number {
  const textLength = node.text.length + node.thinking.length
  const lineCount = countLines(node.text) + countLines(node.thinking)
  return Math.max(80, Math.max(Math.ceil(textLength / 84), lineCount) * 24 + 56)
}

function estimateToolHeight(node: ToolNode): number {
  const outputLineCount = node.output ? node.output.split('\n').length : 0
  const visibleOutputLineCount = Math.min(outputLineCount, TOOL_OUTPUT_LINE_LIMIT)
  const hiddenOutputLineCount = Math.max(0, outputLineCount - TOOL_OUTPUT_LINE_LIMIT)
  const hiddenHintLineCount = hiddenOutputLineCount > 0 ? 1 : 0
  const showAllButtonHeight = hiddenOutputLineCount > 0 ? 36 : 0
  const commandLineCount = estimateToolCommandLineCount(node)

  return Math.max(
    96,
    48 +
      commandLineCount * 24 +
      (visibleOutputLineCount + hiddenHintLineCount) * 20 +
      showAllButtonHeight +
      TOOL_STATUS_LINE_ESTIMATE_HEIGHT +
      TOOL_BLOCK_ESTIMATE_BUFFER,
  )
}

function countLines(text: string): number {
  if (!text) {
    return 0
  }
  return text.split('\n').length
}

function estimateToolCommandLineCount(node: ToolNode): number {
  const args = node.args as Record<string, unknown> | undefined
  const command =
    node.name === 'bash'
      ? String(args?.command ?? '')
      : node.name === 'read' || node.name === 'write'
        ? String(args?.path ?? '')
        : ''

  return Math.max(1, Math.ceil(command.length / 80))
}

function isRenderableNode(node: TranscriptNode): boolean {
  if (node.role !== 'assistant') {
    return true
  }

  return Boolean(node.text || node.thinking || node.errorMessage)
}

function NodeRenderer({ node }: { node: TranscriptNode }): React.JSX.Element {
  switch (node.role) {
    case 'user':
      return <UserBubble text={node.text} />
    case 'assistant':
      return <AssistantBubble node={node} />
    case 'tool':
      return <ToolBlock node={node} />
    case 'system':
      return <SystemBubble text={node.text} />
  }
}

function UserBubble({ text }: { text: string }): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const preview = useMemo(() => getUserMessagePreview(text), [text])
  const displayText = expanded || !preview.isLong ? text : preview.text

  return (
    <div className="flex justify-end" data-testid="user-message">
      <div
        className={cn(
          'min-w-16 rounded-2xl bg-muted px-3.5 py-1.5 text-[15px] leading-6 text-foreground',
          'max-w-[85%] whitespace-pre-wrap break-words [overflow-wrap:anywhere]',
          preview.isLong ? 'w-full' : 'w-fit',
        )}
      >
        {displayText}
        {preview.isLong && (
          <div className="mt-2">
            <button
              type="button"
              className="h-7 rounded px-2 text-sm font-medium text-muted-foreground hover:bg-muted-foreground/10 hover:text-foreground"
              onClick={() => {
                setExpanded((current) => !current)
              }}
            >
              {expanded ? 'Show less' : 'Show more'}
            </button>
          </div>
        )}
      </div>
    </div>
  )
}

function getUserMessagePreview(text: string): UserMessagePreview {
  const lines = text.split('\n')
  if (lines.length > LONG_USER_MESSAGE_LINE_LIMIT) {
    return { isLong: true, text: getCollapsedUserMessageByLines(lines) }
  }

  if (text.length > LONG_USER_MESSAGE_CHARACTER_LIMIT) {
    return { isLong: true, text: getCollapsedUserMessageByCharacters(text) }
  }

  return { isLong: false, text }
}

function getCollapsedUserMessageByLines(lines: string[]): string {
  const omittedLineCount =
    lines.length - LONG_USER_MESSAGE_HEAD_LINES - LONG_USER_MESSAGE_TAIL_LINES
  const head = lines.slice(0, LONG_USER_MESSAGE_HEAD_LINES)
  const tail = lines.slice(-LONG_USER_MESSAGE_TAIL_LINES)
  return [...head, `... (${omittedLineCount.toLocaleString()} lines hidden)`, ...tail].join('\n')
}

function getCollapsedUserMessageByCharacters(text: string): string {
  const hiddenCharacterCount =
    text.length - LONG_USER_MESSAGE_HEAD_CHARACTERS - LONG_USER_MESSAGE_TAIL_CHARACTERS
  return [
    text.slice(0, LONG_USER_MESSAGE_HEAD_CHARACTERS),
    `... (${hiddenCharacterCount.toLocaleString()} characters hidden)`,
    text.slice(-LONG_USER_MESSAGE_TAIL_CHARACTERS),
  ].join('\n')
}

function AssistantBubble({ node }: { node: AssistantNode }): React.JSX.Element {
  const showThinking = node.thinking.length > 0
  const showText = node.text.length > 0

  return (
    <div className="flex justify-start" data-testid="assistant-message">
      <div
        className="w-full min-w-0 text-[15px] leading-6 text-foreground"
        style={{ maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px` }}
      >
        {showThinking && <ThinkingBlock text={node.thinking} />}

        {showText && <MarkdownMessage text={node.text} />}

        {node.errorMessage && (
          <div className="mt-3 rounded-lg bg-destructive/10 px-3 py-2 text-[14px] text-destructive">
            {node.errorMessage}
          </div>
        )}
      </div>
    </div>
  )
}

function ThinkingBlock({ text }: { text: string }): React.JSX.Element {
  return (
    <div className="mb-4 rounded-md bg-muted/35 px-3 py-2 text-muted-foreground">
      <div className="mb-1.5 text-[14px] font-medium">Thinking</div>
      <pre className="whitespace-pre-wrap break-words font-sans text-[15px] leading-6 text-muted-foreground">
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
