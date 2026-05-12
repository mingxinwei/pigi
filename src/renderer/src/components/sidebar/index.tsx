import { useEffect, useState, useCallback } from 'react';
import { IconFolderPlus, IconPlus } from '@tabler/icons-react';
import type { PiSessionInfo } from '../../../../shared/ipcContract';
import { isSessionRunning } from './utils';
import { TooltipProvider } from '../ui/tooltip';
import {
  Sidebar as ShadcnSidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
} from '../ui/sidebar';
import type { SidebarProps } from './types';
import { ProjectList } from './projectList';

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
  onRemoveProject,
  onReorderProjects,
  onRenameSession,
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
      </ShadcnSidebar>
    </TooltipProvider>
  );
}
