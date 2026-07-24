/**
 * Terminal controller - owns the xterm.js instances for the app lifetime,
 * decoupled from React's component lifecycle.
 *
 * There is one terminal per working directory, cached as an LRU of the 5 most
 * recent (see MAX_TERMINALS). The React panel positions whichever terminal is
 * active (via `mount`/`ensureStarted`) and asks the controller to fit/focus.
 * Because the xterm instances and their PTY wiring live here (not in a
 * component), they survive React remounts (StrictMode, HMR) and panel show/hide
 * without losing scrollback or the shell process. Switching back to a cached
 * cwd restores that terminal exactly; the least-recently-used one is evicted
 * (its shell killed) when a 6th distinct cwd is opened.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './terminalTheme.css';

const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace";
const FONT_SIZE = 15;
/** Number of most-recently-used terminals kept alive (per working directory). */
const MAX_TERMINALS = 5;

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

/** One cached terminal, bound to a working directory. */
interface TerminalInstance {
  cwd: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Persistent element xterm renders into; re-parented into the React container. */
  host: HTMLDivElement;
  started: boolean;
  /** Removes the preload data/exit subscriptions for this cwd. */
  disposeData: () => void;
}

class TerminalController {
  /** cwd -> terminal instance. */
  private readonly instances = new Map<string, TerminalInstance>();
  /** cwd list ordered least- to most-recently-used (last = MRU). */
  private recency: string[] = [];
  /** cwd of the terminal currently shown in the panel container. */
  private activeCwd: string | null = null;
  /** The React panel container the active terminal is parented into. */
  private container: HTMLElement | null = null;

  private get active(): TerminalInstance | null {
    return this.activeCwd ? (this.instances.get(this.activeCwd) ?? null) : null;
  }

