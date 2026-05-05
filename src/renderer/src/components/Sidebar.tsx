import { useState } from 'react'
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconMessageCircle,
  IconPlus,
  IconSearch,
  IconSettings,
} from '@tabler/icons-react'
import type { PiSessionInfo, ProjectDirectory } from '../../../shared/ipcContract'
import type { SessionEntry } from '../state/appStore'
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './ui/sidebar'
import {
  Command,
  CommandDialog,
  CommandEmpty,
  CommandGroup,
  CommandInput,
  CommandItem,
  CommandList,
} from './ui/command'

interface SidebarProps {
  sessions: Map<string, SessionEntry>
  selectedSessionId: string | null
  isStreaming: boolean
  recentProjects: ProjectDirectory[]
  projectSessions: Record<string, PiSessionInfo[]>
  onNewSession: () => void
  onSwitchSession: (sessionId: string) => void
  onResumeSession: (session: PiSessionInfo) => void
  onOpenProject: () => void
  onSelectProject: (path: string) => void
}

export default function Sidebar({
  sessions,
  selectedSessionId,
  isStreaming,
  recentProjects,
  projectSessions,
  onNewSession,
  onSwitchSession,
  onResumeSession,
  onOpenProject,
  onSelectProject,
}: SidebarProps): React.JSX.Element {
  const [searchOpen, setSearchOpen] = useState(false)
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set())
  const [expandedSessionLists, setExpandedSessionLists] = useState<Set<string>>(new Set())
  const visibleSessionCount = 5

  function getSessionTitle(session: PiSessionInfo): string {
    return (session.name ?? session.firstMessage).replace(/\s+/g, ' ').trim()
  }

  function getProjectSessions(projectPath: string): PiSessionInfo[] {
    const listedSessions = projectSessions[projectPath] ?? []
    const listedIds = new Set(listedSessions.map((session) => session.id))
    const runningSessions = Array.from(sessions.values())
      .filter((session) => session.cwd === projectPath && !listedIds.has(session.sessionId))
      .map<PiSessionInfo>((session) => ({
        path: '',
        id: session.sessionId,
        cwd: session.cwd,
        created: '',
        modified: '',
        messageCount: 0,
        firstMessage: session.title,
        allMessagesText: session.title,
      }))

    return [...runningSessions, ...listedSessions]
  }

  const allProjectSessions = recentProjects.flatMap((project) => getProjectSessions(project.path))

  function toggleProjectSessions(projectPath: string): void {
    setExpandedProjects((current) => {
      const next = new Set(current)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      return next
    })
  }

  function toggleSessionList(projectPath: string): void {
    setExpandedSessionLists((current) => {
      const next = new Set(current)
      if (next.has(projectPath)) {
        next.delete(projectPath)
      } else {
        next.add(projectPath)
      }
      return next
    })
  }

  return (
    <>
      <CommandDialog
        open={searchOpen}
        onOpenChange={setSearchOpen}
        title="Search projects and chats"
        description="Search recent projects and open chats."
      >
        <Command>
          <CommandInput placeholder="Search projects and chats..." />
          <CommandList>
            <CommandEmpty>No results found.</CommandEmpty>
            <CommandGroup heading="Projects">
              {recentProjects.map((project) => (
                <CommandItem
                  key={project.path}
                  value={`project ${project.name} ${project.path}`}
                  onSelect={() => {
                    onSelectProject(project.path)
                    setSearchOpen(false)
                  }}
                >
                  <IconFolder />
                  <span>{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Chats">
              {allProjectSessions.map((session) => (
                <CommandItem
                  key={session.path || session.id}
                  value={`chat ${getSessionTitle(session)}`}
                  onSelect={() => {
                    if (session.path) {
                      onResumeSession(session)
                    } else {
                      onSwitchSession(session.id)
                    }
                    setSearchOpen(false)
                  }}
                >
                  <IconMessageCircle />
                  <span>{getSessionTitle(session)}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <ShadcnSidebar
        collapsible="none"
        className="border-r [&_.tabler-icon]:stroke-[1.25]"
        data-testid="sidebar"
      >
        <SidebarHeader style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="h-10" />
          <SidebarMenu style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewSession} disabled={isStreaming}>
                <IconPlus data-icon="inline-start" />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  setSearchOpen(true)
                }}
              >
                <IconSearch data-icon="inline-start" />
                <span>Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenProject}>
                <IconFolderPlus data-icon="inline-start" />
                <span>Open project</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent className="overflow-hidden">
          <SidebarGroup className="min-h-0 flex-1">
            <SidebarGroupLabel className="text-sm text-muted-foreground">
              Projects
            </SidebarGroupLabel>
            <SidebarGroupAction onClick={onOpenProject} title="Open project">
              <IconFolderPlus />
              <span className="sr-only">Open project</span>
            </SidebarGroupAction>
            <SidebarGroupContent className="min-h-0 flex-1 overflow-auto no-scrollbar">
              <SidebarMenu>
                {recentProjects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={onOpenProject} className="text-muted-foreground">
                      <IconFolderPlus data-icon="inline-start" />
                      <span>Open a project</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  recentProjects.map((project) => {
                    const sessionsForProject = getProjectSessions(project.path)
                    const isExpanded = expandedProjects.has(project.path)
                    const isSessionListExpanded = expandedSessionLists.has(project.path)
                    const visibleSessions = isSessionListExpanded
                      ? sessionsForProject
                      : sessionsForProject.slice(0, visibleSessionCount)
                    const hiddenSessionCount = sessionsForProject.length - visibleSessions.length

                    return (
                      <SidebarMenuItem
                        key={project.path}
                        className={isExpanded ? 'mb-3' : undefined}
                      >
                        <SidebarMenuButton
                          onClick={() => {
                            onSelectProject(project.path)
                            toggleProjectSessions(project.path)
                          }}
                          title={project.path}
                          className="font-medium text-sidebar-foreground/65"
                        >
                          {isExpanded ? (
                            <IconFolderOpen data-icon="inline-start" />
                          ) : (
                            <IconFolder data-icon="inline-start" />
                          )}
                          <span>{project.name}</span>
                        </SidebarMenuButton>

                        <div
                          aria-hidden={!isExpanded}
                          className={
                            isExpanded
                              ? 'grid grid-rows-[1fr] translate-y-0 opacity-100 transition-[grid-template-rows,opacity,transform] duration-250 ease-[cubic-bezier(0.2,0.8,0.2,1)]'
                              : 'grid grid-rows-[0fr] -translate-y-1 opacity-0 transition-[grid-template-rows,opacity,transform] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]'
                          }
                        >
                          <div className="min-h-0 overflow-hidden">
                            <SidebarMenuSub className="mx-0 border-l-0 px-0">
                              {sessionsForProject.length === 0 ? (
                                <SidebarMenuSubItem>
                                  <SidebarMenuSubButton
                                    asChild
                                    className="w-full justify-start pl-6 text-left text-muted-foreground"
                                  >
                                    <span aria-disabled>No chats yet</span>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              ) : (
                                visibleSessions.map((session) => {
                                  const isActive = session.id === selectedSessionId

                                  return (
                                    <SidebarMenuSubItem key={session.path || session.id}>
                                      <SidebarMenuSubButton
                                        asChild
                                        isActive={isActive}
                                        className="w-full justify-start pl-6 text-left text-sidebar-foreground/65 data-active:bg-primary/10 data-active:text-foreground"
                                      >
                                        <button
                                          type="button"
                                          onClick={() => {
                                            if (session.path) {
                                              onResumeSession(session)
                                            } else {
                                              onSwitchSession(session.id)
                                            }
                                          }}
                                        >
                                          <span
                                            className="min-w-0 flex-1 truncate"
                                            title={getSessionTitle(session)}
                                          >
                                            {getSessionTitle(session)}
                                          </span>
                                        </button>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  )
                                })
                              )}
                              {hiddenSessionCount > 0 && (
                                <SidebarMenuSubItem>
                                  <SidebarMenuSubButton
                                    asChild
                                    className="w-full justify-start pl-6 text-left text-muted-foreground"
                                  >
                                    <button
                                      type="button"
                                      onClick={() => {
                                        toggleSessionList(project.path)
                                      }}
                                    >
                                      <span>Show more</span>
                                    </button>
                                  </SidebarMenuSubButton>
                                </SidebarMenuSubItem>
                              )}
                              {isSessionListExpanded &&
                                sessionsForProject.length > visibleSessionCount && (
                                  <SidebarMenuSubItem>
                                    <SidebarMenuSubButton
                                      asChild
                                      className="w-full justify-start pl-6 text-left text-muted-foreground"
                                    >
                                      <button
                                        type="button"
                                        onClick={() => {
                                          toggleSessionList(project.path)
                                        }}
                                      >
                                        <span>Show less</span>
                                      </button>
                                    </SidebarMenuSubButton>
                                  </SidebarMenuSubItem>
                                )}
                            </SidebarMenuSub>
                          </div>
                        </div>
                      </SidebarMenuItem>
                    )
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter>
          <SidebarMenu>
            <SidebarMenuItem>
              <SidebarMenuButton>
                <IconSettings data-icon="inline-start" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </ShadcnSidebar>
    </>
  )
}
