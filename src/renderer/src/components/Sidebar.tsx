import { useEffect, useState } from 'react';
import {
  IconFolder,
  IconFolderOpen,
  IconFolderPlus,
  IconLoader2,
  IconPlus,
} from '@tabler/icons-react';
import type { PiSessionInfo, ProjectDirectory } from '../../../shared/ipcContract';
import type { SessionEntry } from '../state/appStore';
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
} from './ui/sidebar';

const NEW_PROJECT_SESSION_LABEL = 'New chat';

interface SidebarProps {
  sessions: Map<string, SessionEntry>;
  selectedSessionId: string | null;
  recentProjects: ProjectDirectory[];
  projectSessions: Record<string, PiSessionInfo[]>;
  onNewSession: () => void;
  onNewSessionForProject: (path: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onResumeSession: (session: PiSessionInfo) => void;
  onOpenProject: () => void;
  onSelectProject: (path: string) => void;
}

export default function Sidebar({
  sessions,
  selectedSessionId,
  recentProjects,
  projectSessions,
  onNewSession,
  onNewSessionForProject,
  onSwitchSession,
  onResumeSession,
  onOpenProject,
  onSelectProject,
}: SidebarProps): React.JSX.Element {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [expandedSessionLists, setExpandedSessionLists] = useState<Set<string>>(new Set());
  const [relativeTimeBase, setRelativeTimeBase] = useState(() => Date.now());
  const visibleSessionCount = 5;

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeTimeBase(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  function getSessionTitle(session: PiSessionInfo): string {
    return (session.name ?? session.firstMessage).replace(/\s+/g, ' ').trim();
  }

  function getProjectSessions(projectPath: string): PiSessionInfo[] {
    const listedSessions = projectSessions[projectPath] ?? [];
    const listedIds = new Set(listedSessions.map((session) => session.id));
    const runningSessions = Array.from(sessions.values())
      .filter(
        (session) => session.cwd === projectPath && !listedIds.has(session.persistedSessionId),
      )
      .map<PiSessionInfo>((session) => ({
        path: session.sessionPath ?? '',
        id: session.persistedSessionId,
        cwd: session.cwd,
        created: session.createdAt,
        modified: '',
        messageCount: 0,
        firstMessage: session.title,
        allMessagesText: session.title,
      }));

    return [...runningSessions, ...listedSessions];
  }

  function toggleProjectSessions(projectPath: string): void {
    setExpandedProjects((current) => {
      const next = new Set(current);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }

  function expandProjectSessions(projectPath: string): void {
    setExpandedProjects((current) => {
      if (current.has(projectPath)) {
        return current;
      }
      const next = new Set(current);
      next.add(projectPath);
      return next;
    });
  }

  function toggleSessionList(projectPath: string): void {
    setExpandedSessionLists((current) => {
      const next = new Set(current);
      if (next.has(projectPath)) {
        next.delete(projectPath);
      } else {
        next.add(projectPath);
      }
      return next;
    });
  }

  function formatRelativeTime(value: string): string {
    const created = new Date(value).getTime();
    if (!Number.isFinite(created)) {
      return '';
    }

    const elapsedSeconds = Math.max(0, Math.round((relativeTimeBase - created) / 1000));
    const ranges: Array<[string, number]> = [
      ['y', 60 * 60 * 24 * 365],
      ['mo', 60 * 60 * 24 * 30],
      ['w', 60 * 60 * 24 * 7],
      ['d', 60 * 60 * 24],
      ['h', 60 * 60],
      ['m', 60],
    ];

    for (const [suffix, seconds] of ranges) {
      if (elapsedSeconds >= seconds) {
        return `${Math.floor(elapsedSeconds / seconds)}${suffix}`;
      }
    }

    return 'now';
  }

  function isSessionRunning(sessionId: string): boolean {
    for (const entry of sessions.values()) {
      if (entry.persistedSessionId === sessionId && entry.status !== 'idle') {
        return true;
      }
    }
    return false;
  }

  return (
    <>
      <ShadcnSidebar
        collapsible="none"
        className="border-r [&_.tabler-icon]:stroke-[1.25]"
        data-testid="sidebar"
      >
        <SidebarHeader style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="h-10" />
          <SidebarMenu style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewSession}>
                <IconPlus data-icon="inline-start" />
                <span>New chat</span>
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
                    const sessionsForProject = getProjectSessions(project.path);
                    const isExpanded = expandedProjects.has(project.path);
                    const isSessionListExpanded = expandedSessionLists.has(project.path);
                    const visibleSessions = isSessionListExpanded
                      ? sessionsForProject
                      : sessionsForProject.slice(0, visibleSessionCount);
                    const hiddenSessionCount = sessionsForProject.length - visibleSessions.length;

                    return (
                      <SidebarMenuItem
                        key={project.path}
                        className={isExpanded ? 'mb-3' : undefined}
                      >
                        <SidebarMenuButton
                          onClick={() => {
                            onSelectProject(project.path);
                            toggleProjectSessions(project.path);
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
                        <SidebarMenuAction
                          title={`${NEW_PROJECT_SESSION_LABEL} in ${project.name}`}
                          onClick={() => {
                            expandProjectSessions(project.path);
                            onNewSessionForProject(project.path);
                          }}
                        >
                          <IconPlus />
                          <span className="sr-only">{NEW_PROJECT_SESSION_LABEL}</span>
                        </SidebarMenuAction>

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
                                  const isActive = session.id === selectedSessionId;

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
                                              onResumeSession(session);
                                            } else {
                                              onSwitchSession(session.id);
                                            }
                                          }}
                                        >
                                          <span
                                            className="min-w-0 flex-1 truncate text-left"
                                            title={getSessionTitle(session)}
                                          >
                                            {getSessionTitle(session)}
                                          </span>
                                          {isSessionRunning(session.id) ? (
                                            <IconLoader2 className="ml-2 size-3.5 shrink-0 animate-spin text-green-500" />
                                          ) : (
                                            <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                                              {formatRelativeTime(session.created)}
                                            </span>
                                          )}
                                        </button>
                                      </SidebarMenuSubButton>
                                    </SidebarMenuSubItem>
                                  );
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
                                        toggleSessionList(project.path);
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
                                          toggleSessionList(project.path);
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
                    );
                  })
                )}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>
      </ShadcnSidebar>
    </>
  );
}
