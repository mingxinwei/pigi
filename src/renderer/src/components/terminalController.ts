/**
 * Terminal controller - owns the single xterm.js instance for the app lifetime,
 * decoupled from React's component lifecycle.
 *
 * The React panel only positions the terminal's DOM node (via `mount`) and asks
 * the controller to fit/focus. Because the xterm instance and its PTY wiring
 * live here (not in a component), they survive React remounts (StrictMode, HMR)
 * and panel show/hide without losing scrollback or the shell process.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './terminalTheme.css';

const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace";
const FONT_SIZE = 15;

type TerminalTheme = NonNullable<ConstructorParameters<typeof Terminal>[0]>['theme'];

/**
 * Normalize any CSS color (hex, rgb, oklch, ...) to a concrete `rgb(...)` string.
 * xterm's canvas renderers only parse hex/rgb, and the app tokens use `oklch()`,
 * so we round-trip the color through a 1x1 canvas and read back sRGB bytes.
 */
function cssColorToRgb(color: string): string {
  const canvas = document.createElement('canvas');
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext('2d');
  if (!ctx) return color;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, 1, 1);
  const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
  return `rgb(${r}, ${g}, ${b})`;
}

/**
 * Read the terminal theme from the app's CSS custom properties (see main.css).
 * The palette lives entirely in CSS (per light/dark), so reskinning the terminal
 * is a CSS-only change; `background` tracks --background so the panel blends in.
 */
function readTerminalTheme(): TerminalTheme {
  const styles = getComputedStyle(document.documentElement);
  const color = (name: string): string => cssColorToRgb(styles.getPropertyValue(name).trim());
  return {
    background: color('--background'),
    foreground: color('--terminal-foreground'),
    cursor: color('--terminal-cursor'),
    black: color('--terminal-black'),
    red: color('--terminal-red'),
    green: color('--terminal-green'),
    yellow: color('--terminal-yellow'),
    blue: color('--terminal-blue'),
    magenta: color('--terminal-magenta'),
    cyan: color('--terminal-cyan'),
    white: color('--terminal-white'),
    brightBlack: color('--terminal-bright-black'),
    brightRed: color('--terminal-bright-red'),
    brightGreen: color('--terminal-bright-green'),
    brightYellow: color('--terminal-bright-yellow'),
    brightBlue: color('--terminal-bright-blue'),
    brightMagenta: color('--terminal-bright-magenta'),
    brightCyan: color('--terminal-bright-cyan'),
    brightWhite: color('--terminal-bright-white'),
  };
}

class TerminalController {
  private terminal: Terminal | null = null;
  private fitAddon: FitAddon | null = null;
  /** Persistent element xterm renders into; re-parented into the React container. */
  private host: HTMLDivElement | null = null;
  private started = false;

  private ensure(): void {
    if (this.terminal) return;

    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';

    const terminal = new Terminal({
      cursorBlink: true,
      fontSize: FONT_SIZE,
      fontFamily: FONT_FAMILY,
      allowProposedApi: true,
      theme: readTerminalTheme(),
    });
    const fitAddon = new FitAddon();
    terminal.loadAddon(fitAddon);
    terminal.loadAddon(new WebLinksAddon((_event, uri) => window.piApi.openExternal(uri)));
    terminal.open(host);
    try {
      terminal.loadAddon(new WebglAddon());
    } catch {
      // WebGL unavailable — xterm falls back to the DOM renderer automatically.
    }

    terminal.onData((data) => window.piApi.terminal.write(data));
    window.piApi.terminal.onData((data) => terminal.write(data));
    window.piApi.terminal.onExit((exitCode) => {
      const suffix = exitCode != null ? ` (${exitCode})` : '';
      terminal.write(`\r\n\x1b[2m[process exited${suffix}]\x1b[0m\r\n`);
      // Allow the shell to be respawned the next time the panel is shown.
      this.started = false;
    });

    this.terminal = terminal;
    this.fitAddon = fitAddon;
    this.host = host;
  }

  /** Place the terminal's DOM node inside the given container. */
  mount(container: HTMLElement): void {
    this.ensure();
    if (this.host && this.host.parentElement !== container) {
      container.appendChild(this.host);
    }
  }

  /** Start (or restart, after an exit) the shell in the given working directory. */
  ensureStarted(cwd: string): void {
    this.ensure();
    if (this.started) return;
    this.started = true;
    const terminal = this.terminal;
    if (!terminal) return;
    this.fit();
    void window.piApi.terminal.start(cwd, terminal.cols, terminal.rows);
  }

  fit(): void {
    const terminal = this.terminal;
    const fitAddon = this.fitAddon;
    if (!terminal || !fitAddon) return;
    fitAddon.fit();
    window.piApi.terminal.resize(terminal.cols, terminal.rows);
  }

  focus(): void {
    this.terminal?.focus();
  }

  /** Sync the terminal colors to the current app theme (reads CSS variables). */
  applyTheme(): void {
    if (this.terminal) {
      this.terminal.options.theme = readTerminalTheme();
    }
  }
}

export const terminalController = new TerminalController();
