import type React from 'react';
import { Toaster as Sonner, type ToasterProps } from 'sonner';
import {
  IconCircleCheck,
  IconInfoCircle,
  IconAlertTriangle,
  IconAlertOctagon,
  IconLoader,
} from '@tabler/icons-react';

function Toaster({ ...props }: ToasterProps): React.JSX.Element {
  return (
    <Sonner
      theme="system"
      className="toaster group"
      position="bottom-right"
      gap={8}
      icons={{
        success: <IconCircleCheck className="size-4" />,
        info: <IconInfoCircle className="size-4" />,
        warning: <IconAlertTriangle className="size-4" />,
        error: <IconAlertOctagon className="size-4" />,
        loading: <IconLoader className="size-4 animate-spin" />,
      }}
      style={
        {
          '--normal-bg': 'var(--popover)',
          '--normal-text': 'var(--popover-foreground)',
          '--normal-border': 'transparent',
          '--success-bg': 'color-mix(in oklab, var(--popover) 85%, #16a34a)',
          '--success-text': '#15803d',
          '--success-border': 'transparent',
          '--error-bg': 'color-mix(in oklab, var(--popover) 85%, #dc2626)',
          '--error-text': '#b91c1c',
          '--error-border': 'transparent',
          '--border-radius': 'var(--radius-md)',
        } as React.CSSProperties
      }
      {...props}
    />
  );
}

export { Toaster };
