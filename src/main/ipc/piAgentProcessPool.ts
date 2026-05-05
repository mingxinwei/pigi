import { createPiAgentProcess } from '../processes/createPiAgentProcess'
import { type UtilityCommand } from '../../shared/ipcContract'

interface SessionProcess {
  process: Electron.UtilityProcess
  sessionId: string
  lastUsedAt: number
  isBusy: boolean
}

const MAX_IDLE_SESSION_PROCESS_COUNT = 6
const WARM_SESSION_PROCESS_COUNT = 2

export class PiAgentProcessPool {
  private readonly sessionProcesses = new Map<string, SessionProcess>()
  private readonly warmSessionProcesses: Electron.UtilityProcess[] = []
  private activeSessionId: string | null = null
  private warmSessionCwds: string[] = []

  constructor(private readonly onSessionProcessExit: (sessionId: string, code: number) => void) {}

  ensureWarmSessionProcesses(cwds = this.warmSessionCwds): void {
    this.warmSessionCwds = [...new Set(cwds)]

    while (this.warmSessionProcesses.length < WARM_SESSION_PROCESS_COUNT) {
      this.createWarmSessionProcess()
    }

    for (const proc of this.warmSessionProcesses) {
      this.prewarmProcess(proc)
    }
  }

  claimSessionProcess(): Electron.UtilityProcess {
    const proc = this.warmSessionProcesses.shift()
    if (!proc) {
      return createPiAgentProcess()
    }

    // A warmed process becomes a dedicated session process after setup succeeds.
    return proc
  }

  registerSessionProcess(sessionId: string, proc: Electron.UtilityProcess): void {
    this.sessionProcesses.set(sessionId, {
      process: proc,
      sessionId,
      lastUsedAt: Date.now(),
      isBusy: false,
    })
    this.activeSessionId = sessionId

    proc.on('exit', (code) => {
      this.sessionProcesses.delete(sessionId)
      if (this.activeSessionId === sessionId) {
        this.activeSessionId = null
      }
      this.onSessionProcessExit(sessionId, code)
    })
  }

  updateBusyState(proc: Electron.UtilityProcess, isBusy: boolean): void {
    const entry = this.findSessionProcessByProcess(proc)
    if (!entry) {
      return
    }

    entry.isBusy = isBusy
    entry.lastUsedAt = Date.now()
    if (!isBusy) {
      this.pruneIdleSessionProcesses()
    }
  }

  touchSessionProcess(sessionId: string): boolean {
    const entry = this.sessionProcesses.get(sessionId)
    if (!entry) {
      return false
    }

    entry.lastUsedAt = Date.now()
    this.activeSessionId = sessionId
    return true
  }

  destroySessionProcess(sessionId: string): boolean {
    const entry = this.sessionProcesses.get(sessionId)
    if (!entry) {
      return false
    }

    entry.process.kill()
    this.sessionProcesses.delete(sessionId)
    if (this.activeSessionId === sessionId) {
      this.activeSessionId = null
    }
    return true
  }

  refillAfterSetup(): void {
    this.ensureWarmSessionProcesses()
    this.pruneIdleSessionProcesses()
  }

  stopAllProcesses(): void {
    for (const entry of this.sessionProcesses.values()) {
      entry.process.kill()
    }
    this.sessionProcesses.clear()
    this.activeSessionId = null

    for (const proc of this.warmSessionProcesses) {
      proc.kill()
    }
    this.warmSessionProcesses.length = 0
  }

  private removeWarmSessionProcess(proc: Electron.UtilityProcess): void {
    const index = this.warmSessionProcesses.indexOf(proc)
    if (index >= 0) {
      this.warmSessionProcesses.splice(index, 1)
    }
  }

  private prewarmProcess(proc: Electron.UtilityProcess): void {
    if (this.warmSessionCwds.length === 0) {
      return
    }

    const cmd: UtilityCommand = {
      type: 'prewarm_session_services',
      cwds: this.warmSessionCwds,
    }
    proc.postMessage(cmd)
  }

  private createWarmSessionProcess(): Electron.UtilityProcess {
    const proc = createPiAgentProcess()
    this.warmSessionProcesses.push(proc)
    proc.on('exit', () => {
      this.removeWarmSessionProcess(proc)
    })
    this.prewarmProcess(proc)
    return proc
  }

  private findSessionProcessByProcess(proc: Electron.UtilityProcess): SessionProcess | null {
    for (const entry of this.sessionProcesses.values()) {
      if (entry.process === proc) {
        return entry
      }
    }
    return null
  }

  private pruneIdleSessionProcesses(): void {
    let idleSessionCount = Array.from(this.sessionProcesses.values()).filter(
      (entry) => !entry.isBusy,
    ).length
    const idleEntries = Array.from(this.sessionProcesses.values())
      .filter((entry) => entry.sessionId !== this.activeSessionId && !entry.isBusy)
      .sort((a, b) => a.lastUsedAt - b.lastUsedAt)

    while (idleSessionCount > MAX_IDLE_SESSION_PROCESS_COUNT) {
      const entry = idleEntries.shift()
      if (!entry) {
        return
      }
      this.sessionProcesses.delete(entry.sessionId)
      idleSessionCount -= 1
      entry.process.kill()
    }
  }
}
