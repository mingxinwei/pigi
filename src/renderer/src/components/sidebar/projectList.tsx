import { useCallback, useRef, useState } from 'react';
import { IconFolder, IconFolderOpen, IconFolderPlus, IconPlus } from '@tabler/icons-react';
import type { PiSessionInfo, ProjectDirectory } from '../../../../shared/ipcContract';
import type { SessionEntry } from '../../state/appStore';
import { cn } from '../../lib/utils';
import { SidebarMenu, SidebarMenuAction, SidebarMenuButton, SidebarMenuItem } from '../ui/sidebar';
import { ContextMenuRoot, ContextMenuTrigger, ContextMenuContent } from '../ui/context-menu';
import { MenuItem } from '../MenuItem';
import { SessionList } from './sessionList';

const NEW_PROJECT_SESSION_LABEL = 'New chat';

interface ProjectItemProps {
  project: ProjectDirectory;
  sessions: Map<string, SessionEntry>;
  projectSessions: PiSessionInfo[];
  visibleWhenCollapsedSessionIds: Set<string>;
  selectedSessionId: string | null;
  relativeTimeBase: number;
  isExpanded: boolean;
  onToggleExpand: () => void;
  onSelect: () => void;
  onNewSession: () => void;
  onSwitchSession: (sessionId: string) => void;
  onResumeSession: (session: PiSessionInfo) => void;
  onRemove: () => void;
  onRenameSession: (sessionId: string, name: string) => void;
  onDragStart: (e: React.DragEvent) => void;
  onDragOver: (e: React.DragEvent) => void;
  onDragEnd: () => void;
  onDrop: (e: React.DragEvent) => void;
  isDragOver: boolean;
}

