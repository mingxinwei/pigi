import * as React from 'react';
import { ContextMenu } from 'radix-ui';
import { IconChevronRight } from '@tabler/icons-react';

import { cn } from '@/lib/utils';
import { VIBRANCY_OVERLAY_CONTENT } from '@/lib/layoutConstants';

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
        VIBRANCY_OVERLAY_CONTENT,
        'z-50 w-48 overflow-hidden rounded-lg p-1',
        'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
        'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
        className,
      )}
      {...props}
    />
  </ContextMenu.Portal>
));
ContextMenuContent.displayName = ContextMenu.Content.displayName;

const ContextMenuItem = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.Item>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.Item> & {
    inset?: boolean;
    variant?: 'default' | 'destructive';
  }
>(({ className, inset, variant = 'default', ...props }, ref) => (
  <ContextMenu.Item
    ref={ref}
    data-inset={inset}
    data-variant={variant}
    className={cn(
      'relative flex cursor-default items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs outline-hidden select-none',
      'data-highlighted:bg-foreground/5',
      'data-[variant=destructive]:text-destructive data-[variant=destructive]:focus:bg-destructive/10 data-[variant=destructive]:focus:text-destructive',
      'data-disabled:pointer-events-none data-disabled:opacity-50',
      '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg]:size-4',
      'data-[variant=destructive]:*:[svg]:text-destructive',
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

const ContextMenuSubTrigger = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.SubTrigger>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.SubTrigger> & {
    inset?: boolean;
  }
>(({ className, inset, children, ...props }, ref) => (
  <ContextMenu.SubTrigger
    ref={ref}
    data-inset={inset}
    className={cn(
      'flex cursor-default items-center gap-1.5 rounded-md px-1.5 py-1 text-sm outline-hidden select-none',
      'focus:bg-accent focus:text-accent-foreground',
      'data-inset:pl-7 data-open:bg-accent data-open:text-accent-foreground',
      '[&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*="size-"])]:size-4',
      className,
    )}
    {...props}
  >
    {children}
    <IconChevronRight className="ml-auto" />
  </ContextMenu.SubTrigger>
));
ContextMenuSubTrigger.displayName = ContextMenu.SubTrigger.displayName;

const ContextMenuSubContent = React.forwardRef<
  React.ComponentRef<typeof ContextMenu.SubContent>,
  React.ComponentPropsWithoutRef<typeof ContextMenu.SubContent>
>(({ className, ...props }, ref) => (
  <ContextMenu.SubContent
    ref={ref}
    className={cn(
      'z-50 min-w-32 overflow-hidden rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg',
      'data-[side=bottom]:slide-in-from-top-2 data-[side=left]:slide-in-from-right-2 data-[side=right]:slide-in-from-left-2 data-[side=top]:slide-in-from-bottom-2',
      'data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95',
      className,
    )}
    {...props}
  />
));
ContextMenuSubContent.displayName = ContextMenu.SubContent.displayName;

const ContextMenuShortcut = ({
  className,
  ...props
}: React.ComponentProps<'span'>): React.JSX.Element => {
  return (
    <span
      data-slot="context-menu-shortcut"
      className={cn(
        'ml-auto text-xs tracking-widest text-muted-foreground',
        'group-focus/context-menu-item:text-accent-foreground',
        className,
      )}
      {...props}
    />
  );
};
ContextMenuShortcut.displayName = 'ContextMenuShortcut';

export {
  ContextMenuRoot,
  ContextMenuTrigger,
  ContextMenuContent,
  ContextMenuItem,
  ContextMenuSeparator,
  ContextMenuSubTrigger,
  ContextMenuSubContent,
  ContextMenuShortcut,
};
