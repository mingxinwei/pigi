import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';

const SHELL_LOGIN_INTERACTIVE_FLAGS = ['-i', '-l'];
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

/**
 * Env vars to import from the user's shell config into the app process.
 * GUI apps inherit only a minimal environment from launchd, so anything that
 * must match the terminal goes here, resolved from the interactive login shell.
 */
const SHELL_ENV_ALLOWLIST = ['PI_SUBAGENT_PI_BINARY'] as const;

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
 * Print PATH and allowlisted variables as KEY=VALUE lines.
 * printf %s keeps values from being interpreted as shell escapes; quoting
 * prevents word splitting and glob expansion on spaces or wildcards in PATH.
 */
function buildShellProbeCommand(isFish: boolean): string {
  const variableProbes = SHELL_ENV_ALLOWLIST.map(
    (name) => `printf '${name}=%s\\n' "$${name}"`,
  ).join('; ');
  const pathProbe = isFish
    ? 'printf "PATH=%s\\n" (string join : $PATH)'
    : 'printf "PATH=%s\\n" "$PATH"';
  return `${variableProbes}; ${pathProbe}`;
}

/**
 * Resolve the user's PATH and allowlisted variables by spawning interactive
 * login shells. On macOS, /Applications apps inherit a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin), so we source the user's shell config
 * (.zprofile + .zshrc) to pick up tools like bk, brew, npm, etc.
 *
 * Tries all available shells, merges PATH entries across them, and keeps the
 * first non-empty value for each allowlisted variable.
 */
function resolveShellEnv(): { pathDirs: string[]; envVars: Record<string, string> } | null {
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }

  const candidates = getShellCandidates();
  const pathDirs: string[] = [];
  const envVars: Record<string, string> = {};

  for (const shell of candidates) {
    try {
      const isFish = shell.includes('fish');
      const shellArgs = isFish
        ? [SHELL_COMMAND_FLAG, buildShellProbeCommand(isFish)]
        : [...SHELL_LOGIN_INTERACTIVE_FLAGS, SHELL_COMMAND_FLAG, buildShellProbeCommand(isFish)];
      const output = execFileSync(shell, shellArgs, {
        encoding: 'utf8',
        timeout: DETECTION_TIMEOUT_MS,
        stdio: ['ignore', 'pipe', 'ignore'],
      }).trim();
      for (const line of output.split(/\r?\n/)) {
        const separatorIndex = line.indexOf('=');
        if (separatorIndex <= 0) {
          continue;
        }
        const key = line.slice(0, separatorIndex);
        const value = line.slice(separatorIndex + 1);
        if (key === 'PATH') {
          for (const dir of value.split(':')) {
            if (dir && !pathDirs.includes(dir)) {
              pathDirs.push(dir);
            }
          }
        } else if (
          SHELL_ENV_ALLOWLIST.some((name) => name === key) &&
          value !== '' &&
          envVars[key] === undefined
        ) {
          envVars[key] = value;
        }
      }
    } catch {
      // Try next shell candidate
    }
  }

  return pathDirs.length > 0 || Object.keys(envVars).length > 0 ? { pathDirs, envVars } : null;
}

/**
 * Initialize the shell environment by merging PATH and allowlisted variables
 * from the user's interactive login shell into process.env.
 */
export function initializeShellEnv(): void {
  if (resolved) {
    return;
  }
  resolved = true;
  const shellEnv = resolveShellEnv();
  if (!shellEnv) {
    return;
  }
  if (shellEnv.pathDirs.length > 0) {
    process.env['PATH'] = shellEnv.pathDirs.join(':');
  }
  for (const [key, value] of Object.entries(shellEnv.envVars)) {
    process.env[key] = value;
  }
}
