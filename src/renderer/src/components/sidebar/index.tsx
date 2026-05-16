import { useEffect, useState, useCallback } from 'react';
import { IconFolderPlus, IconPlus, IconSettings, IconLogin2 } from '@tabler/icons-react';
import type { PiSessionInfo } from '../../../../shared/ipcContract';
import { formatShortcutLabel } from '../../shortcuts/formatShortcutLabel';
import type { ShortcutBinding } from '../../../../shared/ipcContract';
import { Kbd } from '../ui/kbd';
import { isSessionRunning } from './utils';
import { TooltipProvider } from '../ui/tooltip';
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
  SidebarSeparator,
} from '../ui/sidebar';
import { Popover, PopoverContent, PopoverTrigger } from '../ui/popover';
import type { SidebarProps } from './types';
import { ProjectList } from './projectList';

export default function Sidebar({
  sessions,
  selectedSessionId,
  recentProjects,
  projectSessions,
  shortcutBindings,
  onNewSession,
  onNewSessionForProject,
  onSwitchSession,
  onResumeSession,
  onOpenProject,
  onSelectProject,
  onRemoveProject,
  onReorderProjects,
  onRenameSession,
  onLogin,
}: SidebarProps): React.JSX.Element {
  const [expandedProjects, setExpandedProjects] = useState<Set<string>>(new Set());
  const [visibleWhenCollapsedSessionIds, setVisibleWhenCollapsedSessionIds] = useState<
    Record<string, Set<string>>
  >({});
  const [relativeTimeBase, setRelativeTimeBase] = useState(() => Date.now());

  useEffect(() => {
    const timer = window.setInterval(() => {
      setRelativeTimeBase(Date.now());
    }, 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const getProjectSessions = useCallback(
    (projectPath: string): PiSessionInfo[] => {
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
          modified: session.createdAt,
          messageCount: 0,
          firstMessage: session.title,
          allMessagesText: session.title,
        }));

      return [...runningSessions, ...listedSessions];
    },
    [projectSessions, sessions],
  );

  const toggleProjectExpand = useCallback(
    (projectPath: string) => {
      setExpandedProjects((current) => {
        const next = new Set(current);
        if (next.has(projectPath)) {
          // Collapsing: snapshot currently-running session IDs so they stay visible.
          next.delete(projectPath);
          const runningIds = new Set(
            getProjectSessions(projectPath)
              .filter((s) => isSessionRunning(s.id, sessions))
              .map((s) => s.id),
          );
          if (runningIds.size > 0) {
            setVisibleWhenCollapsedSessionIds((prev) => ({
              ...prev,
              [projectPath]: runningIds,
            }));
          } else {
            setVisibleWhenCollapsedSessionIds((prev) => {
              const nextState = { ...prev };
              delete nextState[projectPath];
              return nextState;
            });
          }
        } else {
          // Expanding: clear the snapshot for this project.
          next.add(projectPath);
          setVisibleWhenCollapsedSessionIds((prev) => {
            const nextState = { ...prev };
            delete nextState[projectPath];
            return nextState;
          });
        }
        return next;
      });
    },
    [getProjectSessions, sessions],
  );

  const handleNewSessionForProject = useCallback(
    (projectPath: string) => {
      setExpandedProjects((current) => {
        if (current.has(projectPath)) return current;
        const next = new Set(current);
        next.add(projectPath);
        return next;
      });
      onNewSessionForProject(projectPath);
    },
    [onNewSessionForProject],
  );

  return (
    <TooltipProvider delayDuration={300}>
      <ShadcnSidebar
        collapsible="none"
        className="[&_.tabler-icon]:stroke-[1.25] bg-transparent"
        data-testid="sidebar"
      >
        {/* WebkitAppRegion is Electron-specific, not in React's CSSProperties */}
        <SidebarHeader style={{ WebkitAppRegion: 'drag' } as React.CSSProperties}>
          <div className="h-10" />
          <SidebarMenu style={{ WebkitAppRegion: 'no-drag' } as React.CSSProperties}>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onNewSession}>
                <IconPlus data-icon="inline-start" />
                <span>New chat</span>
                <Kbd className="ml-auto hidden shrink-0 group-hover/menu-item:inline-flex">
                  {formatShortcutLabel(
                    shortcutBindings?.get('sidebar.newChat') ??
                      ({ key: 'n', meta: true } satisfies ShortcutBinding),
                  )}
                </Kbd>
              </SidebarMenuButton>
            </SidebarMenuItem>
            <SidebarMenuItem>
              <SidebarMenuButton onClick={onOpenProject}>
                <IconFolderPlus data-icon="inline-start" />
                <span>Open project</span>
                <Kbd className="ml-auto hidden shrink-0 group-hover/menu-item:inline-flex">
                  {formatShortcutLabel(
                    shortcutBindings?.get('sidebar.openProject') ??
                      ({ key: 'o', meta: true } satisfies ShortcutBinding),
                  )}
                </Kbd>
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
              <ProjectList
                sessions={sessions}
                recentProjects={recentProjects}
                selectedSessionId={selectedSessionId}
                relativeTimeBase={relativeTimeBase}
                expandedProjects={expandedProjects}
                visibleWhenCollapsedSessionIdsByPath={visibleWhenCollapsedSessionIds}
                onToggleProjectExpand={toggleProjectExpand}
                onSelectProject={onSelectProject}
                onNewSessionForProject={handleNewSessionForProject}
                onSwitchSession={onSwitchSession}
                onResumeSession={onResumeSession}
                onOpenProject={onOpenProject}
                onRemoveProject={onRemoveProject}
                onReorderProjects={onReorderProjects}
                onRenameSession={onRenameSession}
                getProjectSessions={getProjectSessions}
              />
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarSeparator />

        <SidebarFooter className="p-0">
          <SidebarMenu>
            <SidebarMenuItem>
              <Popover>
                <PopoverTrigger asChild>
                  <SidebarMenuButton>
                    <IconSettings data-icon="inline-start" />
                    <span>Settings</span>
                  </SidebarMenuButton>
                </PopoverTrigger>
                <PopoverContent side="top" align="end" sideOffset={2} className="w-48 p-1.5">
                  <button
                    type="button"
                    className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-sm text-popover-foreground hover:bg-accent hover:text-accent-foreground transition-colors"
                    onClick={onLogin}
                  >
                    <IconLogin2 className="size-4 shrink-0" />
                    <span>Login</span>
                  </button>
                </PopoverContent>
              </Popover>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
      </ShadcnSidebar>
    </TooltipProvider>
  );
}
