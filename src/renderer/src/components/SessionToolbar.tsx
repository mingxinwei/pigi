import React, { useState, useCallback } from 'react';
import { IconFilter2, IconNotebook, IconTerminal2 } from '@tabler/icons-react';
import { useAppStore } from '../state/appStore';
import { useTypewriter } from '../hooks/useTypewriter';
import { useRenameSuppress } from '../hooks/useRenameSuppress';
import { getSessionTitle } from './sidebar/utils';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from './ui/dropdown-menu';
import { Tooltip, TooltipContent, TooltipProvider, TooltipTrigger } from './ui/tooltip';

interface SessionToolbarProps {
  sessionPath: string;
  onRename?: (sessionPath: string, name: string) => void;
  terminalOpen: boolean;
  onToggleTerminal: () => void;
  /** Formatted shortcut (e.g. "⌘ J") shown in the terminal button tooltip. */
  terminalShortcutLabel: string;
}

export default React.memo(function SessionToolbar({
  sessionPath,
  onRename,
  terminalOpen,
  onToggleTerminal,
  terminalShortcutLabel,
}: SessionToolbarProps): React.JSX.Element {
  const title = useAppStore(
    useCallback(
      (state) => {
        const cwd = state.sessions.get(sessionPath)?.cwd ?? '';
        const sessionList = cwd ? state.projectSessions[cwd] : undefined;
        if (sessionList) {
          const match = sessionList.find((s) => s.path === sessionPath);
          if (match) return getSessionTitle(match);
        }
        return state.sessions.get(sessionPath)?.title ?? 'New chat';
      },
      [sessionPath],
    ),
  );
  const toolBlockViewMode = useAppStore((state) => state.toolBlockViewMode);
  const setToolBlockViewMode = useAppStore((state) => state.setToolBlockViewMode);

  const [displayTitle, skipNextAnimation] = useTypewriter(title);
  useRenameSuppress(sessionPath, skipNextAnimation);

  const [isEditing, setIsEditing] = useState(false);
  const [editValue, setEditValue] = useState('');

  const handleStartRename = useCallback(() => {
    setEditValue(title);
    setIsEditing(true);
  }, [title]);

  const handleFinishRename = useCallback(() => {
    const trimmed = editValue.trim();
    if (trimmed && trimmed !== title && onRename) {
      skipNextAnimation();
      onRename(sessionPath, trimmed);
    }
    setIsEditing(false);
  }, [editValue, title, onRename, sessionPath, skipNextAnimation]);

  const handleKeyDown = useCallback(
    (event: React.KeyboardEvent) => {
      if (event.nativeEvent.isComposing || event.key === 'Process') {
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        handleFinishRename();
      } else if (event.key === 'Escape') {
        event.preventDefault();
        setIsEditing(false);
      }
    },
    [handleFinishRename],
  );

  return (
    <div className="flex shrink-0 items-center gap-2 px-3 h-11 border-b-[0.5px] border-foreground/27">
      <div className="flex min-w-0 max-w-[33%] items-center gap-1.5">
        <IconNotebook size={16} stroke={2} className="shrink-0 text-foreground" />
        {isEditing ? (
          <input
            type="text"
            value={editValue}
            onChange={(event) => setEditValue(event.target.value)}
            onBlur={handleFinishRename}
            onKeyDown={handleKeyDown}
            autoFocus
            size={editValue.length || 1}
            className="min-w-0 max-w-full bg-transparent text-sm font-medium text-foreground outline-none caret-foreground"
          />
        ) : (
          <span
            className="truncate text-sm font-medium text-foreground cursor-default"
            title={title}
            onDoubleClick={handleStartRename}
          >
            {displayTitle}
          </span>
        )}
      </div>

      <div className="flex-1" />

      <TooltipProvider delayDuration={400}>
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              aria-label="Toggle terminal"
              aria-pressed={terminalOpen}
              onClick={onToggleTerminal}
              className={`flex items-center justify-center rounded p-1 transition-colors size-7 hover:bg-muted ${terminalOpen ? 'text-foreground' : 'text-muted-foreground hover:text-foreground'}`}
            >
              <IconTerminal2 size={16} stroke={1.5} />
            </button>
          </TooltipTrigger>
          <TooltipContent side="bottom" className="flex items-center gap-2">
            <span>Toggle terminal</span>
            {terminalShortcutLabel && (
              <kbd className="font-mono text-xs text-muted-foreground">{terminalShortcutLabel}</kbd>
            )}
          </TooltipContent>
        </Tooltip>
      </TooltipProvider>

      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            type="button"
            title="View mode"
            className="flex items-center justify-center rounded p-1 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors size-7"
          >
            <IconFilter2 size={16} stroke={1.5} />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent
          align="end"
          sideOffset={6}
          className="min-w-0 w-fit bg-popover/50 p-1.5 backdrop-blur-md"
        >
          <DropdownMenuRadioGroup
            value={toolBlockViewMode}
            onValueChange={(value) =>
              setToolBlockViewMode(value as 'default' | 'compact_read' | 'minimal')
            }
          >
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem
                    value="compact_read"
                    className="pl-2 pr-8 py-1.5 text-[13px] transition-colors data-[state=checked]:bg-[var(--system-accent)]/10 data-[state=checked]:text-[var(--system-accent)] data-[state=checked]:focus:bg-[var(--system-accent)]/10 data-[state=checked]:focus:text-[var(--system-accent)] data-[state=checked]:focus:**:text-[var(--system-accent)]"
                  >
                    Compact
                  </DropdownMenuRadioItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Collapse consecutive read-only tool calls into a single group
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem
                    value="minimal"
                    className="pl-2 pr-8 py-1.5 text-[13px] transition-colors data-[state=checked]:bg-[var(--system-accent)]/10 data-[state=checked]:text-[var(--system-accent)] data-[state=checked]:focus:bg-[var(--system-accent)]/10 data-[state=checked]:focus:text-[var(--system-accent)] data-[state=checked]:focus:**:text-[var(--system-accent)]"
                  >
                    Minimal
                  </DropdownMenuRadioItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Minimal activity view: working timer, tool cards, final summary
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem
                    value="default"
                    className="pl-2 pr-8 py-1.5 text-[13px] transition-colors data-[state=checked]:bg-[var(--system-accent)]/10 data-[state=checked]:text-[var(--system-accent)] data-[state=checked]:focus:bg-[var(--system-accent)]/10 data-[state=checked]:focus:text-[var(--system-accent)] data-[state=checked]:focus:**:text-[var(--system-accent)]"
                  >
                    Show All
                  </DropdownMenuRadioItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Display every tool call as an individual expanded block
                </TooltipContent>
              </Tooltip>
            </TooltipProvider>
          </DropdownMenuRadioGroup>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  );
});
