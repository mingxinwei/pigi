export const MESSAGE_LIST_MAX_WIDTH = 860;
export const MESSAGE_LIST_HORIZONTAL_PADDING = 20;
export const MESSAGE_CONTENT_MAX_WIDTH =
  MESSAGE_LIST_MAX_WIDTH - MESSAGE_LIST_HORIZONTAL_PADDING * 2;
export const CHAT_INPUT_MAX_WIDTH = MESSAGE_CONTENT_MAX_WIDTH;
export const MESSAGE_ROW_GAP = 4;

/** Used by Dialog, Popover, and ContextMenu — these need backdrop-blur but blur renders incorrectly in vibrant regions, so they use a separate configuration. */
export const VIBRANCY_OVERLAY_CONTENT =
  'rounded-xl bg-popover/88 backdrop-blur-sm p-4 text-sm text-popover-foreground shadow-md ring-[0.5px] ring-foreground/25 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

/** Background color used by transparent floating panels. */
export const OVERLAY_BG = 'bg-popover/40';
