import type { SessionEntry } from '../state/appStore'

interface SidebarProps {
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null
  isStreaming: boolean
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  isStreaming,
  onNewSession,
  onSwitchSession,
}: SidebarProps): React.JSX.Element {
  const sessionList = Array.from(sessions.values())

  return (
    <div className="flex flex-col w-60 min-w-60 bg-bg-secondary border-r border-border-primary h-full" data-testid="sidebar">
      {/* Header */}
      <div className="flex items-center justify-between px-4 py-3 border-b border-border-secondary">
        <span className="text-sm font-semibold text-text-primary tracking-wide">pigi</span>
        <button
          onClick={onNewSession}
          disabled={isStreaming}
          className="text-xs px-2 py-1 rounded bg-bg-tertiary text-text-secondary hover:text-text-primary hover:bg-border-primary transition-colors disabled:opacity-40"
          title="New session"
        >
          + New
        </button>
      </div>

      {/* Sessions list */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        {sessionList.length === 0 ? (
          <div className="text-xs text-text-muted px-2 py-8 text-center">
            No active sessions
          </div>
        ) : (
          <ul className="space-y-1">
            {sessionList.map((session) => {
              const isActive = session.sessionId === activeSessionId
              const statusIndicator =
                session.status === 'streaming' || session.status === 'tool_running'
                  ? '...'
                  : session.status === 'error'
                    ? '!'
                    : ''

              return (
                <li key={session.sessionId}>
                  <button
                    onClick={() => onSwitchSession(session.sessionId)}
                    className={`w-full text-left px-3 py-2 rounded text-xs transition-colors truncate ${
                      isActive
                        ? 'bg-bg-tertiary text-text-primary'
                        : 'text-text-secondary hover:bg-bg-tertiary hover:text-text-primary'
                    }`}
                  >
                    <span className="truncate">
                      {session.model?.name ?? 'loading...'}
                    </span>
                    {statusIndicator && (
                      <span className="ml-1 text-text-muted">{statusIndicator}</span>
                    )}
                  </button>
                </li>
              )
            })}
          </ul>
        )}
      </div>
    </div>
  )
}