  private createInstance(cwd: string): TerminalInstance {
    const host = document.createElement('div');
    host.style.width = '100%';
    host.style.height = '100%';

    const terminal = new Terminal({
      cursorBlink: true,
      // Thin vertical beam instead of the default solid block.
      cursorStyle: 'bar',
      // Treat Option as the Meta key so every Option shortcut emits the
      // ESC-prefixed sequence shells expect (M-b, M-d, M-f, M-Backspace, ...).
      // Trade-off: Option can no longer type accented characters in the terminal.
      macOptionIsMeta: true,
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

    const instance: TerminalInstance = {
      cwd,
      terminal,
      fitAddon,
      host,
      started: false,
      disposeData: () => {},
    };

    // Command shortcuts (which xterm never forwards to the shell) plus Option+
    // Arrow word motion (arrows go through the cursor-key path, so macOptionIsMeta
    // doesn't turn them into word motion). All other Option keys are handled by
    // macOptionIsMeta above; everything else falls through (return true) so app
    // shortcuts (Cmd+J, Cmd+[/]) and copy/paste keep working.
    terminal.attachCustomKeyEventHandler((event) => this.handleMacKeyBindings(cwd, event));

    terminal.onData((data) => window.piApi.terminal.write(cwd, data));
    const offData = window.piApi.terminal.onData(cwd, (data) => terminal.write(data));
    const offExit = window.piApi.terminal.onExit(cwd, (exitCode) => {
      const suffix = exitCode != null ? ` (${exitCode})` : '';
      terminal.write(`\r\n\x1b[2m[process exited${suffix}]\x1b[0m\r\n`);
      // Allow the shell to be respawned the next time this cwd is activated.
      instance.started = false;
    });
    instance.disposeData = () => {
      offData();
      offExit();
    };

    return instance;
  }

  /** Dispose a cached terminal: detach its DOM, free xterm, and kill its shell. */
  private disposeInstance(cwd: string): void {
    const instance = this.instances.get(cwd);
    if (!instance) return;
    instance.disposeData();
    instance.host.parentElement?.removeChild(instance.host);
    instance.terminal.dispose();
    this.instances.delete(cwd);
    this.recency = this.recency.filter((c) => c !== cwd);
    if (this.activeCwd === cwd) this.activeCwd = null;
    void window.piApi.terminal.stop(cwd);
  }

  /**
   * Make `cwd`'s terminal the active one, creating it (and evicting the LRU when
   * at capacity) if needed, and parent its DOM node into the container.
   */
  private activate(cwd: string): void {
    let instance = this.instances.get(cwd);
    if (!instance) {
      if (this.instances.size >= MAX_TERMINALS) {
        const lruCwd = this.recency[0];
        if (lruCwd !== undefined) this.disposeInstance(lruCwd);
      }
      instance = this.createInstance(cwd);
      this.instances.set(cwd, instance);
    }

    // Mark most-recently-used.
    this.recency = this.recency.filter((c) => c !== cwd);
    this.recency.push(cwd);

    if (this.activeCwd !== cwd) {
      const previous = this.active;
      if (previous && this.container && previous.host.parentElement === this.container) {
        this.container.removeChild(previous.host);
      }
      this.activeCwd = cwd;
    }
    if (this.container && instance.host.parentElement !== this.container) {
      this.container.appendChild(instance.host);
    }
  }

  /**
   * Translate macOS Cmd/Option line-editing keys into the control/escape
   * sequences a shell understands. Returns false when handled (xterm should not
   * also process the key), true otherwise so the event bubbles to app shortcuts.
   */
  private handleMacKeyBindings(cwd: string, event: KeyboardEvent): boolean {
    if (event.type !== 'keydown') return true;
    const { metaKey, altKey, ctrlKey, key } = event;

    // Command: jump/kill by line (Cmd is not sent to the shell by default).
    if (metaKey && !altKey && !ctrlKey) {
      const sequence =
        key === 'ArrowLeft'
          ? '\x01' // start of line (Ctrl+A)
          : key === 'ArrowRight'
            ? '\x05' // end of line (Ctrl+E)
            : key === 'Backspace'
              ? '\x15' // delete to line start (Ctrl+U)
              : null;
      if (sequence) {
        event.preventDefault();
        window.piApi.terminal.write(cwd, sequence);
        return false;
      }
      return true; // let Cmd+J, Cmd+[/], copy/paste, etc. through
    }

    // Option+Arrow: move by word (Option+Backspace and other Meta bindings are
    // covered by macOptionIsMeta, so they don't need an explicit mapping here).
    if (altKey && !metaKey && !ctrlKey) {
      const sequence =
        key === 'ArrowLeft'
          ? '\x1bb' // backward word (ESC b)
          : key === 'ArrowRight'
            ? '\x1bf' // forward word (ESC f)
            : null;
      if (sequence) {
        event.preventDefault();
        window.piApi.terminal.write(cwd, sequence);
        return false;
      }
    }

    return true;
  }

  /** Remember the container the active terminal should be parented into. */
  mount(container: HTMLElement): void {
    this.container = container;
    const active = this.active;
    if (active && active.host.parentElement !== container) {
      container.appendChild(active.host);
    }
  }

  /**
   * Show the terminal for `cwd` (creating/evicting as needed) and start its
   * shell if it isn't running yet.
   */
  ensureStarted(cwd: string): void {
    this.activate(cwd);
    const instance = this.instances.get(cwd);
    if (!instance || instance.started) return;
    instance.started = true;
    this.fit();
    void window.piApi.terminal.start(cwd, instance.terminal.cols, instance.terminal.rows);
  }

  fit(): void {
    const instance = this.active;
    if (!instance) return;
    instance.fitAddon.fit();
    window.piApi.terminal.resize(instance.cwd, instance.terminal.cols, instance.terminal.rows);
  }

  focus(): void {
    this.active?.terminal.focus();
  }

  /** Sync every cached terminal's colors to the current app theme. */
  applyTheme(): void {
    const theme = readTerminalTheme();
    for (const instance of this.instances.values()) {
      instance.terminal.options.theme = theme;
    }
  }
}

export const terminalController = new TerminalController();
