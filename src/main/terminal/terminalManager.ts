/**
 * Terminal manager - main-process lifecycle for the bottom-panel PTYs.
 *
 * Mirrors the session architecture: main spawns a terminal utility process per
 * working directory, performs the port handshake, and then stays out of the
 * data path. High-volume PTY I/O flows over the delivered MessagePort.
 *
 * The renderer keeps an LRU of the 5 most-recent terminals and asks main to
 * stop the ones it evicts, so the process map here stays bounded.
 */
import { ipcMain, MessageChannelMain } from 'electron';
import { getMainWindow } from '../windows/createMainWindow';
import { createTerminalProcess } from '../processes/createPiAgentProcess';
import { PiChannel, type TerminalUtilityCommand } from '../../shared/ipcContract';

/** One utility process per working directory (keyed by cwd). */
const terminalProcesses = new Map<string, Electron.UtilityProcess>();

function sendToRenderer(channel: PiChannel, data: unknown): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

/**
 * Ensure the terminal process for `cwd` exists, then hand a fresh data
 * MessagePort to both the utility process and the renderer. Re-invoking with an
 * existing cwd simply re-delivers a port (covers renderer reloads).
 */
function startTerminal(cwd: string, cols: number, rows: number): { success: boolean } {
  let proc = terminalProcesses.get(cwd);
  if (!proc) {
    proc = createTerminalProcess();
    terminalProcesses.set(cwd, proc);

    const spawned = proc;
    proc.on('exit', () => {
      if (terminalProcesses.get(cwd) === spawned) {
        terminalProcesses.delete(cwd);
        sendToRenderer(PiChannel.TerminalExit, { cwd });
      }
    });

    const startCommand: TerminalUtilityCommand = { type: 'start_terminal', cwd, cols, rows };
    proc.postMessage(startCommand);
  }

  const channel = new MessageChannelMain();
  const attachCommand: TerminalUtilityCommand = { type: 'attach_terminal_port' };
  proc.postMessage(attachCommand, [channel.port1]);

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.postMessage(PiChannel.TerminalPort, { cwd }, [channel.port2]);
  }

  return { success: true };
}

/** Kill the terminal process for a single cwd (renderer LRU eviction). */
function stopTerminal(cwd: string): void {
  const proc = terminalProcesses.get(cwd);
  if (proc) {
    terminalProcesses.delete(cwd);
    proc.kill();
  }
}

/** Kill every terminal process (app shutdown). */
export function stopTerminalProcess(): void {
  for (const proc of terminalProcesses.values()) {
    proc.kill();
  }
  terminalProcesses.clear();
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(PiChannel.TerminalStart, (_event, cwd: string, cols: number, rows: number) => {
    if (typeof cwd !== 'string') {
      return { success: false };
    }
    return startTerminal(cwd, Number(cols) || 80, Number(rows) || 24);
  });

  ipcMain.handle(PiChannel.TerminalStop, (_event, cwd: string) => {
    if (typeof cwd === 'string') {
      stopTerminal(cwd);
    }
    return { success: true };
  });
}
