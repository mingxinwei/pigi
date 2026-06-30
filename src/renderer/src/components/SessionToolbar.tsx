import React, { useState, useCallback } from 'react';
import { IconFilter2 } from '@tabler/icons-react';
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
}

export default React.memo(function SessionToolbar({
  sessionPath,
  onRename,
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
    <div className="flex shrink-0 items-center gap-2 px-5 h-10 border-b border-border">
      {isEditing ? (
        <input
          type="text"
          value={editValue}
          onChange={(event) => setEditValue(event.target.value)}
          onBlur={handleFinishRename}
          onKeyDown={handleKeyDown}
          autoFocus
          size={editValue.length || 1}
          className="max-w-[50%] min-w-0 bg-transparent text-sm text-foreground outline-none caret-foreground"
        />
      ) : (
        <span
          className="max-w-[50%] truncate text-sm text-foreground cursor-default"
          title={title}
          onDoubleClick={handleStartRename}
        >
          {displayTitle}
        </span>
      )}

      <div className="flex-1" />

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
          sideOffset={4}
          className="min-w-0 w-fit text-xs bg-popover/50 backdrop-blur-md"
        >
          <DropdownMenuRadioGroup
            value={toolBlockViewMode}
            onValueChange={(value) => setToolBlockViewMode(value as 'default' | 'compact_read')}
          >
            <TooltipProvider delayDuration={400}>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem value="compact_read" className="text-xs">
                    Compact
                  </DropdownMenuRadioItem>
                </TooltipTrigger>
                <TooltipContent side="left">
                  Collapse consecutive read-only tool calls into a single group
                </TooltipContent>
              </Tooltip>
              <Tooltip>
                <TooltipTrigger asChild>
                  <DropdownMenuRadioItem value="default" className="text-xs">
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
