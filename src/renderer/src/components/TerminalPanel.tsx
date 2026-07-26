import { useCallback, useEffect, useRef, useState } from 'react';
import { IconPlus, IconTerminal2, IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT_RATIO } from '../lib/layoutConstants';
import { useAppStore } from '../state/appStore';
import { terminalController } from './terminalController';
import { Tabs, TabsList, TabsTrigger } from './ui/tabs';

// Coalesce rapid resize events (drag, window resize) into a single fit so we
// don't spam node-pty with resizes and cause the terminal to flicker.
const RESIZE_DEBOUNCE_MS = 80;

// Purpose-built drawer curve (fast start, clean settle) in both directions;
// open is slightly slower than close for enter/exit asymmetry. Kept identical
// to the chat-content slide in App so the two move as one.
const OPEN_TRANSITION = 'duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)]';
const CLOSE_TRANSITION = 'duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]';

interface TerminalPanelProps {
  /** The active project's working directory: group key for its tabs and the cwd new tabs open in. */
  projectCwd: string;
  /** Whether the panel is currently shown. Kept mounted when hidden so shells persist. */
  visible: boolean;
  /** Request to close (hide) the panel (X button). */
  onClose: () => void;
}

/**
 * Bottom terminal panel. Hosts the app-global xterm instances owned by
 * `terminalController`; this component renders the tab strip and positions the
 * active terminal's DOM node, forwarding fit/focus/theme signals. Stays mounted
 * while hidden so shells persist.
 *
 * It is an absolute overlay (never a flex child), so opening it never reflows
 * the message list. The panel slides in via a GPU `transform`, and the chat
 * content above slides up by the same height in sync (see App.tsx).
 */
export default function TerminalPanel({
  projectCwd,
  visible,
  onClose,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const height = useAppStore((s) => s.terminalHeight);
  const setTerminalHeight = useAppStore((s) => s.setTerminalHeight);
  const dragging = useAppStore((s) => s.terminalDragging);
  const setTerminalDragging = useAppStore((s) => s.setTerminalDragging);
  const tabs = useAppStore((s) => s.terminalTabs);
  const activeTabId = useAppStore((s) => s.activeTerminalTabId);

  // Activate one frame after mount so the very first open animates (a CSS
  // transition only runs on a change, not on the initial mount).
  const [activated, setActivated] = useState(false);
  useEffect(() => {
    const frame = requestAnimationFrame(() => setActivated(true));
    return () => cancelAnimationFrame(frame);
  }, []);
  const slidIn = visible && activated;

  // Position the shared terminal in this container and keep its theme in sync.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    terminalController.mount(container);
    terminalController.applyTheme();

    const themeObserver = new MutationObserver(() => {
      terminalController.applyTheme();
    });
    themeObserver.observe(document.documentElement, {
      attributes: true,
      attributeFilter: ['class'],
    });
    return () => themeObserver.disconnect();
  }, []);

  // Show the active project's terminal group whenever the panel becomes visible
  // or the project changes. The controller keeps a per-project cache, so
  // switching back to a project restores its tabs exactly.
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      terminalController.activateProject(projectCwd);
      terminalController.fit();
      terminalController.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible, projectCwd]);

  // Refit on container size changes (height drag, window resize), debounced so
  // a burst of resize events results in a single fit / PTY resize.
  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const observer = new ResizeObserver(() => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        if (visible) terminalController.fit();
      }, RESIZE_DEBOUNCE_MS);
    });
    observer.observe(container);
    return () => {
      observer.disconnect();
      clearTimeout(timer);
    };
  }, [visible]);

  const handleResizeStart = useCallback(
    (event: React.PointerEvent) => {
      event.preventDefault();
      const startY = event.clientY;
      const startHeight = height;
      const maxHeight = window.innerHeight * TERMINAL_MAX_HEIGHT_RATIO;

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const next = startHeight + (startY - moveEvent.clientY);
        setTerminalHeight(Math.min(Math.max(next, TERMINAL_MIN_HEIGHT), maxHeight));
      };
      const handlePointerUp = (): void => {
        setTerminalDragging(false);
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
      setTerminalDragging(true);
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [height, setTerminalHeight, setTerminalDragging],
  );

  return (
    // Absolute overlay pinned to the bottom of the main area. Only `transform`
    // animates, so the compositor slides it without any layout of the transcript.
    <div
      className={cn(
        'absolute inset-x-0 bottom-0 z-10 flex flex-col border-t-[0.5px] border-foreground/27 bg-background will-change-transform',
        dragging
          ? 'transition-none'
          : cn(
              'transition-transform motion-reduce:transition-none',
              slidIn ? OPEN_TRANSITION : CLOSE_TRANSITION,
            ),
      )}
      style={{ height, transform: slidIn ? 'translateY(0)' : 'translateY(100%)' }}
      aria-hidden={!visible}
      onTransitionEnd={(event) => {
        if (event.propertyName === 'transform' && slidIn) terminalController.focus();
      }}
    >
      <div
        role="separator"
        aria-orientation="horizontal"
        aria-label="Resize terminal"
        className="absolute inset-x-0 top-0 z-10 h-2 cursor-row-resize"
        onPointerDown={handleResizeStart}
      />
      <div className="flex shrink-0 items-center gap-1 h-10 px-2">
        {/* Tabs and the new-tab button share one scrollable row so "+" always sits
            right after the last tab; the close-panel X stays pinned at the far right. */}
        <div className="flex min-w-0 flex-1 items-center gap-1 overflow-x-auto">
          <Tabs
            value={activeTabId ?? ''}
            onValueChange={(id) => terminalController.activateTab(id)}
            className="flex-none gap-0"
          >
            <TabsList variant="line" className="h-full gap-1 bg-transparent p-0">
              {tabs.map((tab) => (
                <TabsTrigger
                  key={tab.id}
                  value={tab.id}
                  title={tab.title}
                  className="group/tab relative h-7 max-w-40 flex-none gap-1.5 rounded-lg px-2.5 text-xs font-normal text-muted-foreground after:hidden data-[state=active]:bg-muted data-[state=active]:text-foreground"
                >
                  <IconTerminal2 size={13} stroke={1.5} className="shrink-0 opacity-70" />
                  <span className="truncate">{tab.title}</span>
                  <span
                    role="button"
                    aria-label="Close tab"
                    tabIndex={-1}
                    onPointerDown={(event) => {
                      event.stopPropagation();
                      event.preventDefault();
                    }}
                    onClick={(event) => {
                      event.stopPropagation();
                      terminalController.closeTab(tab.id);
                    }}
                    className="-mr-1 ml-0.5 flex size-3.5 shrink-0 items-center justify-center rounded opacity-0 transition-opacity hover:bg-foreground/10 group-hover/tab:opacity-100 group-data-[state=active]/tab:opacity-100"
                  >
                    <IconX size={7} stroke={2} />
                  </span>
                </TabsTrigger>
              ))}
            </TabsList>
          </Tabs>
          <button
            type="button"
            title="New terminal tab"
            onClick={() => terminalController.openTab()}
            className="flex flex-none items-center justify-center rounded-md p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
          >
            <IconPlus size={18} stroke={1.75} />
          </button>
        </div>
        <button
          type="button"
          title="Close terminal"
          onClick={onClose}
          className="flex shrink-0 items-center justify-center rounded p-1 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <IconX size={14} stroke={1.5} />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 px-2 pb-1 text-foreground" />
    </div>
  );
}
