/** Sidebar - will be built out in Phase 2 */
interface SidebarProps {
  isStreaming: boolean
  onNewSession: () => void
}

export default function Sidebar({ isStreaming, onNewSession }: SidebarProps): React.JSX.Element {
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

      {/* Sessions placeholder */}
      <div className="flex-1 overflow-y-auto px-2 py-2">
        <div className="text-xs text-text-muted px-2 py-8 text-center">
          Sessions will appear here
        </div>
      </div>
    </div>
  )
}
