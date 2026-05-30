import type React from 'react';
import { cn } from '../lib/utils';

interface MenuItemProps extends React.ComponentProps<'button'> {
  inset?: boolean;
}

export function MenuItem({
  className,
  inset,
  children,
  ...props
}: MenuItemProps): React.JSX.Element {
  return (
    <button
      type="button"
      className={cn(
        'flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1 text-xs text-popover-foreground outline-none transition-colors hover:bg-foreground/5 [&_svg]:size-4 [&_svg]:shrink-0',
        inset && 'pl-8',
        className,
      )}
      {...props}
    >
      {children}
    </button>
  );
}
