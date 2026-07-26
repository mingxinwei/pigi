/**
 * Terminal controller - owns the xterm.js instances for the app lifetime,
 * decoupled from React's component lifecycle.
 *
 * Terminals are organized in two levels:
 *   - Project groups, keyed by the project's working directory. The panel shows
 *     the group for the active project and auto-follows project switches; other
 *     groups stay alive in the background. An LRU keeps the PROJECT_LRU_MAX most
 *     recent groups (opening a further project evicts and kills the oldest), and
 *     an idle group is killed after GROUP_TTL_MS with no I/O.
 *   - Tabs within a group. Each tab is an independent shell; "+" opens a new one
 *     in the project's cwd, and closing the last tab hides the panel.
 *
 * Because the xterm instances and their PTY wiring live here (not in a
 * component), they survive React remounts (StrictMode, HMR) and panel show/hide
 * without losing scrollback or the shell process. The controller is the single
 * source of truth; it mirrors the active group's tab strip into the app store
 * (via setTerminalTabs) so React can render it.
 */
import { Terminal } from '@xterm/xterm';
import { FitAddon } from '@xterm/addon-fit';
import { WebglAddon } from '@xterm/addon-webgl';
import { WebLinksAddon } from '@xterm/addon-web-links';
import '@xterm/xterm/css/xterm.css';
import './terminalTheme.css';
import { useAppStore, type TerminalTabView } from '../state/appStore';

const FONT_FAMILY = "ui-monospace, SFMono-Regular, Menlo, Monaco, 'Courier New', monospace";
const FONT_SIZE = 15;
/** Max number of project groups kept alive; opening a further project evicts the LRU. */
const PROJECT_LRU_MAX = 5;
/** A cached (off-screen) group is killed after this long with no terminal I/O. */
const GROUP_TTL_MS = 60 * 60 * 1000;

let tabIdCounter = 0;
function nextTabId(): string {
  tabIdCounter += 1;
  return `term-${tabIdCounter}`;
}

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

/** Basename of a directory path, used as a fallback tab title. */
function directoryName(path: string): string {
  const base = path.replace(/\/+$/, '').split('/').pop();
  return base && base.length > 0 ? base : 'Terminal';
}

/** One terminal tab: an independent shell inside a project group. */
interface TerminalTab {
  id: string;
  /** Project group this tab belongs to (also the shell's working directory). */
  groupKey: string;
  cwd: string;
  terminal: Terminal;
  fitAddon: FitAddon;
  /** Persistent element xterm renders into; re-parented into the React container. */
  host: HTMLDivElement;
  started: boolean;
  /** Latest OSC title reported by the shell (empty until it sets one). */
  title: string;
  /** Removes the preload data/exit subscriptions for this tab. */
  disposeData: () => void;
}

/** A set of tabs bound to one project, cached while the project is inactive. */
interface ProjectGroup {
  key: string;
  tabs: TerminalTab[];
  activeTabId: string | null;
  /**
   * Idle-eviction timer. Armed (and reset on I/O) only while the group is NOT
   * the one currently shown; when it fires, the whole group is killed. The
   * shown group is exempt and has no timer.
   */
  ttlTimer: ReturnType<typeof setTimeout> | null;
}

class TerminalController {
  /** project key -> group. */
  private readonly groups = new Map<string, ProjectGroup>();
  /** project keys ordered least- to most-recently-used (last = MRU). */
  private recency: string[] = [];
  /** project key of the group currently shown in the panel container. */
  private activeProjectKey: string | null = null;
  /** The React panel container the active tab is parented into. */
  private container: HTMLElement | null = null;

  private get activeGroup(): ProjectGroup | null {
    return this.activeProjectKey ? (this.groups.get(this.activeProjectKey) ?? null) : null;
  }

  private get activeTab(): TerminalTab | null {
    const group = this.activeGroup;
    if (!group || !group.activeTabId) return null;
    return group.tabs.find((tab) => tab.id === group.activeTabId) ?? null;
  }

