import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SHELL_INTERACTIVE_FLAG = '-i';
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

let cachedResolvedPath: string | null | undefined;

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
 * Resolve the user's full PATH by spawning an interactive shell.
 * On macOS, apps launched from /Applications inherit a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin), so we source the user's
 * shell config (.zshrc/.bashrc) to pick up tools like bk, brew, npm, etc.
 *
 * This runs once at app startup and the result is cached in memory.
 */
function resolveLoginShellPath(): string | null {
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }
  const candidates = getShellCandidates();
  for (const shell of candidates) {
    try {
      const output = execFileSync(
        shell,
        [SHELL_INTERACTIVE_FLAG, SHELL_COMMAND_FLAG, 'echo $PATH'],
        {
          encoding: 'utf8',
          timeout: DETECTION_TIMEOUT_MS,
          stdio: ['ignore', 'pipe', 'ignore'],
        },
      ).trim();
      // Take last line — interactive shells may print motd/welcome before our echo
      const result = output.split(/\r?\n/).pop() || null;
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
 * Initialize shell environment by resolving PATH from the user's interactive shell.
 * Should be called once early in the main process lifecycle.
 */
export function initializeShellEnv(): void {
  if (cachedResolvedPath !== undefined) {
    return;
  }
  cachedResolvedPath = resolveLoginShellPath();
  if (cachedResolvedPath) {
    process.env['PATH'] = cachedResolvedPath;
  }
}

/**
 * Returns process.env with the resolved PATH.
 * Used when spawning utility processes so they inherit the full user environment.
 */
export function getResolvedShellEnv(): NodeJS.ProcessEnv {
  initializeShellEnv();
  return { ...process.env };
}
