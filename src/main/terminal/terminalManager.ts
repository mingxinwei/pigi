/**
 * Terminal manager - main-process lifecycle for the single bottom-panel PTY.
 *
 * Mirrors the session architecture: main spawns the terminal utility process,
 * performs the port handshake, and then stays out of the data path. High-volume
 * PTY I/O flows over the delivered MessagePort.
 */
import { ipcMain, MessageChannelMain } from 'electron';
import { getMainWindow } from '../windows/createMainWindow';
import { createTerminalProcess } from '../processes/createPiAgentProcess';
import { PiChannel, type TerminalUtilityCommand } from '../../shared/ipcContract';

let terminalProcess: Electron.UtilityProcess | null = null;

function sendToRenderer(channel: PiChannel, data: unknown): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

/**
 * Ensure the terminal process exists, then hand a fresh data MessagePort to
 * both the utility process and the renderer.
 */
function startTerminal(cwd: string, cols: number, rows: number): { success: boolean } {
  if (!terminalProcess) {
    const proc = createTerminalProcess();
    terminalProcess = proc;

    proc.on('exit', () => {
      if (terminalProcess === proc) {
        terminalProcess = null;
        sendToRenderer(PiChannel.TerminalExit, {});
      }
    });

    const startCommand: TerminalUtilityCommand = { type: 'start_terminal', cwd, cols, rows };
    proc.postMessage(startCommand);
  }

  const channel = new MessageChannelMain();
  const attachCommand: TerminalUtilityCommand = { type: 'attach_terminal_port' };
  terminalProcess.postMessage(attachCommand, [channel.port1]);

  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.postMessage(PiChannel.TerminalPort, {}, [channel.port2]);
  }

  return { success: true };
}

export function stopTerminalProcess(): void {
  terminalProcess?.kill();
  terminalProcess = null;
}

export function registerTerminalHandlers(): void {
  ipcMain.handle(PiChannel.TerminalStart, (_event, cwd: string, cols: number, rows: number) => {
    if (typeof cwd !== 'string') {
      return { success: false };
    }
    return startTerminal(cwd, Number(cols) || 80, Number(rows) || 24);
  });
}
