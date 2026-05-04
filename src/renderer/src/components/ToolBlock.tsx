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
import { Badge } from './ui/badge'
import { ScrollArea } from './ui/scroll-area'
import { Separator } from './ui/separator'
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
  running: { label: 'Running', Icon: Loader2, variant: 'secondary' },
  success: { label: 'Done', Icon: Check, variant: 'outline' },
  error: { label: 'Error', Icon: X, variant: 'destructive' },
  cancelled: { label: 'Cancelled', Icon: Ban, variant: 'secondary' },
} as const

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
  const { label, Icon: StatusIcon, variant } = STATUS_CONFIG[node.status]
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
      <div className="max-w-[720px] overflow-hidden rounded-xl border bg-card text-card-foreground shadow-sm">
        <CollapsibleTrigger asChild>
          <Button
            variant="ghost"
            className="h-auto w-full justify-start rounded-none px-3 py-2 hover:bg-muted"
            data-testid={`tool-block-${node.toolCallId}`}
          >
            <ChevronRight
              className={cn('text-muted-foreground transition-transform', open && 'rotate-90')}
            />
            <ToolIcon className="text-muted-foreground" />
            <span className="text-sm font-medium">{node.name}</span>
            {preview && (
              <span className="min-w-0 flex-1 truncate text-sm font-normal text-muted-foreground">
                {preview}
              </span>
            )}
            <Badge variant={variant} className="ml-auto gap-1 font-normal">
              <StatusIcon className={cn(node.status === 'running' && 'animate-spin')} />
              {label}
            </Badge>
          </Button>
        </CollapsibleTrigger>
        <CollapsibleContent>
          {hasOutput && (
            <>
              <Separator />
              <div className="bg-background">
                <div className="flex items-center justify-between px-3 py-2">
                  <span className="text-xs text-muted-foreground">Output</span>
                  <Button variant="ghost" size="xs" onClick={handleCopy}>
                    Copy
                  </Button>
                </div>
                <ScrollArea className="max-h-64 px-3 pb-3">
                  <pre className="whitespace-pre-wrap break-words font-mono text-xs leading-5 text-muted-foreground">
                    {truncatedOutput}
                    {isTruncated && `\n... (${node.output.length.toLocaleString()} chars total)`}
                  </pre>
                </ScrollArea>
              </div>
            </>
          )}
        </CollapsibleContent>
      </div>
    </Collapsible>
  )
}
