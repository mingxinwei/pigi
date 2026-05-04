import { ChevronDown, GitBranch, MoreHorizontal, Play, SquareTerminal } from 'lucide-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import type { AgentStatus } from '../state/transcriptController'

interface StatusBarProps {
  status: AgentStatus
  model?: string
}

const STATUS_LABELS: Record<AgentStatus, string> = {
  idle: 'Ready',
  streaming: 'Generating',
  tool_running: 'Running',
  error: 'Error',
}

export default function StatusBar({ status, model }: StatusBarProps): React.JSX.Element {
  return (
    <header
      className="flex h-[52px] shrink-0 items-center justify-between bg-white"
      style={{ padding: '0 16px', WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-testid="status-bar"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-[13px] font-semibold text-[#202124]">pi</span>
        <span className="min-w-0 truncate text-[13px] text-[#767a7f]">{model || 'New chat'}</span>
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-6 rounded-md text-[#8b8f94] hover:bg-[#f3f3f1]"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <MoreHorizontal className="size-4" />
        </Button>
      </div>

      <div
        className="flex items-center gap-2 text-[12px] text-[#8b8f94]"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button
          variant="ghost"
          size="icon-xs"
          className="size-7 rounded-md text-[#8b8f94] hover:bg-[#f3f3f1]"
        >
          <Play className="size-4" />
        </Button>
        <Badge
          variant="outline"
          className="h-7 gap-1 rounded-lg border-[#e1e1de] bg-white px-2 text-[12px] font-normal text-[#606469]"
        >
          <SquareTerminal className="size-3.5" />
          5.5
          <ChevronDown className="size-3" />
        </Badge>
        <Badge
          variant="outline"
          className="h-7 gap-1 rounded-lg border-[#e1e1de] bg-white px-2 text-[12px] font-normal text-[#606469]"
        >
          <GitBranch className="size-3.5" />
          Commit
          <ChevronDown className="size-3" />
        </Badge>
        <span style={{ width: 56, textAlign: 'right' }}>{STATUS_LABELS[status]}</span>
      </div>
    </header>
  )
}
