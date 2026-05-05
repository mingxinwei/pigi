import {
  IconChevronDown,
  IconDots,
  IconGitBranch,
  IconPlayerPlay,
  IconTerminal2,
} from '@tabler/icons-react'
import { Button } from './ui/button'
import { Badge } from './ui/badge'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
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
      className="flex h-13 shrink-0 items-center justify-between bg-background px-4"
      style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}
      data-testid="status-bar"
    >
      <div className="flex min-w-0 items-center gap-2">
        <span className="text-sm font-semibold">pi</span>
        <span className="min-w-0 truncate text-sm text-muted-foreground">
          {model || 'New chat'}
        </span>
        <Button
          variant="ghost"
          size="icon-xs"
          style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
        >
          <IconDots />
        </Button>
      </div>

      <div
        className="flex items-center gap-2 text-sm text-muted-foreground"
        style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}
      >
        <Button variant="ghost" size="icon-sm">
          <IconPlayerPlay />
        </Button>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <IconTerminal2 data-icon="inline-start" />
              5.5
              <IconChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Claude 5.5</DropdownMenuItem>
            <DropdownMenuItem>Change model</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button variant="outline" size="sm">
              <IconGitBranch data-icon="inline-start" />
              Commit
              <IconChevronDown data-icon="inline-end" />
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end">
            <DropdownMenuItem>Commit changes</DropdownMenuItem>
            <DropdownMenuItem>View diff</DropdownMenuItem>
          </DropdownMenuContent>
        </DropdownMenu>

        <Badge variant="ghost" className="w-14 justify-end font-normal text-muted-foreground">
          {STATUS_LABELS[status]}
        </Badge>
      </div>
    </header>
  )
}
