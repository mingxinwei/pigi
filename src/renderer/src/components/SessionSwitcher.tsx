import { useState, useMemo, useCallback, useRef, useEffect } from 'react';
import type { PiSessionInfo } from '../../../shared/ipcContract';
import fuzzysort from 'fuzzysort';
import { cn, formatRelativeTime } from '../lib/utils';
import { OVERLAY_BG, FLOATING_ITEM_HOVER } from '../lib/layoutConstants';
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
  /** If true, preselect the second item (previous session) on open */
  autoSelectPrevious?: boolean;
}

function getProjectName(cwd: string): string {
  const parts = cwd.replace(/\\/g, '/').split('/');
  return parts[parts.length - 1] || cwd;
}

function highlightResult(result: Fuzzysort.Result, fallback: string): React.ReactNode {
  const highlighted = result.highlight((match, index) => (
    <span key={index} className="bg-ring/25 rounded-sm px-0.5">
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
  autoSelectPrevious = false,
}: SessionSwitcherProps): React.JSX.Element {
  const [query, setQuery] = useState('');
  const [selectedValue, setSelectedValue] = useState('');
  const commandListRef = useRef<HTMLDivElement>(null);
  const [relativeTimeBase] = useState(() => Date.now());

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

  // cmdk does not auto-scroll to top when filtering is external (shouldFilter=false)
  useEffect(() => {
    commandListRef.current?.scrollTo(0, 0);
  }, [filteredSessions]);

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

  // Ctrl+Tab navigation: move selection down within the filtered list
  const handleCommandKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.key === 'Tab' && event.ctrlKey) {
        event.preventDefault();
        const currentIndex = filteredSessions.findIndex((s) => s.path === selectedValue);
        const nextIndex = event.shiftKey
          ? (currentIndex - 1 + filteredSessions.length) % filteredSessions.length
          : (currentIndex + 1) % filteredSessions.length;
        const nextPath = filteredSessions[nextIndex]?.path;
        if (nextPath) {
          setSelectedValue(nextPath);
        }
      }
    },
    [filteredSessions, selectedValue],
  );

  // When opened via Ctrl+Tab, preselect the second item (previous session)
  useEffect(() => {
    if (!open || !autoSelectPrevious) return;
    const secondPath = filteredSessions[1]?.path;
    if (secondPath) {
      requestAnimationFrame(() => setSelectedValue(secondPath));
    }
  }, [open, autoSelectPrevious, filteredSessions]);

  // Select highlighted item when Ctrl is released (Ctrl+Tab only)
  useEffect(() => {
    if (!open || !autoSelectPrevious) return;
    const handleKeyUp = (event: KeyboardEvent): void => {
      if (event.key === 'Control' && selectedValue) {
        handleSelect(selectedValue);
      }
    };
    window.addEventListener('keyup', handleKeyUp);
    return () => window.removeEventListener('keyup', handleKeyUp);
  }, [open, autoSelectPrevious, selectedValue, handleSelect]);

  return (
    <CommandDialog
      open={open}
      onOpenChange={handleOpenChange}
      title="Session switcher"
      description="Search and switch sessions"
      className={cn('top-4 left-[calc(50%+8rem)] translate-y-0 backdrop-blur-xs', OVERLAY_BG)}
      showOverlay={false}
    >
      <Command
        value={selectedValue}
        onValueChange={setSelectedValue}
        shouldFilter={false}
        onKeyDown={handleCommandKeyDown}
        className={cn(OVERLAY_BG, `[&_[data-selected=true]]:${FLOATING_ITEM_HOVER}`)}
      >
        <CommandInput
          placeholder="Search sessions..."
          value={query}
          onValueChange={setQuery}
          autoFocus
          inputGroupClassName="h-[44px]"
        />
        <CommandList ref={commandListRef} className="max-h-96 pt-1">
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
                    showCheckIcon={false}
                    className="px-2 py-1.5"
                  >
                    <div className="flex min-w-0 flex-1 items-center gap-2">
                      <div className="flex min-w-0 flex-1 flex-col gap-0">
                        <span className="min-w-0 flex-1 truncate text-sm">
                          {results ? highlightResult(results[0], session.title) : session.title}
                        </span>
                        <span className="text-xs text-muted-foreground">
                          {results
                            ? highlightResult(results[1], session.projectName)
                            : session.projectName}
                        </span>
                      </div>
                      <span className="shrink-0 text-xs text-muted-foreground">
                        {formatRelativeTime(session.modified, relativeTimeBase)}
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
