/**
 * Terminal utility process - hosts a single node-pty and bridges it to the
 * renderer over a data MessagePort.
 *
 * Lifecycle (driven by main via parentPort):
 *   1. start_terminal: spawn the pty with the given cwd and initial size
 *   2. attach_terminal_port: wire the data MessagePort for I/O
 *
 * After the port is attached, all traffic (input/output/resize) flows over it;
 * main is not in the data path. When the pty exits, we notify the renderer over
 * the port and then exit the process so main can respawn a fresh one next time.
 */
import * as os from 'node:os';
import * as pty from 'node-pty';
import type {
  TerminalInboundMessage,
  TerminalOutboundMessage,
  TerminalUtilityCommand,
} from '../../shared/ipcContract';

/** Port interface compatible with Electron's MessagePortMain. */
interface Port {
  postMessage(message: unknown): void;
  start(): void;
  close(): void;
  on(event: 'message', listener: (messageEvent: { data: unknown }) => void): unknown;
}

let ptyProcess: pty.IPty | null = null;
let dataPort: Port | null = null;
/** Output produced before the port attaches (e.g. the initial shell prompt) is
 *  buffered here and flushed on attach so nothing is lost. */
let outboundQueue: TerminalOutboundMessage[] = [];

function resolveShell(): string {
  if (process.platform === 'win32') {
    return process.env.COMSPEC || 'powershell.exe';
  }
  return process.env.SHELL || '/bin/bash';
}

function send(message: TerminalOutboundMessage): void {
  if (dataPort) {
    dataPort.postMessage(message);
  } else {
    outboundQueue.push(message);
  }
}

function startTerminal(cwd: string, cols: number, rows: number): void {
  if (ptyProcess) return;

  ptyProcess = pty.spawn(resolveShell(), [], {
    name: 'xterm-256color',
    cols: Math.max(cols, 1),
    rows: Math.max(rows, 1),
    cwd: cwd || os.homedir(),
    env: process.env as Record<string, string>,
  });

  ptyProcess.onData((data) => send({ type: 'output', data }));

  ptyProcess.onExit(({ exitCode }) => {
    send({ type: 'exit', exitCode });
    ptyProcess = null;
    // Exit the process so main forgets us and spawns fresh on the next open.
    process.exit(0);
  });
}

function attachPort(port: Port): void {
  dataPort = port;

  port.on('message', (event) => {
    const message = event.data as TerminalInboundMessage;
    if (!ptyProcess) return;
    switch (message.type) {
      case 'input':
        ptyProcess.write(message.data);
        break;
      case 'resize':
        ptyProcess.resize(Math.max(message.cols, 1), Math.max(message.rows, 1));
        break;
    }
  });

  port.start();

  // Flush anything produced before the port was ready.
  for (const message of outboundQueue) port.postMessage(message);
  outboundQueue = [];
}

process.parentPort?.on('message', (messageEvent) => {
  const { data, ports } = messageEvent;
  const command = data as TerminalUtilityCommand;

  switch (command.type) {
    case 'start_terminal':
      startTerminal(command.cwd, command.cols, command.rows);
      break;
    case 'attach_terminal_port':
      if (ports.length > 0) {
        attachPort(ports[0]);
      }
      break;
  }
});
