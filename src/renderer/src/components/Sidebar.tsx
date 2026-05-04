import { Plus, MessageCircle, AlertCircle, Loader2, Search, Settings, Folder } from 'lucide-react'
import { Button } from './ui/button'
import { cn } from '../lib/utils'
import type { ProjectDirectory } from '../../../shared/ipcContract'
import type { SessionEntry } from '../state/appStore'

interface SidebarProps {
  sessions: Map<string, SessionEntry>
  activeSessionId: string | null
  isStreaming: boolean
  recentProjects: ProjectDirectory[]
  activeProject: ProjectDirectory | null
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
  onOpenProject: () => void
  onSelectProject: (path: string) => void
}

export default function Sidebar({
  sessions,
  activeSessionId,
  isStreaming,
  recentProjects,
  activeProject,
  onNewSession,
  onSwitchSession,
  onOpenProject,
  onSelectProject,
}: SidebarProps): React.JSX.Element {
  const activeProjectPath = activeProject?.path ?? null
  const sessionList = Array.from(sessions.values()).filter((session) => {
    if (!activeProjectPath) {
      return true
    }
    return session.cwd === activeProjectPath
  })

  return (
    <aside
      className="flex h-full flex-col border-r border-[#e4e4e1] bg-[#f3f3f1]"
      style={{ width: 244, minWidth: 244 }}
      data-testid="sidebar"
    >
      <div style={{ height: 50, WebkitAppRegion: 'drag' } as React.CSSProperties} />

      <div style={{ padding: '0 12px 20px' }} className="space-y-px">
        <SidebarButton icon={Plus} label="New chat" onClick={onNewSession} disabled={isStreaming} />
        <SidebarButton icon={Search} label="Search" />
        <SidebarButton icon={Folder} label="Open project" onClick={onOpenProject} />
      </div>

      <div className="flex items-center justify-between" style={{ padding: '0 16px 7px' }}>
        <span className="text-[12px] font-normal text-[#8b8f94]">Projects</span>
        <Folder className="size-[13px] text-[#8b8f94]" />
      </div>

      <div className="flex-1 overflow-y-auto" style={{ padding: '0 8px 12px' }}>
        <ul className="mb-2 space-y-px">
          {recentProjects.map((project) => {
            const isActiveProject = project.path === activeProjectPath
            return (
              <li key={project.path}>
                <Button
                  variant="ghost"
                  size="sm"
                  onClick={() => {
                    onSelectProject(project.path)
                  }}
                  className={cn(
                    'h-[26px] w-full justify-start gap-2 rounded-md text-[13px] font-normal text-[#5f6368] hover:bg-[#e8e8e5] hover:text-[#202124]',
                    isActiveProject && 'bg-[#e8e8e5] text-[#202124]',
                  )}
                  style={{ paddingLeft: 8, paddingRight: 8 }}
                  title={project.path}
                >
                  <Folder className="size-[13px] shrink-0 text-[#8b8f94]" />
                  <span className="truncate">{project.name}</span>
                </Button>
              </li>
            )
          })}
        </ul>
        {recentProjects.length === 0 && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onOpenProject}
            className="mb-2 h-[26px] w-full justify-start gap-2 rounded-md text-[13px] font-normal text-[#8b8f94] hover:bg-[#e8e8e5]"
            style={{ paddingLeft: 8, paddingRight: 8 }}
          >
            <Folder className="size-[13px] text-[#8b8f94]" />
            Open a project
          </Button>
        )}
        {sessionList.length === 0 ? (
          <div className="text-[13px] text-[#8b8f94]" style={{ padding: '3px 8px 3px 28px' }}>
            No chats yet
          </div>
        ) : (
          <ul className="space-y-px">
            {sessionList.map((session) => {
              const isActive = session.sessionId === activeSessionId
              const isBusy = session.status === 'streaming' || session.status === 'tool_running'
              const isError = session.status === 'error'

              return (
                <li key={session.sessionId}>
                  <Button
                    variant="ghost"
                    size="sm"
                    onClick={() => {
                      onSwitchSession(session.sessionId)
                    }}
                    className={cn(
                      'h-[26px] w-full justify-start gap-2 rounded-md text-[13px] font-normal text-[#51565b] hover:bg-[#e8e8e5] hover:text-[#202124]',
                      isActive && 'bg-[#e1e1de] text-[#202124] hover:bg-[#e1e1de]',
                    )}
                    style={{ paddingLeft: 28, paddingRight: 8 }}
                  >
                    {isBusy && (
                      <Loader2 className="size-[13px] shrink-0 animate-spin text-[#8b8f94]" />
                    )}
                    {isError && <AlertCircle className="size-[13px] shrink-0 text-red" />}
                    {!isBusy && !isError && (
                      <MessageCircle className="size-[13px] shrink-0 text-[#8b8f94]" />
                    )}
                    <span className="truncate">{session.title}</span>
                  </Button>
                </li>
              )
            })}
          </ul>
        )}
      </div>

      <div style={{ padding: '0 8px 12px' }}>
        <SidebarButton icon={Settings} label="Settings" />
      </div>
    </aside>
  )
}

function SidebarButton({
  icon: Icon,
  label,
  onClick,
  disabled,
}: {
  icon: React.ComponentType<{ className?: string }>
  label: string
  onClick?: () => void
  disabled?: boolean
}): React.JSX.Element {
  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={onClick}
      disabled={disabled}
      className="h-[26px] w-full justify-start gap-2 rounded-md text-[13px] font-normal text-[#26282b] hover:bg-[#e8e8e5]"
      style={{ paddingLeft: 8, paddingRight: 8, WebkitAppRegion: 'no-drag' } as React.CSSProperties}
    >
      <Icon className="size-[14px] text-[#5d6267]" />
      {label}
    </Button>
  )
}