function ProjectItem({
  project,
  sessions,
  projectSessions,
  visibleWhenCollapsedSessionIds,
  selectedSessionId,
  relativeTimeBase,
  isExpanded,
  onToggleExpand,
  onSelect,
  onNewSession,
  onSwitchSession,
  onResumeSession,
  onRemove,
  onRenameSession,
  onDragStart,
  onDragOver,
  onDragEnd,
  onDrop,
  isDragOver,
}: ProjectItemProps): React.JSX.Element {
  const rowRef = useRef<HTMLDivElement>(null);

  const handleDragStart = useCallback(
    (e: React.DragEvent) => {
      // Use only the header row as the drag image
      if (rowRef.current) {
        e.dataTransfer.setDragImage(rowRef.current, 0, 0);
      }
      onDragStart(e);
    },
    [onDragStart],
  );

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <SidebarMenuItem
          className={cn(
            'group/project',
            isExpanded && 'mb-3',
            isDragOver && 'border-t-2 border-primary',
          )}
        >
          <div
            ref={rowRef}
            draggable
            onDragStart={handleDragStart}
            onDragOver={onDragOver}
            onDragEnd={onDragEnd}
            onDrop={onDrop}
          >
            <SidebarMenuButton
              onClick={() => {
                onSelect();
                onToggleExpand();
              }}
              title={project.path}
              className="text-sidebar-foreground/65"
            >
              {isExpanded ? (
                <IconFolderOpen data-icon="inline-start" />
              ) : (
                <IconFolder data-icon="inline-start" />
              )}
              <span>{project.name}</span>
            </SidebarMenuButton>
          </div>
          <SidebarMenuAction
            title={`${NEW_PROJECT_SESSION_LABEL} in ${project.name}`}
            onClick={onNewSession}
            className="opacity-0 group-hover/project:opacity-100 transition-opacity"
          >
            <IconPlus />
            <span className="sr-only">{NEW_PROJECT_SESSION_LABEL}</span>
          </SidebarMenuAction>

          <SessionList
            sessions={sessions}
            projectSessions={projectSessions}
            selectedSessionId={selectedSessionId}
            relativeTimeBase={relativeTimeBase}
            isExpanded={isExpanded}
            visibleWhenCollapsedSessionIds={visibleWhenCollapsedSessionIds}
            onSwitchSession={onSwitchSession}
            onResumeSession={onResumeSession}
            onRenameSession={onRenameSession}
          />
        </SidebarMenuItem>
      </ContextMenuTrigger>
      <ContextMenuContent className="menu-content min-w-0 p-0 bg-transparent shadow-none ring-0 border-0">
        <MenuItem onClick={onRemove}>Remove</MenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

interface ProjectListProps {
  sessions: Map<string, SessionEntry>;
  recentProjects: ProjectDirectory[];
  selectedSessionId: string | null;
  relativeTimeBase: number;
  expandedProjects: Set<string>;
  visibleWhenCollapsedSessionIdsByPath: Record<string, Set<string>>;
  onToggleProjectExpand: (path: string) => void;
  onSelectProject: (path: string) => void;
  onNewSessionForProject: (path: string) => void;
  onSwitchSession: (sessionId: string) => void;
  onResumeSession: (session: PiSessionInfo) => void;
  onOpenProject: () => void;
  onRemoveProject: (path: string) => void;
  onReorderProjects: (paths: string[]) => void;
  onRenameSession: (sessionId: string, name: string) => void;
  getProjectSessions: (projectPath: string) => PiSessionInfo[];
}

export function ProjectList({
  sessions,
  recentProjects,
  selectedSessionId,
  relativeTimeBase,
  expandedProjects,
  visibleWhenCollapsedSessionIdsByPath,
  onToggleProjectExpand,
  onSelectProject,
  onNewSessionForProject,
  onSwitchSession,
  onResumeSession,
  onOpenProject,
  onRemoveProject,
  onReorderProjects,
  onRenameSession,
  getProjectSessions,
}: ProjectListProps): React.JSX.Element {
  const [dragOverPath, setDragOverPath] = useState<string | null>(null);
  const draggedPathRef = useRef<string | null>(null);

  const handleDragStart = useCallback((e: React.DragEvent, path: string) => {
    draggedPathRef.current = path;
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', path);
  }, []);

  const handleDragOver = useCallback((e: React.DragEvent, path: string) => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    if (draggedPathRef.current && draggedPathRef.current !== path) {
      setDragOverPath(path);
    }
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent, targetPath: string) => {
      e.preventDefault();
      setDragOverPath(null);
      const sourcePath = draggedPathRef.current;
      if (!sourcePath || sourcePath === targetPath) return;

      const paths = recentProjects.map((p) => p.path);
      const sourceIdx = paths.indexOf(sourcePath);
      const targetIdx = paths.indexOf(targetPath);
      if (sourceIdx === -1 || targetIdx === -1) return;

      paths.splice(sourceIdx, 1);
      paths.splice(targetIdx, 0, sourcePath);
      onReorderProjects(paths);
    },
    [recentProjects, onReorderProjects],
  );

  const handleDragEnd = useCallback(() => {
    draggedPathRef.current = null;
    setDragOverPath(null);
  }, []);

  if (recentProjects.length === 0) {
    return (
      <SidebarMenu>
        <SidebarMenuItem>
          <SidebarMenuButton onClick={onOpenProject} className="text-muted-foreground">
            <IconFolderPlus data-icon="inline-start" />
            <span>Open a project</span>
          </SidebarMenuButton>
        </SidebarMenuItem>
      </SidebarMenu>
    );
  }

  return (
    <SidebarMenu>
      {recentProjects.map((project) => (
        <ProjectItem
          key={project.path}
          project={project}
          sessions={sessions}
          projectSessions={getProjectSessions(project.path)}
          visibleWhenCollapsedSessionIds={
            visibleWhenCollapsedSessionIdsByPath[project.path] ?? new Set()
          }
          selectedSessionId={selectedSessionId}
          relativeTimeBase={relativeTimeBase}
          isExpanded={expandedProjects.has(project.path)}
          onToggleExpand={() => onToggleProjectExpand(project.path)}
          onSelect={() => onSelectProject(project.path)}
          onNewSession={() => onNewSessionForProject(project.path)}
          onSwitchSession={onSwitchSession}
          onResumeSession={onResumeSession}
          onRemove={() => onRemoveProject(project.path)}
          onRenameSession={onRenameSession}
          onDragStart={(e) => handleDragStart(e, project.path)}
          onDragOver={(e) => handleDragOver(e, project.path)}
          onDragEnd={handleDragEnd}
          onDrop={(e) => handleDrop(e, project.path)}
          isDragOver={dragOverPath === project.path}
        />
      ))}
    </SidebarMenu>
  );
}
