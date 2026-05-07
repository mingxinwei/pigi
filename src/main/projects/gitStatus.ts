import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { GitBranchResult } from '../../shared/ipcContract';

const execFileAsync = promisify(execFile);

const GIT_EXECUTABLE = 'git';
const GIT_BRANCH_ARGS = ['symbolic-ref', '--quiet', '--short', 'HEAD'] as const;
const GIT_COMMIT_ARGS = ['rev-parse', '--short', 'HEAD'] as const;
const GIT_TIMEOUT_MS = 1500;
const DETACHED_BRANCH_PREFIX = 'detached:';

async function runGit(cwd: string, args: readonly string[]): Promise<string | null> {
  try {
    const { stdout } = await execFileAsync(GIT_EXECUTABLE, [...args], {
      cwd,
      timeout: GIT_TIMEOUT_MS,
      windowsHide: true,
    });
    const value = stdout.trim();
    return value.length > 0 ? value : null;
  } catch {
    return null;
  }
}

export async function getGitBranch(cwd: string): Promise<GitBranchResult> {
  if (!cwd || cwd.trim().length === 0) {
    return { success: false, error: 'cwd must be a non-empty string' };
  }

  const branch = await runGit(cwd, GIT_BRANCH_ARGS);
  if (branch) {
    return { success: true, branch, detached: false };
  }

  const commit = await runGit(cwd, GIT_COMMIT_ARGS);
  return {
    success: true,
    branch: commit ? `${DETACHED_BRANCH_PREFIX}${commit}` : null,
    detached: Boolean(commit),
  };
}
