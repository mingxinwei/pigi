import type { PiSessionInfo } from '../../../../shared/ipcContract';

/**
 * Format a date string as a relative time (e.g. "2h", "3d", "now").
 */
export function formatRelativeTime(value: string, now: number): string {
  const timestamp = new Date(value).getTime();
  if (!Number.isFinite(timestamp)) {
    return '';
  }

  const elapsedSeconds = Math.max(0, Math.round((now - timestamp) / 1000));
  const ranges: Array<[string, number]> = [
    ['y', 60 * 60 * 24 * 365],
    ['mo', 60 * 60 * 24 * 30],
    ['w', 60 * 60 * 24 * 7],
    ['d', 60 * 60 * 24],
    ['h', 60 * 60],
    ['m', 60],
  ];

  for (const [suffix, seconds] of ranges) {
    if (elapsedSeconds >= seconds) {
      return `${Math.floor(elapsedSeconds / seconds)}${suffix}`;
    }
  }

  return 'now';
}

/**
 * Format a date string for display in tooltips (e.g. "2026-05-01 16:47").
 */
export function formatDateTime(value: string): string {
  const date = new Date(value);
  if (!Number.isFinite(date.getTime())) {
    return '';
  }
  const y = date.getFullYear();
  const mo = String(date.getMonth() + 1).padStart(2, '0');
  const d = String(date.getDate()).padStart(2, '0');
  const h = String(date.getHours()).padStart(2, '0');
  const m = String(date.getMinutes()).padStart(2, '0');
  return `${y}-${mo}-${d} ${h}:${m}`;
}

/**
 * Get the display title for a session.
 */
export function getSessionTitle(session: PiSessionInfo): string {
  return (session.name ?? session.firstMessage).replace(/\s+/g, ' ').trim();
}

/**
 * Check if a session is currently running (not idle).
 */
export function isSessionRunning(
  sessionPath: string,
  sessions: Map<string, { status: string }>,
): boolean {
  const entry = sessions.get(sessionPath);
  return entry !== undefined && entry.status !== 'idle';
}
