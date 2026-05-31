import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

/** Shared overlay content style — used by Dialog, Popover, and other floating panels. */
export const OVERLAY_CONTENT =
  'rounded-xl bg-popover/88 backdrop-blur-sm p-4 text-sm text-popover-foreground shadow-md ring-[0.5px] ring-foreground/25 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';
