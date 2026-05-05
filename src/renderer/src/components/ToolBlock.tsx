import { useState } from 'react'
import {
  IconBan,
  IconFilePlus,
  IconFileText,
  IconLoader2,
  IconPencil,
  IconTerminal2,
  IconX,
} from '@tabler/icons-react'
import { Badge } from './ui/badge'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { ToolNode } from '../state/transcriptController'

interface ToolBlockProps {
  node: ToolNode
}

const TOOL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  bash: IconTerminal2,
  read: IconFileText,
  edit: IconPencil,
  write: IconFilePlus,
}

const STATUS_CONFIG = {
  running: { label: 'Running', Icon: IconLoader2, variant: 'secondary', show: true },
  success: { label: 'Done', Icon: null, variant: 'outline', show: false },
  error: { label: 'Error', Icon: IconX, variant: 'destructive', show: true },
  cancelled: { label: 'Cancelled', Icon: IconBan, variant: 'secondary', show: true },
} as const

const OUTPUT_LINE_LIMIT = 10

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') {
    return ''
  }

  const record = args as Record<string, unknown>
  if (Object.keys(record).length === 0) {
    return ''
  }

  return JSON.stringify(record, null, 2)
}

function getToolCommand(node: ToolNode): string {
  const args = node.args as Record<string, unknown> | undefined
  if (!args) {
    return ''
  }

  switch (node.name) {
    case 'bash': {
      return `$ ${String(args.command ?? '')}`
    }
    case 'read':
    case 'write': {
      return String(args.path ?? '')
    }
    case 'edit': {
      const path = String(args.path ?? '')
      return path ? `${node.name} ${path}` : formatToolArgs(args)
    }
    default:
      return formatToolArgs(args)
  }
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false)
  const { label, Icon: StatusIcon, variant, show: showStatus } = STATUS_CONFIG[node.status]
  const ToolIcon = TOOL_ICON_MAP[node.name] ?? IconTerminal2
  const command = getToolCommand(node)
  const hasOutput = node.output.length > 0
  const outputLines = node.output.split('\n')
  const visibleOutput = expanded ? node.output : outputLines.slice(0, OUTPUT_LINE_LIMIT).join('\n')
  const hiddenLineCount = Math.max(0, outputLines.length - OUTPUT_LINE_LIMIT)

  return (
    <div
      className="max-w-[680px] overflow-hidden rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-sm text-muted-foreground"
      data-testid={`tool-block-${node.toolCallId}`}
    >
      <div className="flex items-center gap-2">
        <ToolIcon className="size-4 text-muted-foreground" />
        <span className="font-medium text-foreground">{node.name}</span>
        {showStatus && StatusIcon && (
          <Badge variant={variant} className="ml-auto gap-1 font-normal">
            <StatusIcon className={cn('size-3.5', node.status === 'running' && 'animate-spin')} />
            {label}
          </Badge>
        )}
      </div>

      {command && (
        <pre className="mt-2 whitespace-pre-wrap break-words rounded bg-background/75 px-2 py-1.5 font-mono text-[13px] leading-5 text-foreground/80">
          {command}
        </pre>
      )}

      {hasOutput && (
        <>
          <pre className="mt-2 whitespace-pre-wrap break-words font-mono text-[13px] leading-5 text-muted-foreground">
            {visibleOutput}
            {!expanded &&
              hiddenLineCount > 0 &&
              `\n... (${hiddenLineCount.toLocaleString()} more lines)`}
          </pre>
          {hiddenLineCount > 0 && (
            <Button
              variant="ghost"
              size="sm"
              className="mt-1 h-7 px-2 text-xs text-muted-foreground hover:bg-muted/70"
              onClick={() => {
                setExpanded((current) => !current)
              }}
            >
              {expanded ? 'Show less' : 'Show all'}
            </Button>
          )}
        </>
      )}
    </div>
  )
}
