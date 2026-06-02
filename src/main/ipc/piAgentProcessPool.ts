import { createPiAgentProcess } from '../processes/createPiAgentProcess';
import { type ModelInfo, type UtilityCommand } from '../../shared/ipcContract';

interface SessionProcess {
  process: Electron.UtilityProcess;
  sessionPath: string;
  lastUsedAt: number;
  isBusy: boolean;
}

interface WarmProcess {
  process: Electron.UtilityProcess;
  ready: boolean;
  models: ModelInfo[];
  thinkingLevels: string[];
}

const MAX_IDLE_SESSION_PROCESS_COUNT = 3;

export class PiAgentProcessPool {
  private readonly sessionProcesses = new Map<string, SessionProcess>();
  private warmProcess: WarmProcess | null = null;
  private activeSessionPath: string | null = null;
  private warmCwds: string[] = [];

  constructor(private readonly onSessionProcessExit: (sessionPath: string, code: number) => void) {}

  // ===========================================================================
  // Warm process management
  // ===========================================================================

  /**
   * Ensure a warm process exists. Spawns one if not present.
   * The warm process initializes services (model registry, extensions) but
   * does NOT create a session file — it stays unbound until claimed.
   */
  ensureWarmProcess(cwds: string[] = this.warmCwds): void {
    this.warmCwds = [...new Set(cwds)];
    if (this.warmProcess) {
      // Already have one — just prewarm any new cwds
      this.prewarmWarmProcess();
      return;
    }
    this.spawnWarmProcess();
  }

  /** Get model/thinking options from the warm process (empty if not yet ready). */
  getWarmSessionOptions(): { models: ModelInfo[]; thinkingLevels: string[] } {
    if (!this.warmProcess || !this.warmProcess.ready) {
      return { models: [], thinkingLevels: [] };
    }
    return {
      models: this.warmProcess.models,
      thinkingLevels: this.warmProcess.thinkingLevels,
    };
  }

  /** Whether the warm process is initialized and ready to accept create_session. */
  isWarmProcessReady(): boolean {
    return this.warmProcess?.ready ?? false;
  }

  /**
   * Claim the warm process for a real session. Returns the process and removes
   * it from warm state. Immediately spawns a new warm process as replacement.
   * Returns null if no warm process exists.
   */
  claimWarmProcess(): Electron.UtilityProcess | null {
    if (!this.warmProcess) {
      return null;
    }
    const proc = this.warmProcess.process;
    this.warmProcess = null;
    // Spawn replacement immediately
    this.spawnWarmProcess();
    return proc;
  }

  // ===========================================================================
  // Session process management
  // ===========================================================================

  /** Spawn a fresh process (no warm available). */
  createFreshProcess(): Electron.UtilityProcess {
    return createPiAgentProcess();
  }

  registerSessionProcess(sessionPath: string, proc: Electron.UtilityProcess): void {
    // Kill old process if same sessionPath was already registered (prevents leaks)
    const existing = this.sessionProcesses.get(sessionPath);
    if (existing && existing.process !== proc) {
      existing.process.kill();
    }

    this.sessionProcesses.set(sessionPath, {
      process: proc,
      sessionPath,
      lastUsedAt: Date.now(),
      isBusy: false,
    });
    this.activeSessionPath = sessionPath;

    proc.on('exit', (code) => {
      this.sessionProcesses.delete(sessionPath);
      if (this.activeSessionPath === sessionPath) {
        this.activeSessionPath = null;
      }
      this.onSessionProcessExit(sessionPath, code);
    });
  }

  findBySessionPath(sessionPath: string): SessionProcess | undefined {
    return this.sessionProcesses.get(sessionPath);
  }

  updateBusyState(proc: Electron.UtilityProcess, isBusy: boolean): void {
    const entry = this.findSessionProcessByProcess(proc);
    if (!entry) {
      return;
    }

    entry.isBusy = isBusy;
    entry.lastUsedAt = Date.now();
    if (!isBusy) {
      this.pruneIdleSessionProcesses();
    }
  }

  touchSessionProcess(sessionPath: string): boolean {
    const entry = this.sessionProcesses.get(sessionPath);
    if (!entry) {
      return false;
    }

    entry.lastUsedAt = Date.now();
    this.activeSessionPath = sessionPath;
    return true;
  }

  destroySessionProcess(sessionPath: string): boolean {
    const entry = this.sessionProcesses.get(sessionPath);
    if (!entry) {
      return false;
    }

    entry.process.kill();
    this.sessionProcesses.delete(sessionPath);
    if (this.activeSessionPath === sessionPath) {
      this.activeSessionPath = null;
    }
    return true;
  }

  stopAllProcesses(): void {
    for (const entry of this.sessionProcesses.values()) {
      entry.process.kill();
    }
    this.sessionProcesses.clear();
    this.activeSessionPath = null;

    if (this.warmProcess) {
      this.warmProcess.process.kill();
      this.warmProcess = null;
    }
  }

  // ===========================================================================
  // Private
  // ===========================================================================

  private spawnWarmProcess(): void {
    const proc = createPiAgentProcess();
    this.warmProcess = {
      process: proc,
      ready: false,
      models: [],
      thinkingLevels: [],
    };
    proc.on('exit', () => {
      if (this.warmProcess?.process === proc) {
        this.warmProcess = null;
      }
    });
    // Listen for warm_ready response
    proc.on(
      'message',
      (message: { type: string; models?: unknown[]; thinkingLevels?: string[] }) => {
        if (message.type === 'warm_ready' && this.warmProcess?.process === proc) {
          this.warmProcess.ready = true;
          this.warmProcess.models = (message.models ?? []) as ModelInfo[];
          this.warmProcess.thinkingLevels = (message.thinkingLevels ?? []) as string[];
        }
      },
    );
    // Send warm_up command to initialize services
    const command: UtilityCommand = { type: 'warm_up', cwds: this.warmCwds };
    proc.postMessage(command);
  }

  private prewarmWarmProcess(): void {
    if (!this.warmProcess || this.warmCwds.length === 0) {
      return;
    }
    const command: UtilityCommand = { type: 'prewarm_session_services', cwds: this.warmCwds };
    this.warmProcess.process.postMessage(command);
  }

  private findSessionProcessByProcess(proc: Electron.UtilityProcess): SessionProcess | null {
    for (const entry of this.sessionProcesses.values()) {
      if (entry.process === proc) {
        return entry;
      }
    }
    return null;
  }

  private pruneIdleSessionProcesses(): void {
    let idleSessionCount = Array.from(this.sessionProcesses.values()).filter(
      (entry) => !entry.isBusy,
    ).length;
    const idleEntries = Array.from(this.sessionProcesses.values())
      .filter((entry) => entry.sessionPath !== this.activeSessionPath && !entry.isBusy)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt);

    while (idleSessionCount > MAX_IDLE_SESSION_PROCESS_COUNT) {
      const entry = idleEntries.shift();
      if (!entry) {
        return;
      }
      this.sessionProcesses.delete(entry.sessionPath);
      idleSessionCount -= 1;
      entry.process.kill();
    }
  }
}
