/**
 * Remembers the real rendered height of every measured list row, keyed by
 * item id, across MessageList remounts (session switches remount the whole
 * list via key={activeSessionPath}, which throws away the virtualizer's
 * own measurement cache). estimateSize consults this cache first, so a
 * restored session lays out at its previously measured heights instead of
 * raw estimates — saved pixel scroll positions land where they were saved,
 * and scrolling to the bottom does not chase estimate-to-measure growth.
 *
 * Entries self-heal: whenever a row re-renders its ref re-records the live
 * height, and rows the virtualizer measures overwrite whatever was cached.
 */
const measuredRowHeights = new Map<string, number>();

/** Caps memory; chat sessions produce thousands of small rows over time. */
const MAX_CACHED_ROW_HEIGHTS = 10_000;

export function getMeasuredRowHeight(key: string): number | undefined {
  return measuredRowHeights.get(key);
}

export function recordMeasuredRowHeight(key: string, height: number): void {
  if (!Number.isFinite(height) || height <= 0) return;
  // Delete first so re-recording refreshes the insertion-order position.
  measuredRowHeights.delete(key);
  measuredRowHeights.set(key, height);
  if (measuredRowHeights.size > MAX_CACHED_ROW_HEIGHTS) {
    const oldestKey = measuredRowHeights.keys().next().value;
    if (oldestKey !== undefined) {
      measuredRowHeights.delete(oldestKey);
    }
  }
}
