import * as React from 'react';
import { ContextMenu } from 'radix-ui';

import { cn } from '@/lib/utils';

const ContextMenuRoot = ContextMenu.Root;
const ContextMenuTrigger = ContextMenu.Trigger;

const ContextMenuContent = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.Content>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.Content>
>(({ className, ...props }, ref) => (
  <ContextMenu.Portal>
    <ContextMenu.Content
      ref={ref}
      className={cn(
        'z-50 min-w-0 w-48 overflow-hidden rounded-lg border bg-popover/80 backdrop-blur-xl p-1 text-popover-foreground shadow-md animate-in fade-in-80 data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95 data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        className,
      )}
      {...props}
    />
  </ContextMenu.Portal>
));
ContextMenuContent.displayName = ContextMenu.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.Item> & { inset?: boolean }
>(({ className, inset, ...props }, ref) => (
  <ContextMenu.Item
    ref={ref}
    className={cn(
      'relative flex cursor-default select-none items-center rounded-lg px-2 py-1 text-xs outline-none focus:bg-accent focus:text-accent-foreground data-[disabled]:pointer-events-none data-[disabled]:opacity-50',
      inset && 'pl-8',
      className,
    )}
    {...props}
  />
));
ContextMenuItem.displayName = ContextMenu.Item.displayName;

const ContextMenuSeparator = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.Separator>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.Separator>
>(({ className, ...props }, ref) => (
  <ContextMenu.Separator
    ref={ref}
    className={cn('-mx-1 my-1 h-px bg-border', className)}
    {...props}
  />
));
ContextMenuSeparator.displayName = ContextMenu.Separator.displayName;

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
};
