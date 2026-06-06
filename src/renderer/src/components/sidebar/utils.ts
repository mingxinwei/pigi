import type { PiSessionInfo } from '../../../../shared/ipcContract';

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
