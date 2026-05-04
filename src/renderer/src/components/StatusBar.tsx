import type { AgentStatus } from '../state/transcriptController'

interface StatusBarProps {
  status: AgentStatus
  model?: string
}

export default function StatusBar({ status, model }: StatusBarProps): React.JSX.Element {
  const statusConfig: Record<AgentStatus, { label: string; color: string }> = {
    idle: { label: 'Ready', color: 'bg-green' },
    streaming: { label: 'Thinking...', color: 'bg-orange' },
    tool_running: { label: 'Running tool...', color: 'bg-accent' },
    error: { label: 'Error', color: 'bg-red' },
  }

  const { label, color } = statusConfig[status]

  return (
    <div
      className="flex items-center gap-3 px-4 py-1.5 border-b border-border-primary bg-bg-secondary text-xs"
      data-testid="status-bar"
    >
      <div className="flex items-center gap-1.5">
        <div
          className={`w-1.5 h-1.5 rounded-full ${color} ${status !== 'idle' ? 'animate-pulse' : ''}`}
        />
        <span className="text-text-secondary">{label}</span>
      </div>
      {model && <span className="text-text-muted font-mono">{model}</span>}
    </div>
  )
}
