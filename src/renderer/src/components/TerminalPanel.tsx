import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { TERMINAL_MIN_HEIGHT, TERMINAL_MAX_HEIGHT_RATIO } from '../lib/layoutConstants';
import { useAppStore } from '../state/appStore';
import { terminalController } from './terminalController';

// Coalesce rapid resize events (drag, window resize) into a single fit so we
// don't spam node-pty with resizes and cause the terminal to flicker.
const RESIZE_DEBOUNCE_MS = 80;

// Purpose-built drawer curve (fast start, clean settle) in both directions;
// open is slightly slower than close for enter/exit asymmetry. Kept identical
// to the chat-content slide in App so the two move as one.
const OPEN_TRANSITION = 'duration-[340ms] ease-[cubic-bezier(0.32,0.72,0,1)]';
const CLOSE_TRANSITION = 'duration-[240ms] ease-[cubic-bezier(0.32,0.72,0,1)]';

interface TerminalPanelProps {
  /** Working directory the shell starts in (captured on first start). */
  cwd: string;
  /** Whether the panel is currently shown. Kept mounted when hidden so the PTY persists. */
  visible: boolean;
  /** Request to close the panel (X button). */
  onClose: () => void;
}

/**
 * Bottom terminal panel. Hosts the app-global xterm instance owned by
 * `terminalController`; this component only positions its DOM node and forwards
 * fit/focus/theme signals. Stays mounted while hidden so the shell persists.
 *
 * It is an absolute overlay (never a flex child), so opening it never reflows
 * the message list. The panel slides in via a GPU `transform`, and the chat
 * content above slides up by the same height in sync (see App.tsx).
 */
export default function TerminalPanel({
  cwd,
  visible,
  onClose,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cwdRef = useRef(cwd);
  const height = useAppStore((s) => s.terminalHeight);
  const setTerminalHeight = useAppStore((s) => s.setTerminalHeight);
  const dragging = useAppStore((s) => s.terminalDragging);
  const setTerminalDragging = useAppStore((s) => s.setTerminalDragging);

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

  // Start (or restart) the shell when the panel becomes visible.
  useEffect(() => {
    if (!visible) return;
    const frame = requestAnimationFrame(() => {
      terminalController.ensureStarted(cwdRef.current);
      terminalController.fit();
      terminalController.focus();
    });
    return () => cancelAnimationFrame(frame);
  }, [visible]);

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
      <div className="flex shrink-0 items-center justify-end px-3 h-7">
        <button
          type="button"
          title="Close terminal"
          onClick={onClose}
          className="flex items-center justify-center rounded p-0.5 text-muted-foreground hover:text-foreground hover:bg-muted transition-colors"
        >
          <IconX size={14} stroke={1.5} />
        </button>
      </div>
      <div ref={containerRef} className="min-h-0 flex-1 px-2 pb-1 text-foreground" />
    </div>
  );
}
