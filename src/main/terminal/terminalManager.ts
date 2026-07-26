/**
 * Terminal manager - main-process lifecycle for the bottom-panel PTYs.
 *
 * Mirrors the session architecture: main spawns a terminal utility process per
 * terminal tab, performs the port handshake, and then stays out of the data
 * path. High-volume PTY I/O flows over the delivered MessagePort.
 *
 * Each terminal is keyed by a unique id (the renderer allocates it); the shell's
 * working directory is a separate argument so multiple tabs can share a cwd. The
 * renderer groups tabs by project and evicts (stops) the ones it no longer needs
 * (tab close, project LRU, idle TTL), so the process map here stays bounded.
 */
import { ipcMain, MessageChannelMain } from 'electron';
import { getMainWindow } from '../windows/createMainWindow';
import { createTerminalProcess } from '../processes/createPiAgentProcess';
import { PiChannel, type TerminalUtilityCommand } from '../../shared/ipcContract';

/** One utility process per terminal tab (keyed by its unique id). */
const terminalProcesses = new Map<string, Electron.UtilityProcess>();

function sendToRenderer(channel: PiChannel, data: unknown): void {
  const win = getMainWindow();
  if (win && !win.isDestroyed()) {
    win.webContents.send(channel, data);
  }
}

/**
 * Ensure the terminal process for `id` exists (spawning its shell in `cwd`),
 * then hand a fresh data MessagePort to both the utility process and the
 * renderer. Re-invoking with an existing id simply re-delivers a port (covers
 * renderer reloads).
 */
function startTerminal(id: string, cwd: string, cols: number, rows: number): { success: boolean } {
  let proc = terminalProcesses.get(id);
  if (!proc) {
    proc = createTerminalProcess();
    terminalProcesses.set(id, proc);

    const spawned = proc;
    proc.on('exit', () => {
      if (terminalProcesses.get(id) === spawned) {
        terminalProcesses.delete(id);
        sendToRenderer(PiChannel.TerminalExit, { id });
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
    win.webContents.postMessage(PiChannel.TerminalPort, { id }, [channel.port2]);
  }

  return { success: true };
}

/** Kill the terminal process for a single id (tab close / LRU / TTL eviction). */
function stopTerminal(id: string): void {
  const proc = terminalProcesses.get(id);
  if (proc) {
    terminalProcesses.delete(id);
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
  ipcMain.handle(
    PiChannel.TerminalStart,
    (_event, id: string, cwd: string, cols: number, rows: number) => {
      if (typeof id !== 'string' || typeof cwd !== 'string') {
        return { success: false };
      }
      return startTerminal(id, cwd, Number(cols) || 80, Number(rows) || 24);
    },
  );

  ipcMain.handle(PiChannel.TerminalStop, (_event, id: string) => {
    if (typeof id === 'string') {
      stopTerminal(id);
    }
    return { success: true };
  });
}
