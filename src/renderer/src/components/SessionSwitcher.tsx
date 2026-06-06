import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import dayjs from 'dayjs';
import type { PiSessionInfo } from '../../../shared/ipcContract';
import fuzzysort from 'fuzzysort';
import {
  Command,
  CommandDialog,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
} from './ui/command';

interface FlattenedSession {
  path: string;
  title: string;
  projectName: string;
  modified: string;
  cwd: string;
  isActive: boolean;
}

interface SessionSwitcherProps {
  projectSessions: Record<string, PiSessionInfo[]>;
  navigationBackStack: string[];
  navigationForwardStack: string[];
  activeSessionPath: string | null;
  onSwitch: (sessionPath: string) => void;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

function getProjectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || cwd;
}

function formatTime(isoString: string): string {
  return dayjs(isoString).format('HH:mm');
}

function highlightResult(result: Fuzzysort.Result, fallback: string): React.ReactNode {
  const highlighted = result.highlight((match, index) => (
    <span key={index} className="font-semibold text-foreground underline underline-offset-2">
      {match}
    </span>
  ));
  if (Array.isArray(highlighted) && highlighted.length === 0) return fallback;
  return highlighted;
}

export default function SessionSwitcher({
  projectSessions,
  navigationBackStack,
  navigationForwardStack,
  activeSessionPath,
  onSwitch,
  open,
  onOpenChange,
}: SessionSwitcherProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const commandListRef = useRef<HTMLDivElement>(null);

  // Flatten and sort all sessions
  const allSessions = useMemo((): FlattenedSession[] => {
    const historyOrder = new Map<string, number>();
    const historySet = new Set<string>();
    const allHistoryPaths = [
      ...navigationBackStack,
      ...(activeSessionPath ? [activeSessionPath] : []),
      ...navigationForwardStack,
    ];
    for (let index = 0; index < allHistoryPaths.length; index++) {
      const path = allHistoryPaths[index];
      if (!historySet.has(path)) {
        historySet.add(path);
        historyOrder.set(path, allHistoryPaths.length - index);
      }
    }

    const flattened: FlattenedSession[] = [];
    for (const cwd of Object.keys(projectSessions)) {
      const sessions = projectSessions[cwd];
      for (const session of sessions) {
        flattened.push({
          path: session.path,
          title: session.name || session.firstMessage || 'Untitled',
          projectName: getProjectName(session.cwd),
          modified: session.modified,
          cwd: session.cwd,
          isActive: session.path === activeSessionPath,
        });
      }
    }

    flattened.sort((a, b) => {
      // Active session always first
      if (a.isActive) return -1;
      if (b.isActive) return 1;

      const aHistoryRank = historyOrder.get(a.path);
      const bHistoryRank = historyOrder.get(b.path);
      if (aHistoryRank !== undefined && bHistoryRank !== undefined) {
        return bHistoryRank - aHistoryRank;
      }
      if (aHistoryRank !== undefined) return -1;
      if (bHistoryRank !== undefined) return 1;
      return b.modified.localeCompare(a.modified);
    });

    return flattened;
  }, [projectSessions, navigationBackStack, navigationForwardStack, activeSessionPath]);

  // Search (filtered + highlight data)
  const { filteredSessions, highlightMap } = useMemo(() => {
    const trimmed = query.trim().toLowerCase();
    if (!trimmed) {
      return { filteredSessions: allSessions, highlightMap: new Map<string, Fuzzysort.Result[]>() };
    }

    const searchTargets = allSessions.map((session) => ({
      session,
      title: session.title,
      projectName: session.projectName,
    }));

    const results = fuzzysort.go(trimmed, searchTargets, {
      keys: ['title', 'projectName'],
      threshold: -10000,
    });

    const sessions: FlattenedSession[] = [];
    const map = new Map<string, Fuzzysort.Result[]>();

    for (const result of results) {
      sessions.push(result.obj.session);
      map.set(result.obj.session.path, [result[0], result[1]]);
    }

    return { filteredSessions: sessions, highlightMap: map };
  }, [query, allSessions]);

  const handleSelect = useCallback(
    (path: string) => {
      onSwitch(path);
      onOpenChange(false);
      setQuery('');
    },
    [onSwitch, onOpenChange],
  );

  const handleOpenChange = useCallback(
    (nextOpen: boolean) => {
      if (!nextOpen) setQuery('');
      onOpenChange(nextOpen);
    },
    [onOpenChange],
  );

  // Reset scroll position when query is cleared
  useEffect(() => {
    if (!query) {
      requestAnimationFrame(() => {
        if (commandListRef.current) {
          commandListRef.current.scrollTop = 0;
        }
      });
    }
  }, [query]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Session switcher"
      description="Search and switch sessions"
      className="top-4 left-[calc(50%+8rem)] translate-y-0"
      showOverlay={false}
    >
      <Command shouldFilter={false}>
        <CommandInput
          placeholder="Search sessions..."
          value={query}
          onValueChange={setQuery}
          autoFocus
        />
        <CommandList ref={commandListRef}>
          {filteredSessions.length === 0 ? (
            <CommandEmpty>
              {allSessions.length === 0 ? 'No sessions yet, create a session first.' : 'No results'}
            </CommandEmpty>
          ) : (
            <CommandGroup>
              {filteredSessions.map((session) => {
                const results = highlightMap.get(session.path);
                return (
                  <CommandItem
                    key={session.path}
                    value={session.path}
                    onSelect={() => handleSelect(session.path)}
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <span className="min-w-0 max-w-[90%] flex-1 truncate text-sm">
                        {results ? highlightResult(results[0], session.title) : session.title}
                      </span>
                      <span className="shrink-0 ml-auto text-sm text-muted-foreground">
                        {results
                          ? highlightResult(results[1], session.projectName)
                          : session.projectName}
                      </span>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatTime(session.modified)}
                      </span>
                    </div>
                  </CommandItem>
                );
              })}
            </CommandGroup>
          )}
        </CommandList>
      </Command>
    </CommandDialog>
  );
}
