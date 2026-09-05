/** Max height (px) for collapsible block content (tool output, thinking) before showing expand button */
export const BLOCK_CONTENT_MAX_HEIGHT = 300;

export const MESSAGE_LIST_MAX_WIDTH = 860;
export const MESSAGE_LIST_HORIZONTAL_PADDING = 20;
export const MESSAGE_CONTENT_MAX_WIDTH =
  MESSAGE_LIST_MAX_WIDTH - MESSAGE_LIST_HORIZONTAL_PADDING * 2;
export const CHAT_INPUT_MAX_WIDTH = MESSAGE_CONTENT_MAX_WIDTH;
export const MESSAGE_ROW_GAP = 4;

/** Max entries a collapsed read group previews before its "Show more" toggle. */
export const READ_GROUP_MAX_COLLAPSED_ENTRIES = 3;

/** Vertical inset above the first list row. Modeled as the virtualizer's
 *  paddingStart so virtual coordinates match real scroll coordinates and
 *  the at-end check (getVirtualDistanceFromEnd) is exact. */
export const MESSAGE_LIST_TOP_INSET = 24;

/** Breathing room below the last row's content (replaces the old
 *  last-row extra margin + spacer padding + wrapper pb-8, which summed to
 *  72px). Modeled as the virtualizer's paddingEnd AND applied as the last
 *  row's bottom margin: the margin makes the rows-wrapper's bottom edge
 *  track the last row's DOM growth immediately (a growing row pushes the
 *  wrapper past the spacer, growing scrollHeight in the same layout pass),
 *  which is what keeps the virtualizer's synchronous at-end correction from
 *  being clamped to a stale scrollHeight before the spacer re-renders. */
export const MESSAGE_LIST_BOTTOM_INSET = 72;

/** Distance (px) from the content end within which bottom auto-follow stays
 *  engaged. Shared by the scroll controller's real-DOM checks and the
 *  virtualizer's scrollEndThreshold (exact match because the coordinate
 *  models are aligned). */
export const MESSAGE_LIST_SCROLL_END_THRESHOLD = 2;

/** Bottom terminal panel sizing. */
export const TERMINAL_DEFAULT_HEIGHT = 280;
export const TERMINAL_MIN_HEIGHT = 120;
/** Cap the panel at this fraction of the window height. */
export const TERMINAL_MAX_HEIGHT_RATIO = 0.8;

/** Used by Dialog, Popover, and ContextMenu — these need backdrop-blur but blur renders incorrectly in vibrant regions, so they use a separate configuration. */
export const VIBRANCY_OVERLAY_CONTENT =
  'rounded-xl bg-popover/88 backdrop-blur-sm p-4 text-sm text-popover-foreground shadow-md ring-[0.5px] ring-foreground/25 outline-hidden duration-100 data-open:animate-in data-open:fade-in-0 data-open:zoom-in-95 data-closed:animate-out data-closed:fade-out-0 data-closed:zoom-out-95';

/** Background color used by transparent floating panels. */
export const OVERLAY_BG = 'bg-popover/40';