  private createTab(group: ProjectGroup): TerminalTab {
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

    const id = nextTabId();
    const tab: TerminalTab = {
      id,
      groupKey: group.key,
      cwd: group.key,
      terminal,
      fitAddon,
      host,
      started: false,
      title: '',
      disposeData: () => {},
    };

    // Command shortcuts (which xterm never forwards to the shell) plus Option+
    // Arrow word motion (arrows go through the cursor-key path, so macOptionIsMeta
    // doesn't turn them into word motion). Everything else falls through so app
    // shortcuts (Cmd+J, Cmd+[/]) and copy/paste keep working.
    terminal.attachCustomKeyEventHandler((event) => this.handleMacKeyBindings(id, event));

    terminal.onData((data) => {
      window.piApi.terminal.write(id, data);
      this.markActivity(tab.groupKey);
    });
    terminal.onTitleChange((title) => {
      tab.title = title;
      if (tab.groupKey === this.activeProjectKey) this.syncActiveGroupToStore();
    });
    const offData = window.piApi.terminal.onData(id, (data) => {
      terminal.write(data);
      this.markActivity(tab.groupKey);
    });
    const offExit = window.piApi.terminal.onExit(id, (exitCode) => {
      const suffix = exitCode != null ? ` (${exitCode})` : '';
      terminal.write(`\r\n\x1b[2m[process exited${suffix}]\x1b[0m\r\n`);
      // Allow the shell to be respawned the next time this tab is shown.
      tab.started = false;
    });
    tab.disposeData = () => {
      offData();
      offExit();
    };

    return tab;
  }

  /** Dispose a single tab: detach its DOM, free xterm, and kill its shell. */
  private disposeTab(tab: TerminalTab): void {
    tab.disposeData();
    tab.host.parentElement?.removeChild(tab.host);
    tab.terminal.dispose();
    void window.piApi.terminal.stop(tab.id);
  }

  /** Dispose an entire project group (kills every shell in it). */
  private disposeGroup(key: string): void {
    const group = this.groups.get(key);
    if (!group) return;
    this.clearGroupTtl(group);
    for (const tab of group.tabs) this.disposeTab(tab);
    this.groups.delete(key);
    this.recency = this.recency.filter((k) => k !== key);
    if (this.activeProjectKey === key) {
      this.activeProjectKey = null;
      this.syncActiveGroupToStore();
    }
  }

  /** Reset a group's idle timer on I/O (no-op for the shown group, which is exempt). */
  private markActivity(key: string): void {
    const group = this.groups.get(key);
    if (group) this.armGroupTtl(group);
  }

  /**
   * (Re)arm the idle-eviction timer for a group. Clears any existing timer first,
   * then schedules disposal in GROUP_TTL_MS — unless the group is the one being
   * shown, which is exempt and left without a timer.
   */
  private armGroupTtl(group: ProjectGroup): void {
    this.clearGroupTtl(group);
    if (group.key === this.activeProjectKey) return;
    group.ttlTimer = setTimeout(() => {
      group.ttlTimer = null;
      this.disposeGroup(group.key);
    }, GROUP_TTL_MS);
  }

  private clearGroupTtl(group: ProjectGroup): void {
    if (group.ttlTimer) {
      clearTimeout(group.ttlTimer);
      group.ttlTimer = null;
    }
  }

  /** Detach every host of the active group except the active tab, and attach that one. */
  private attachActiveTab(): void {
    const group = this.activeGroup;
    if (!group || !this.container) return;
    const active = this.activeTab;
    for (const tab of group.tabs) {
      if (tab !== active && tab.host.parentElement === this.container) {
        this.container.removeChild(tab.host);
      }
    }
    if (active && active.host.parentElement !== this.container) {
      this.container.appendChild(active.host);
    }
  }

  /** Start the active tab's shell if it isn't running yet. */
  private ensureActiveStarted(): void {
    const tab = this.activeTab;
    if (!tab || tab.started) return;
    tab.started = true;
    this.fit();
    void window.piApi.terminal.start(tab.id, tab.cwd, tab.terminal.cols, tab.terminal.rows);
  }

  private syncActiveGroupToStore(): void {
    const group = this.activeGroup;
    const tabs: TerminalTabView[] = group
      ? group.tabs.map((tab) => ({ id: tab.id, title: tab.title.trim() || directoryName(tab.cwd) }))
      : [];
    useAppStore.getState().setTerminalTabs(tabs, group?.activeTabId ?? null);
  }

