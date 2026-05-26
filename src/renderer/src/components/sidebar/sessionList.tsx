import { useState, useCallback, useMemo } from 'react';
import { IconLoader2 } from '@tabler/icons-react';
import type { PiSessionInfo } from '../../../../shared/ipcContract';
import type { SessionEntry } from '../../state/appStore';
import { SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem } from '../ui/sidebar';
import {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
} from '../ui/context-menu';
import { Tooltip, TooltipContent, TooltipTrigger } from '../ui/tooltip';
import { formatRelativeTime, formatDateTime, getSessionTitle, isSessionRunning } from './utils';

interface SessionItemProps {
  session: PiSessionInfo;
  isActive: boolean;
  isRunning: boolean;
  relativeTimeBase: number;
  onSwitch: () => void;
  onRename: (name: string) => void;
}

export function SessionItem({
  session,
  isActive,
  isRunning,
  relativeTimeBase,
  onSwitch,
  onRename,
}: SessionItemProps): React.JSX.Element {
  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleStartRename = useCallback(() => {
    setEditValue(getSessionTitle(session));
    setIsEditing(true);
  }, [session]);

  const handleFinishRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== getSessionTitle(session)) {
      onRename(trimmed);
    }
    setIsEditing(false);
  }, [editValue, session, onRename]);

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === 'Enter') {
        handleFinishRename();
      } else if (e.key === 'Escape') {
        setIsEditing(false);
      }
    },
    [handleFinishRename],
  );

  const modifiedTime = session.modified || session.created;

  if (isEditing) {
    return (
      <SidebarMenuSubItem>
        <SidebarMenuSubButton
          asChild
          isActive={isActive}
          className="w-full justify-start pl-6 text-left text-sidebar-foreground/65 data-active:bg-primary/10 data-active:text-foreground"
        >
          <div>
            <input
              type="text"
              value={editValue}
              onChange={(e) => setEditValue(e.target.value)}
              onBlur={handleFinishRename}
              onKeyDown={handleKeyDown}
              autoFocus
              className="min-w-0 flex-1 truncate bg-transparent text-sm outline-none caret-foreground"
            />
          </div>
        </SidebarMenuSubButton>
      </SidebarMenuSubItem>
    );
  }

  return (
    <ContextMenuRoot>
      <ContextMenuTrigger asChild>
        <SidebarMenuSubItem>
          <SidebarMenuSubButton
            asChild
            isActive={isActive}
            className="w-full justify-start pl-6 text-left text-sidebar-foreground/65 data-active:bg-primary/10 data-active:text-foreground"
          >
            <button type="button" onClick={onSwitch} onDoubleClick={handleStartRename}>
              <span className="min-w-0 flex-1 truncate text-left" title={getSessionTitle(session)}>
                {getSessionTitle(session)}
              </span>
              {isRunning ? (
                <IconLoader2 className="ml-2 size-3.5 shrink-0 animate-[spin_1.8s_linear_infinite] text-green-500" />
              ) : (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <span className="ml-2 shrink-0 text-xs text-muted-foreground">
                      {formatRelativeTime(modifiedTime, relativeTimeBase)}
                    </span>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="text-xs flex flex-col gap-0.5 items-start">
                    <div>Created: {formatDateTime(session.created)}</div>
                    {session.modified && <div>Updated: {formatDateTime(session.modified)}</div>}
                  </TooltipContent>
                </Tooltip>
              )}
            </button>
          </SidebarMenuSubButton>
        </SidebarMenuSubItem>
      </ContextMenuTrigger>
      <ContextMenuContent>
        <ContextMenuItem onClick={handleStartRename}>Rename</ContextMenuItem>
      </ContextMenuContent>
    </ContextMenuRoot>
  );
}

interface SessionListProps {
  sessions: Map<string, SessionEntry>;
  projectSessions: PiSessionInfo[];
  selectedSessionId: string | null;
  relativeTimeBase: number;
  isExpanded: boolean;
  visibleWhenCollapsedSessionIds?: Set<string>;
  onSwitchSession: (sessionId: string) => void;
  onResumeSession: (session: PiSessionInfo) => void;
  onRenameSession: (sessionId: string, name: string) => void;
}

export function SessionList({
  sessions,
  projectSessions,
  selectedSessionId,
  relativeTimeBase,
  isExpanded,
  visibleWhenCollapsedSessionIds,
  onSwitchSession,
  onResumeSession,
  onRenameSession,
}: SessionListProps): React.JSX.Element {
  const [showAll, setShowAll] = useState(false);
  const visibleSessionCount = 5;

  const isCollapsedWithPinned =
    !isExpanded && visibleWhenCollapsedSessionIds && visibleWhenCollapsedSessionIds.size > 0;

  // When collapsed with pinned sessions, show only those.
  // When expanded, show all with pagination.
  const sessionsToRender = useMemo(() => {
    if (isCollapsedWithPinned) {
      return projectSessions.filter((s) => visibleWhenCollapsedSessionIds!.has(s.id));
    }
    return projectSessions;
  }, [projectSessions, isCollapsedWithPinned, visibleWhenCollapsedSessionIds]);

  const visibleSessions = showAll
    ? sessionsToRender
    : sessionsToRender.slice(0, visibleSessionCount);
  const hiddenCount = sessionsToRender.length - visibleSessions.length;

  function handleSessionSwitch(session: PiSessionInfo): void {
    if (session.path) {
      onResumeSession(session);
    } else {
      onSwitchSession(session.id);
    }
  }

  const showList = isExpanded || isCollapsedWithPinned;

  return (
    <div
      aria-hidden={!showList}
      className={
        showList
          ? 'grid grid-rows-[1fr] translate-y-0 opacity-100 transition-[grid-template-rows,opacity,transform] duration-250 ease-[cubic-bezier(0.2,0.8,0.2,1)]'
          : 'grid grid-rows-[0fr] -translate-y-1 opacity-0 transition-[grid-template-rows,opacity,transform] duration-250 ease-[cubic-bezier(0.4,0,0.2,1)]'
      }
    >
      <div className="min-h-0 overflow-hidden">
        <SidebarMenuSub className="mx-0 border-l-0 px-0">
          {projectSessions.length === 0 ? (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                className="w-full justify-start pl-6 text-left text-muted-foreground"
              >
                <span aria-disabled>No chats yet</span>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          ) : (
            visibleSessions.map((session) => (
              <SessionItem
                key={session.path || session.id}
                session={session}
                isActive={session.id === selectedSessionId}
                isRunning={isSessionRunning(session.id, sessions)}
                relativeTimeBase={relativeTimeBase}
                onSwitch={() => handleSessionSwitch(session)}
                onRename={(name) => onRenameSession(session.id, name)}
              />
            ))
          )}
          {hiddenCount > 0 && !isCollapsedWithPinned && (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                className="w-full justify-start pl-6 text-left text-muted-foreground"
              >
                <button type="button" onClick={() => setShowAll(true)}>
                  <span>Show more</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
          {showAll && sessionsToRender.length > visibleSessionCount && !isCollapsedWithPinned && (
            <SidebarMenuSubItem>
              <SidebarMenuSubButton
                asChild
                className="w-full justify-start pl-6 text-left text-muted-foreground"
              >
                <button type="button" onClick={() => setShowAll(false)}>
                  <span>Show less</span>
                </button>
              </SidebarMenuSubButton>
            </SidebarMenuSubItem>
          )}
        </SidebarMenuSub>
      </div>
    </div>
  );
}
