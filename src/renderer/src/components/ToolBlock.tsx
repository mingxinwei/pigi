import { useState, useCallback } from 'react'
import {
  ChevronRight,
  Terminal,
  FileText,
  Pencil,
  FilePlus,
  Loader2,
  Check,
  X,
  Ban,
} from 'lucide-react'
import { Collapsible, CollapsibleContent, CollapsibleTrigger } from './ui/collapsible'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { ToolNode } from '../state/transcriptController'

interface ToolBlockProps {
  node: ToolNode
}

const TOOL_ICON_MAP: Record<string, React.ComponentType<{ className?: string }>> = {
  bash: Terminal,
  read: FileText,
  edit: Pencil,
  write: FilePlus,
}

const STATUS_CONFIG = {
  running: { label: 'Running', Icon: Loader2, className: 'text-orange' },
  success: { label: 'Done', Icon: Check, className: 'text-green' },
  error: { label: 'Error', Icon: X, className: 'text-red' },
  cancelled: { label: 'Cancelled', Icon: Ban, className: 'text-text-muted' },
}

function getToolPreview(node: ToolNode): string {
  const args = node.args as Record<string, unknown> | undefined
  if (!args) {
    return ''
  }

  switch (node.name) {
    case 'bash': {
      return String(args.command ?? '').slice(0, 120)
    }
    case 'read':
    case 'edit':
    case 'write': {
      return String(args.path ?? '')
    }
    default:
      return JSON.stringify(args).slice(0, 100)
  }
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element {
  const [open, setOpen] = useState(false)
  const { label, Icon: StatusIcon, className } = STATUS_CONFIG[node.status]
  const ToolIcon = TOOL_ICON_MAP[node.name] ?? Terminal
  const preview = getToolPreview(node)
  const hasOutput = node.output.length > 0
  const truncatedOutput = node.output.length > 2000 ? node.output.slice(0, 2000) : node.output
  const isTruncated = node.output.length > 2000

  const handleCopy = useCallback(() => {
    navigator.clipboard.writeText(node.output)
  }, [node.output])

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <div className="max-w-[720px] overflow-hidden rounded-xl border border-border-primary bg-bg-elevated shadow-sm">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start rounded-none px-3 py-2 hover:bg-bg-hover"
            data-testid={`tool-block-${node.toolCallId}`}
          >
            <ChevronRight
              className={cn(
                'h-4 w-4 shrink-0 text-text-muted transition-transform',
                open && 'rotate-90',
              )}
            />
            <ToolIcon className="h-4 w-4 shrink-0 text-text-muted" />
            <span className="text-[13px] font-medium text-text-primary">{node.name}</span>
            {preview && (
              <span className="min-w-0 flex-1 truncate text-[13px] font-normal text-text-muted">
                {preview}
              </span>
            )}
            <span
              className={cn(
                'ml-auto flex shrink-0 items-center gap-1 text-[13px] font-normal',
                className,
              )}
            >
              <StatusIcon
                className={cn('h-3.5 w-3.5', node.status === 'running' && 'animate-spin')}
              />
              {label}
            </span>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {hasOutput && (
            <div className="border-t border-border-secondary bg-bg-primary">
              <div className="flex items-center justify-between px-3 py-2">
                <span className="text-[12px] text-text-muted">Output</span>
                <Button
                  variant="ghost"
                  size="xs"
                  onClick={handleCopy}
                  className="h-6 px-2 text-[12px]"
                >
                  Copy
                </Button>
              </div>
              <pre className="max-h-64 overflow-y-auto whitespace-pre-wrap break-words px-3 pb-3 font-mono text-[12px] leading-5 text-text-secondary">
                {truncatedOutput}
                {isTruncated && `\n... (${node.output.length.toLocaleString()} chars total)`}
              </pre>
            </div>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
