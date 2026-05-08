import { execFile } from 'node:child_process';
import { access } from 'node:fs/promises';

const SHELL_INTERACTIVE_FLAG = '-i';
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

let resolvedEnvPromise: Promise<void> | null = null;

function execFileAsync(cmd: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { encoding: 'utf8', timeout: DETECTION_TIMEOUT_MS }, (err, stdout) => {
      if (err) reject(err);
      else resolve(stdout.trim());
    });
  });
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function getUserShellFromDirectoryService(): Promise<string | null> {
  if (process.platform !== 'darwin') {
    return null;
  }
  try {
    const output = await execFileAsync('dscl', [
      '.',
      '-read',
      `/Users/${process.env['USER']}`,
      'UserShell',
    ]);
    const match = output.match(/UserShell:\s*(.+)/);
    return match?.[1]?.trim() || null;
  } catch {
    return null;
  }
}

async function getShellCandidates(): Promise<string[]> {
  const shell = process.env['SHELL'];
  const dsclShell = await getUserShellFromDirectoryService();
  const commonShells = [
    '/bin/zsh',
    '/bin/bash',
    '/bin/sh',
    '/usr/local/bin/fish',
    '/opt/homebrew/bin/fish',
  ];
  const candidates = [...new Set([shell, dsclShell, ...commonShells])].filter((c): c is string =>
    Boolean(c),
  );
  const checks = await Promise.all(
    candidates.map((c) => fileExists(c).then((ok) => (ok ? c : null))),
  );
  return checks.filter((c): c is string => c !== null);
}

/**
 * Resolve the user's full PATH by spawning an interactive shell.
 * On macOS, apps launched from /Applications inherit a minimal PATH
 * (just /usr/bin:/bin:/usr/sbin:/sbin), so we source the user's
 * shell config (.zshrc/.bashrc) to pick up tools like bk, brew, npm, etc.
 *
 * This runs once at app startup and the result is cached in memory.
 */
async function resolveLoginShellPath(): Promise<string | null> {
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }
  const candidates = await getShellCandidates();

  // Spawn all candidates concurrently, merge all successful results
  const results = await Promise.allSettled(
    candidates.map(async (shell) => {
      const isFish = shell.includes('fish');
      const cmd = isFish ? 'string join : $PATH' : 'echo $PATH';
      const args = isFish
        ? [SHELL_COMMAND_FLAG, cmd]
        : [SHELL_INTERACTIVE_FLAG, SHELL_COMMAND_FLAG, cmd];
      const output = await execFileAsync(shell, args);
      // Take last line — interactive shells may print motd/welcome before our echo
      const result = output.split(/\r?\n/).pop() || null;
      if (!result) throw new Error('empty output');
      return result;
    }),
  );

  // Merge all PATH entries from all shells, deduplicate preserving order
  const seen = new Set<string>();
  const merged: string[] = [];
  for (const result of results) {
    if (result.status === 'fulfilled') {
      for (const dir of result.value.split(':')) {
        if (dir && !seen.has(dir)) {
          seen.add(dir);
          merged.push(dir);
        }
      }
    }
  }

  return merged.length > 0 ? merged.join(':') : null;
}

/**
 * Initialize shell environment by resolving PATH from the user's interactive shell.
 * Should be called once early in the main process lifecycle.
 * Returns a promise that resolves when PATH is ready.
 */
export function initializeShellEnv(): Promise<void> {
  if (!resolvedEnvPromise) {
    resolvedEnvPromise = resolveLoginShellPath().then((resolved) => {
      if (resolved) {
        process.env['PATH'] = resolved;
      }
    });
  }
  return resolvedEnvPromise;
}

/**
 * Returns process.env with the resolved PATH.
 * Used when spawning utility processes so they inherit the full user environment.
 */
export async function getResolvedShellEnv(): Promise<NodeJS.ProcessEnv> {
  await initializeShellEnv();
  return { ...process.env };
}
