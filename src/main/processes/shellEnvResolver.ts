import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SHELL_LOGIN_FLAG = '-l';
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

let cachedLoginShellPath: string | null | undefined;

function getUserShellFromDirectoryService(): string | null {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const output = execFileSync(
      'dscl',
      ['.', '-read', `/Users/${process.env['USER']}`, 'UserShell'],
      {
        encoding: 'utf8',
        timeout: DETECTION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      },
    ).trim();
    // Output format: "UserShell: /bin/zsh"
    const match = output.match(/UserShell:\s*(.+)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

function getShellCandidates(): string[] {
  const shell = process.env['SHELL'];
  const dsclShell = getUserShellFromDirectoryService();
  const commonShells = ['/bin/zsh', '/bin/bash', '/bin/sh'];
  return [...new Set([shell, dsclShell, ...commonShells])].filter(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
  );
}

/**
 * Resolve the user's full PATH from their login shell.
 * On macOS, apps launched from /Applications inherit a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin), so we need to source the
 * user's shell profile to get tools like bk, brew, etc.
 */
function resolveLoginShellPath(): string | null {
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }
  const candidates = getShellCandidates();
  for (const shell of candidates) {
    try {
      const output = execFileSync(shell, [SHELL_LOGIN_FLAG, SHELL_COMMAND_FLAG, 'echo $PATH'], {
        encoding: 'utf8',
        timeout: DETECTION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      const result = output.split(/\r?\n/)[0] || null;
      if (result) {
        return result;
      }
    } catch {
      // Try next shell candidate
    }
  }
  return null;
}

/**
 * Initialize shell environment by resolving the user's login shell PATH.
 * Should be called early in the main process lifecycle.
 */
export function initializeShellEnv(): void {
  if (cachedLoginShellPath !== undefined) {
    return;
  }
  cachedLoginShellPath = resolveLoginShellPath();
  if (cachedLoginShellPath) {
    process.env['PATH'] = cachedLoginShellPath;
  }
}

/**
 * Returns process.env with the resolved login shell PATH.
 * Used when spawning utility processes so they inherit the full user environment.
 */
export function getResolvedShellEnv(): NodeJS.ProcessEnv {
  initializeShellEnv();
  return { ...process.env };
}
