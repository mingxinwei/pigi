import { useState } from 'react'
import { AlertCircle, Folder, Loader2, MessageCircle, Plus, Search, Settings } from 'lucide-react'
import type { ProjectDirectory } from '../../../shared/ipcContract'
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
  const [searchOpen, setSearchOpen] = useState(false)
  const activeProjectPath = activeProject?.path ?? null
  const sessionList = Array.from(sessions.values()).filter((session) => {
    if (!activeProjectPath) {
      return true
    }
    return session.cwd === activeProjectPath
  })

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
                  <Folder />
                  <span>{project.name}</span>
                </CommandItem>
              ))}
            </CommandGroup>
            <CommandGroup heading="Chats">
              {sessionList.map((session) => (
                <CommandItem
                  key={session.sessionId}
                  value={`chat ${session.title}`}
                  onSelect={() => {
                    onSwitchSession(session.sessionId)
                    setSearchOpen(false)
                  }}
                >
                  <MessageCircle />
                  <span>{session.title}</span>
                </CommandItem>
              ))}
            </CommandGroup>
          </CommandList>
        </Command>
      </CommandDialog>

      <ShadcnSidebar collapsible="none" className="border-r" data-testid="sidebar">
        <SidebarHeader style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="h-10" />
          <SidebarMenu style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewSession} disabled={isStreaming}>
                <Plus data-icon="inline-start" />
                <span>New chat</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton
                onClick={() => {
                  setSearchOpen(true)
                }}
              >
                <Search data-icon="inline-start" />
                <span>Search</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenProject}>
                <Folder data-icon="inline-start" />
                <span>Open project</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup>
            <SidebarGroupLabel>Projects</SidebarGroupLabel>
            <SidebarGroupAction onClick={onOpenProject} title="Open project">
              <Folder />
              <span className="sr-only">Open project</span>
            </SidebarGroupAction>
            <SidebarGroupContent>
              <SidebarMenu>
                {recentProjects.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton onClick={onOpenProject} className="text-muted-foreground">
                      <Folder data-icon="inline-start" />
                      <span>Open a project</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  recentProjects.map((project) => (
                    <SidebarMenuItem key={project.path}>
                      <SidebarMenuButton
                        onClick={() => {
                          onSelectProject(project.path)
                        }}
                        isActive={project.path === activeProjectPath}
                        title={project.path}
                      >
                        <Folder data-icon="inline-start" />
                        <span>{project.name}</span>
                      </SidebarMenuButton>
                    </SidebarMenuItem>
                  ))
                )}
              </SidebarMenu>

              <SidebarMenu className="mt-1">
                {sessionList.length === 0 ? (
                  <SidebarMenuItem>
                    <SidebarMenuButton className="pl-7 text-muted-foreground" disabled>
                      <span>No chats yet</span>
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ) : (
                  sessionList.map((session) => {
                    const isActive = session.sessionId === activeSessionId
                    const isBusy =
                      session.status === 'streaming' || session.status === 'tool_running'
                    const isError = session.status === 'error'

                    return (
                      <SidebarMenuItem key={session.sessionId}>
                        <SidebarMenuButton
                          onClick={() => {
                            onSwitchSession(session.sessionId)
                          }}
                          isActive={isActive}
                          className="pl-7"
                        >
                          {isBusy && <Loader2 data-icon="inline-start" className="animate-spin" />}
                          {isError && <AlertCircle data-icon="inline-start" />}
                          {!isBusy && !isError && <MessageCircle data-icon="inline-start" />}
                          <span>{session.title}</span>
                        </SidebarMenuButton>
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
                <Settings data-icon="inline-start" />
                <span>Settings</span>
              </SidebarMenuButton>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </ShadcnSidebar>
    </>
  )
}
