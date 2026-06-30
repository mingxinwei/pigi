import React from 'react';
import { IconFilter2 } from '@tabler/icons-react';
import { useAppStore } from '../state/appStore';
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
}

export default React.memo(function SessionToolbar({
  sessionPath,
}: SessionToolbarProps): React.JSX.Element {
  const title = useAppStore((state) => state.sessions.get(sessionPath)?.title ?? 'New chat');
  const toolBlockViewMode = useAppStore((state) => state.toolBlockViewMode);
  const setToolBlockViewMode = useAppStore((state) => state.setToolBlockViewMode);

  return (
    <div className="flex shrink-0 items-center gap-2 px-5 h-10 border-b border-border">
      <span className="max-w-[50%] truncate text-sm text-foreground" title={title}>
        {title}
      </span>

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
        <DropdownMenuContent align="end" sideOffset={4} className="min-w-0 w-fit text-xs bg-popover/50 backdrop-blur-md">
          <DropdownMenuRadioGroup
            value={toolBlockViewMode}
            onValueChange={(value) =>
              setToolBlockViewMode(value as 'default' | 'compact_read')
            }
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
