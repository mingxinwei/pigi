import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import ElectronStore from 'electron-store';
import { PIGI_NPM_COMMAND_ENV, type NpmCommand } from '../../shared/npmCommand';

interface NpmCommandStoreSchema {
  npmCommandDetectionAttempted: boolean;
  npmCommandDetectionAttemptedAt: number | null;
  npmCommand: NpmCommand | null;
}

const STORE_NAME = 'runtimeEnvironment';
const NPM_COMMAND_DETECTION_ATTEMPTED_KEY = 'npmCommandDetectionAttempted';
const NPM_COMMAND_DETECTION_ATTEMPTED_AT_KEY = 'npmCommandDetectionAttemptedAt';
const NPM_COMMAND_KEY = 'npmCommand';
const NPM_COMMAND_DETECTION_RETRY_DELAY_MS = 300000;
const LOOKUP_NPM_COMMAND = 'command -v npm';
const SHELL_LOGIN_FLAG = '-l';
const SHELL_COMMAND_FLAG = '-c';
const DETECTION_TIMEOUT_MS = 5000;
const WINDOWS_PLATFORM = 'win32';

const store = new ElectronStore<NpmCommandStoreSchema>({
  name: STORE_NAME,
  defaults: {
    npmCommandDetectionAttempted: false,
    npmCommandDetectionAttemptedAt: null,
    npmCommand: null,
  },
});

let cachedNpmCommand: NpmCommand | null | undefined;
let cachedNpmCommandDetectedAt: number | null = null;

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

function lookupNpmPathWithShell(shell: string, args: string[]): string | null {
  try {
    const output = execFileSync(shell, args, {
      encoding: 'utf8',
      timeout: DETECTION_TIMEOUT_MS,
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();

    return output.split(/\r?\n/)[0] || null;
  } catch {
    return null;
  }
}

function lookupNpmPath(): string | null {
  const candidates = getShellCandidates();
  for (const shell of candidates) {
    const loginResult = lookupNpmPathWithShell(shell, [
      SHELL_LOGIN_FLAG,
      SHELL_COMMAND_FLAG,
      LOOKUP_NPM_COMMAND,
    ]);
    if (loginResult) {
      return loginResult;
    }

    const nonLoginResult = lookupNpmPathWithShell(shell, [SHELL_COMMAND_FLAG, LOOKUP_NPM_COMMAND]);
    if (nonLoginResult) {
      return nonLoginResult;
    }
  }

  return null;
}

function detectNpmCommand(): NpmCommand | null {
  // The packaged Windows client does not support this POSIX shell based npm discovery path yet.
  if (process.platform === WINDOWS_PLATFORM) {
    return null;
  }

  const npmPath = lookupNpmPath();
  return npmPath ? [npmPath] : null;
}

export function initializeNpmCommandDetection(): void {
  const now = Date.now();
  if (
    cachedNpmCommand !== undefined &&
    (cachedNpmCommand ||
      (cachedNpmCommandDetectedAt &&
        now - cachedNpmCommandDetectedAt < NPM_COMMAND_DETECTION_RETRY_DELAY_MS))
  ) {
    return;
  }

  const detectionAttempted = store.get(NPM_COMMAND_DETECTION_ATTEMPTED_KEY, false);
  const attemptedAt = store.get(NPM_COMMAND_DETECTION_ATTEMPTED_AT_KEY, null);
  if (
    detectionAttempted &&
    attemptedAt &&
    now - attemptedAt < NPM_COMMAND_DETECTION_RETRY_DELAY_MS
  ) {
    cachedNpmCommand = store.get(NPM_COMMAND_KEY, null);
    cachedNpmCommandDetectedAt = attemptedAt;
    return;
  }

  cachedNpmCommand = detectNpmCommand();
  cachedNpmCommandDetectedAt = now;
  store.set(NPM_COMMAND_KEY, cachedNpmCommand);
  store.set(NPM_COMMAND_DETECTION_ATTEMPTED_AT_KEY, cachedNpmCommandDetectedAt);
  store.set(NPM_COMMAND_DETECTION_ATTEMPTED_KEY, Boolean(cachedNpmCommand));
}

export function getNpmCommandUtilityEnv(): NodeJS.ProcessEnv {
  initializeNpmCommandDetection();

  if (!cachedNpmCommand) {
    return { ...process.env };
  }

  const npmDir = cachedNpmCommand[0] ? path.dirname(cachedNpmCommand[0]) : null;
  const currentPath = process.env['PATH'] || '';
  const pathNeedsAugment = npmDir && !currentPath.split(path.delimiter).includes(npmDir);

  return {
    ...process.env,
    [PIGI_NPM_COMMAND_ENV]: JSON.stringify(cachedNpmCommand),
    ...(pathNeedsAugment ? { PATH: `${npmDir}${path.delimiter}${currentPath}` } : {}),
  };
}