  private handleMacKeyBindings(id: string, event: KeyboardEvent): boolean {
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
        window.piApi.terminal.write(id, sequence);
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
        window.piApi.terminal.write(id, sequence);
        return false;
      }
    }

    return true;
  }

  // --- public API (called by TerminalPanel) ------------------------------

  /** Remember the container the active tab should be parented into. */
  mount(container: HTMLElement): void {
    this.container = container;
    this.attachActiveTab();
  }

  /**
   * Show the group for `projectKey`, auto-following project switches. Creates the
   * group (evicting the LRU project when at capacity) and its first tab on demand,
   * then starts the active tab's shell. Existing groups/tabs are left untouched.
   */
  activateProject(projectKey: string): void {
    let group = this.groups.get(projectKey);
    if (!group) {
      if (this.groups.size >= PROJECT_LRU_MAX) {
        const lru = this.recency[0];
        if (lru !== undefined) this.disposeGroup(lru);
      }
      group = { key: projectKey, tabs: [], activeTabId: null, ttlTimer: null };
      this.groups.set(projectKey, group);
    }

    if (this.activeProjectKey !== projectKey) {
      const previous = this.activeTab;
      if (previous && this.container && previous.host.parentElement === this.container) {
        this.container.removeChild(previous.host);
      }
      // The group we're leaving becomes idle-evictable; the one we enter is exempt.
      const previousGroup = this.activeProjectKey ? this.groups.get(this.activeProjectKey) : null;
      this.activeProjectKey = projectKey;
      if (previousGroup) this.armGroupTtl(previousGroup);
    }
    this.clearGroupTtl(group);

    if (group.tabs.length === 0) {
      const tab = this.createTab(group);
      group.tabs.push(tab);
      group.activeTabId = tab.id;
    }

    this.recency = this.recency.filter((k) => k !== projectKey);
    this.recency.push(projectKey);

    this.attachActiveTab();
    this.syncActiveGroupToStore();
    this.ensureActiveStarted();
  }

  /** Open a new tab in the active group (in the project's cwd) and switch to it. */
  openTab(): void {
    const group = this.activeGroup;
    if (!group) return;
    const previous = this.activeTab;
    if (previous && this.container && previous.host.parentElement === this.container) {
      this.container.removeChild(previous.host);
    }
    const tab = this.createTab(group);
    group.tabs.push(tab);
    group.activeTabId = tab.id;
    this.attachActiveTab();
    this.syncActiveGroupToStore();
    this.ensureActiveStarted();
    this.fit();
    this.focusSoon();
  }

  /** Switch the active tab within the current group. */
  activateTab(id: string): void {
    const group = this.activeGroup;
    if (!group || group.activeTabId === id) return;
    const previous = this.activeTab;
    if (previous && this.container && previous.host.parentElement === this.container) {
      this.container.removeChild(previous.host);
    }
    group.activeTabId = id;
    this.attachActiveTab();
    this.syncActiveGroupToStore();
    this.ensureActiveStarted();
    this.fit();
    this.focusSoon();
  }

  /** Close a tab. Closing the last tab of the active group hides the panel. */
  closeTab(id: string): void {
    const group = this.activeGroup;
    if (!group) return;
    const index = group.tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;
    const [removed] = group.tabs.splice(index, 1);
    if (removed) this.disposeTab(removed);
    const wasActive = group.activeTabId === id;

    if (group.tabs.length === 0) {
      this.groups.delete(group.key);
      this.recency = this.recency.filter((k) => k !== group.key);
      this.activeProjectKey = null;
      this.syncActiveGroupToStore();
      useAppStore.getState().setTerminalOpen(false);
      return;
    }

    if (wasActive) {
      const neighbor = group.tabs[Math.min(index, group.tabs.length - 1)];
      group.activeTabId = neighbor.id;
      this.attachActiveTab();
      this.ensureActiveStarted();
      this.fit();
      this.focusSoon();
    }
    this.syncActiveGroupToStore();
  }

  fit(): void {
    const tab = this.activeTab;
    if (!tab) return;
    tab.fitAddon.fit();
    window.piApi.terminal.resize(tab.id, tab.terminal.cols, tab.terminal.rows);
  }

  focus(): void {
    this.activeTab?.terminal.focus();
  }

  /**
   * Focus the active terminal on the next frame. Used after a tab click: the
   * Radix trigger (or the + button) grabs DOM focus during the click, so we
   * focus the terminal once that settles rather than fighting it synchronously.
   */
  private focusSoon(): void {
    requestAnimationFrame(() => this.focus());
  }

  /** Sync every cached terminal's colors to the current app theme. */
  applyTheme(): void {
    const theme = readTerminalTheme();
    for (const group of this.groups.values()) {
      for (const tab of group.tabs) tab.terminal.options.theme = theme;
    }
  }
}

export const terminalController = new TerminalController();
