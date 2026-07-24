import { useCallback, useEffect, useRef, useState } from 'react';
import { IconX } from '@tabler/icons-react';
import { cn } from '../lib/utils';
import { terminalController } from './terminalController';

const DEFAULT_HEIGHT = 280;
const MIN_HEIGHT = 120;
const MAX_HEIGHT_RATIO = 0.8;
// Coalesce rapid resize events (drag, window resize) into a single fit so we
// don't spam node-pty with resizes and cause the terminal to flicker.
const RESIZE_DEBOUNCE_MS = 80;

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
 */
export default function TerminalPanel({
  cwd,
  visible,
  onClose,
}: TerminalPanelProps): React.JSX.Element {
  const containerRef = useRef<HTMLDivElement>(null);
  const cwdRef = useRef(cwd);
  const [height, setHeight] = useState(DEFAULT_HEIGHT);
  // GPU-only open/close animation, decoupled into two pieces:
  //  - `reserved` sets the outer wrapper's layout height in a SINGLE pass, so
  //    the message list / input reflow exactly once (never per frame).
  //  - the inner block animates only `transform: translateY`, which the
  //    compositor slides without any layout or paint of the transcript above.
  // Open  = reserve height (this render), then slide the panel up into it.
  // Close = slide the panel down, then release the reserved height once done.
  const [reserved, setReserved] = useState(false);
  const [activated, setActivated] = useState(false);

  // Activate one frame after mount so the very first open animates (a CSS
  // transition only runs on a change, not on the initial mount).
  useEffect(() => {
    const frame = requestAnimationFrame(() => setActivated(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Reserve the layout height the moment the panel becomes visible (one reflow)
  // and keep it reserved through the close slide-out (released in
  // onTransitionEnd). Render-phase sync with the prop is React's sanctioned way
  // to derive state from props without an effect.
  if (visible && !reserved) {
    setReserved(true);
  }

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

  // Start (or restart) the shell when the panel becomes visible. The inner block
  // keeps a fixed height throughout the slide, so the terminal is already sized
  // correctly and needs no fit tied to the animation.
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
      const maxHeight = window.innerHeight * MAX_HEIGHT_RATIO;

      const handlePointerMove = (moveEvent: PointerEvent): void => {
        const next = startHeight + (startY - moveEvent.clientY);
        setHeight(Math.min(Math.max(next, MIN_HEIGHT), maxHeight));
      };
      const handlePointerUp = (): void => {
        window.removeEventListener('pointermove', handlePointerMove);
        window.removeEventListener('pointerup', handlePointerUp);
      };
      window.addEventListener('pointermove', handlePointerMove);
      window.addEventListener('pointerup', handlePointerUp);
    },
    [height],
  );

  return (
    // Outer wrapper reserves the layout height in one pass (no height transition),
    // then clips the inner block as it slides. It never re-layouts per frame.
    <div
      className="relative shrink-0 overflow-hidden border-t-[0.5px] border-foreground/27 bg-background"
      style={{ height: reserved ? height : 0 }}
      aria-hidden={!visible}
    >
      {/* Inner block keeps a fixed height and animates only `transform`, so the
          compositor slides it up/down without laying out the transcript above. */}
      <div
        className={cn(
          'absolute inset-x-0 bottom-0 flex flex-col will-change-transform',
          'transition-transform motion-reduce:transition-none motion-reduce:duration-0',
          // Open with easeOutExpo (lively, no overshoot so it settles clean); close snappy.
          slidIn
            ? 'duration-[420ms] ease-[cubic-bezier(0.16,1,0.3,1)]'
            : 'duration-[240ms] ease-[cubic-bezier(0.4,0,1,1)]',
        )}
        style={{ height, transform: slidIn ? 'translateY(0)' : 'translateY(100%)' }}
        onTransitionEnd={(event) => {
          if (event.propertyName !== 'transform') return;
          if (slidIn) terminalController.focus();
          else setReserved(false);
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
    </div>
  );
}
