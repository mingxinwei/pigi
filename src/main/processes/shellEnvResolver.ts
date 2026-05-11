import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SHELL_LOGIN_INTERACTIVE_FLAGS = ['-i', '-l'];
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

let resolved = false;

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
  const commonShells = [
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    '/usr/local/bin/fish',
    '/opt/homebrew/bin/fish',
  ];
  return [...new Set([shell, dsclShell, ...commonShells])].filter(
    (candidate): candidate is string => Boolean(candidate && existsSync(candidate)),
  );
}

/**
 * Resolve the user's full PATH by spawning interactive login shells.
 * On macOS, apps launched from /Applications inherit a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin), so we source the user's
 * shell config (.zprofile + .zshrc) to pick up tools like bk, brew, npm, etc.
 *
 * Uses both -i (interactive) and -l (login) flags to load all config files.
 * Tries all available shells and merges their PATH entries.
 */
function resolveShellPath(): string | null {
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }

  const candidates = getShellCandidates();
  const seen = new Set<string>();
  const merged: string[] = [];

  for (const shell of candidates) {
    try {
      const isFish = shell.includes('fish');
      const shellCommand = isFish ? 'string join : $PATH' : 'echo $PATH';
      const shellArgs = isFish
        ? [SHELL_COMMAND_FLAG, shellCommand]
        : [...SHELL_LOGIN_INTERACTIVE_FLAGS, SHELL_COMMAND_FLAG, shellCommand];
      const output = execFileSync(shell, shellArgs, {
        encoding: 'utf8',
        timeout: DETECTION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      // Take last line — interactive shells may print motd/welcome before our echo
      const result = output.split(/\r?\n/).pop() || null;
      if (result) {
        for (const dir of result.split(':')) {
          if (dir && !seen.has(dir)) {
            seen.add(dir);
            merged.push(dir);
          }
        }
      }
    } catch {
      // Try next shell candidate
    }
  }

  return merged.length > 0 ? merged.join(':') : null;
}

/**
 * Initialize shell environment by resolving PATH from the user's interactive login shell.
 * Should be called once early in the main process lifecycle.
 */
export function initializeShellEnv(): void {
  if (resolved) {
    return;
  }
  resolved = true;
  const shellPath = resolveShellPath();
  if (shellPath) {
    process.env['PATH'] = shellPath;
  }
}
