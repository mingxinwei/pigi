/**
 * Pi Agent Bridge - main process bridge for session lifecycle.
 *
 * Each session gets its own utility process. Main manages:
 * 1. Spawning process per session
 * 2. Two-step handshake: create session → get real sessionId → distribute ports
 * 3. Process cleanup on destroy or crash
 *
 * After port handshake, main is NOT in the data path.
 */
import { ipcMain, MessageChannelMain } from 'electron'
import { getMainWindow } from '../windows/createMainWindow'
import { createPiAgentProcess, createSessionIndexProcess } from '../processes/createPiAgentProcess'
import {
  PiChannel,
  type SessionIndexCommand,
  type SessionIndexResponse,
  type SessionListResult,
  type UtilityCommand,
  type UtilityResponse,
} from '../../shared/ipcContract'

interface SessionProcess {
  process: Electron.UtilityProcess
  sessionId: string
}

/** Map of real sessionId → process info */
const sessionProcesses = new Map<string, SessionProcess>()
let sessionIndexProcess: Electron.UtilityProcess | null = null
let sessionIndexRequestId = 0

function sendToRenderer(channel: PiChannel, data: unknown): void {
  const win = getMainWindow()
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data)
  }
}

function startSessionIndexProcess(): void {
  if (sessionIndexProcess) {
    return
  }

  const proc = createSessionIndexProcess()
  sessionIndexProcess = proc

  proc.on('message', (msg: SessionIndexResponse) => {
    switch (msg.type) {
      case 'project_sessions_chunk':
        sendToRenderer(PiChannel.ProjectSessionsChunk, {
          requestId: msg.requestId,
          cwd: msg.cwd,
          success: msg.success,
          sessions: msg.sessions,
          error: msg.error,
        })
        break
    }
  })

  proc.on('exit', () => {
    if (sessionIndexProcess === proc) {
      sessionIndexProcess = null
    }
  })
}

function listProjectSessions(cwds: string[]): SessionListResult {
  startSessionIndexProcess()
  if (!sessionIndexProcess) {
    return { success: false, error: 'session index process not available' }
  }

  const requestId = `session-list-${++sessionIndexRequestId}`
  const cmd: SessionIndexCommand = {
    type: 'list_project_sessions',
    requestId,
    cwds: [...new Set(cwds)],
  }
  sessionIndexProcess.postMessage(cmd)
  return { success: true, requestId }
}

/**
 * Spawn a utility process, send lifecycle command, wait for real sessionId,
 * then establish MessagePort between renderer and utility.
 */
function spawnSessionProcess(
  cmd: UtilityCommand,
): Promise<{ success: boolean; sessionId?: string; error?: string }> {
  return new Promise((resolve) => {
    const proc = createPiAgentProcess()
    let resolved = false

    const timeout = setTimeout(() => {
      if (!resolved) {
        resolved = true
        proc.kill()
        resolve({ success: false, error: 'session creation timed out' })
      }
    }, 30000)

    proc.on('message', (msg: UtilityResponse) => {
      if (resolved) return

      switch (msg.type) {
        case 'session_created': {
          resolved = true
          clearTimeout(timeout)

          const sessionId = msg.sessionId
          sessionProcesses.set(sessionId, { process: proc, sessionId })

          // Establish MessagePort
          const { port1, port2 } = new MessageChannelMain()
          const attachCmd: UtilityCommand = { type: 'attach_port' }
          proc.postMessage(attachCmd, [port1])

          const win = getMainWindow()
          if (win && !win.isDestroyed()) {
            win.webContents.postMessage(PiChannel.SessionPort, { sessionId }, [port2])
          }

          // Listen for crash after setup
          proc.on('exit', (code) => {
            sessionProcesses.delete(sessionId)
            sendToRenderer(PiChannel.ProcessExit, { sessionId, code })
          })

          resolve({ success: true, sessionId })
          break
        }
        case 'session_error': {
          resolved = true
          clearTimeout(timeout)
          proc.kill()
          resolve({ success: false, error: msg.error })
          break
        }
      }
    })

    proc.on('exit', (code) => {
      if (!resolved) {
        resolved = true
        clearTimeout(timeout)
        resolve({ success: false, error: `process exited with code ${code} during setup` })
      }
    })

    // Send the lifecycle command to start session creation
    proc.postMessage(cmd)
  })
}

export function stopAllProcesses(): void {
  for (const [, entry] of sessionProcesses) {
    entry.process.kill()
  }
  sessionProcesses.clear()
  sessionIndexProcess?.kill()
  sessionIndexProcess = null
}

export function registerIpcHandlers(): void {
  startSessionIndexProcess()

  ipcMain.handle(PiChannel.CreateSession, async (_e, cwd: string) => {
    if (!cwd || typeof cwd !== 'string') {
      return { success: false, error: 'cwd must be a non-empty string' }
    }
    return spawnSessionProcess({ type: 'create_session', cwd })
  })

  ipcMain.handle(PiChannel.ResumeSession, async (_e, sessionPath: string) => {
    if (!sessionPath || typeof sessionPath !== 'string' || sessionPath.trim().length === 0) {
      return { success: false, error: 'sessionPath must be a non-empty string' }
    }
    return spawnSessionProcess({ type: 'resume_session', sessionPath })
  })

  ipcMain.handle(PiChannel.DestroySession, async (_e, sessionId: string) => {
    if (!sessionId || typeof sessionId !== 'string') {
      return { success: false, error: 'sessionId must be a non-empty string' }
    }
    const entry = sessionProcesses.get(sessionId)
    if (!entry) return { success: false, error: 'session not found' }

    entry.process.kill()
    sessionProcesses.delete(sessionId)
    return { success: true }
  })

  ipcMain.handle(PiChannel.ListProjectSessions, async (_e, cwds: string[]) => {
    if (!Array.isArray(cwds) || cwds.some((cwd) => !cwd || typeof cwd !== 'string')) {
      return { success: false, error: 'cwds must be an array of non-empty strings' }
    }
    return listProjectSessions(cwds)
  })
}
