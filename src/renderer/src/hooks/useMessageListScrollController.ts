import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { RefObject } from 'react';
import { useAppStore } from '../state/appStore';
import type { MinimalTurn } from '../lib/minimalTurns';

/**
 * Owns every scroll-position writer for the message list outside the
 * virtualizer itself: the minimal-mode turn pin state machine, per-session
 * scroll save/restore, and the view-mode switch re-derivation. In normal
 * (virtualized) mode the virtualizer itself owns bottom auto-follow via
 * anchorTo: 'end' — it glues the viewport to the streaming bottom
 * synchronously in its item ResizeObservers and preserves the reading
 * position otherwise — so this hook must not write scrollTop there except
 * for the one-shot cases below (session restore, new-turn jump,
 * scroll-to-bottom button, container viewport resize). MessageList consumes
 * the returned refs/handlers.
 */

import { MESSAGE_LIST_SCROLL_END_THRESHOLD } from '../lib/layoutConstants';

/** Minimal-mode pin state machine. */
type PinPhase =
  | { phase: 'idle' }
  | { phase: 'pinned'; turnId: string }
  | { phase: 'following'; turnId: string }
  | { phase: 'scrolled'; turnId: string }
  | { phase: 'ending'; turnId: string };

const SCROLL_BUTTON_VIEWPORT_MULTIPLIER = 2;

function isAtBottom(container: HTMLDivElement): boolean {
  return (
    container.scrollHeight - container.scrollTop - container.clientHeight <
    MESSAGE_LIST_SCROLL_END_THRESHOLD
  );
}

interface MessageListScrollControllerOptions {
  containerRef: RefObject<HTMLDivElement | null>;
  rowsWrapperRef: RefObject<HTMLDivElement | null>;
  sessionPath: string;
  isMinimal: boolean;
  lastMinimalTurn: MinimalTurn | null;
  isLastMinimalTurnActive: boolean;
}

export interface MessageListScrollController {
  topPaddingPx: number;
  showScrollButton: boolean;
  containerWidth: number;
  /** Disables bottom auto-follow (search jump, minimap jump, group toggle...). */
  suspendAutoScroll: () => void;
  handleScrollToBottom: () => void;
  handleMinimalTurnEnd: (turnId: string) => void;
  releaseAutoScrollPin: (isActive: boolean) => void;
  handleOutputGrowth: (sectionHeight: number) => void;
  handleCollapseChange: (isCollapsing: boolean) => void;
  handleCollapseDetails: (isActive: boolean) => void;
}

export function useMessageListScrollController({
  containerRef,
  rowsWrapperRef,
  sessionPath,
  isMinimal,
  lastMinimalTurn,
  isLastMinimalTurnActive,
}: MessageListScrollControllerOptions): MessageListScrollController {
  const autoScrollRef = useRef(true);
  // In-flight layout-restore animation (cancelled the moment the user
  // scrolls, so their position is never yanked back).
  const restoreAnimRef = useRef<{ cancel: () => void } | null>(null);

  // Minimal-mode pin state machine. A single ref encodes the phase of the
  // active turn's pin lifecycle; every transition happens in event handlers
  // or observers, never during render.
  const pinRef = useRef<PinPhase>({ phase: 'idle' });
  // The turn id that was pinned before details expanded — re-pin on collapse.
  const lastPinnedTurnIdRef = useRef<string | null>(null);
  const [showScrollButton, setShowScrollButton] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);

  // Viewport-height spacer below the active turn so it can reach the top.
  const [topPaddingPx, setTopPaddingPx] = useState(0);
  const topPaddingPxRef = useRef(0);
  useLayoutEffect(() => {
    topPaddingPxRef.current = topPaddingPx;
  }, [topPaddingPx]);

  // New active turn: pin it in minimal mode, or jump to the bottom. Resolve
  // the turn rather than checking only the latest transcript node: React may
  // batch the user message with agent_start or the first assistant delta, so
  // the user node is often no longer last by the time this layout effect runs.
  //
  // Tracked by the first time a turn is observed as ACTIVE — not by the turn
  // id alone. The user node can land before the session status flips to
  // streaming (the status arrives via a separate store update), so gating on
  // "turn id changed" misses turns whose status arrives one render late.
  // handledTurnIdRef records which turn we've already positioned; the effect
  // re-fires when the status catches up.
  const handledTurnIdRef = useRef<string | null>(null);
  useLayoutEffect(() => {
    const lastTurnId = lastMinimalTurn?.id ?? null;
    const needsHandling =
      lastMinimalTurn !== null &&
      isLastMinimalTurnActive &&
      handledTurnIdRef.current !== lastTurnId;
    if (!needsHandling) return;
    handledTurnIdRef.current = lastTurnId;
    if (isMinimal) {
      pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
      autoScrollRef.current = false;
      // Set an initial spacer — the RO's pinned case will refine it to
      // the exact value on the next layout, but we need SOME space now so
      // the browser doesn't clamp scrollTop before the RO fires.
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
      }
    } else {
      // The virtualizer's followOnAppend covers this when the viewport is
      // already at the end; jump explicitly so sending a message also
      // follows the reply when the user had scrolled up.
      autoScrollRef.current = true;
      const container = containerRef.current;
      if (container) {
        container.scrollTop = container.scrollHeight;
      }
    }
  }, [containerRef, isLastMinimalTurnActive, isMinimal, lastMinimalTurn]);

  // While a just-expanded details area settles (one frame: the details mount,
  // the pin padding is re-fit, the viewport rolls to the details bottom), the
  // auto-scroll ResizeObserver must stand down — its scrollToBottom would
  // otherwise fight the roll (it targets the old bottom, computed while the
  // padding is still in place) and leave the viewport wherever it clamped.
  const expandSettlingRef = useRef(false);

  // Minimal-mode pin observers + wheel handler.
  //
  // The rows-wrapper ResizeObserver pins synchronously after layout but
  // before paint, so the pinned scroll position is what gets painted — the
  // only timing that avoids visible jitter during fast streaming in minimal
  // mode. It drives ONLY the minimal pin phases: in normal (virtualized)
  // mode the virtualizer's anchorTo: 'end' correction owns bottom-follow
  // (its per-item observers run in the same frame with the same target),
  // and a second writer here would just fight it.
  //
  // - rowsWrapperRo: any minimal-mode content grows (streaming text, details
  //   expanding) — pinned/following phases re-glue here.
  // - containerRo: the container itself resizes. In minimal mode this re-runs
  //   the pin; in normal mode a viewport shrink (e.g. StreamingQueue appears)
  //   must re-pin to the bottom ourselves — the virtualizer only corrects on
  //   item re-measures, not on viewport rect changes — so while auto-follow
  //   is engaged we snap to the bottom here.
  // Re-created on view-mode switch: minimal mode attaches rowsWrapperRef to a
  // different element, so the observers must re-bind.
  // Re-glues the pinned turn's top edge to the viewport top.
  const pinTopToViewport = useCallback(() => {
    const pin = pinRef.current;
    if (pin.phase === 'idle' || pin.phase === 'ending') return;
    const container = containerRef.current;
    if (!container) return;
    const turnEl = container.querySelector(`[data-turn-id="${pin.turnId}"]`);
    if (!turnEl) return;
    container.scrollTop =
      turnEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
  }, [containerRef]);

  /** Re-fit the pinned spacer so maxScroll equals the pin position (user
   *  cannot scroll past the turn). Reads the spacer's live DOM height since
   *  state may lag behind the last commit; skips sub-pixel corrections. */
  function refinePinSpacer(container: HTMLDivElement, turnId: string): void {
    const turnEl = container.querySelector(`[data-turn-id="${turnId}"]`);
    if (!turnEl) return;
    const pinPosition =
      turnEl.getBoundingClientRect().top -
      container.getBoundingClientRect().top +
      container.scrollTop;
    const spacerEl = container.querySelector('[data-testid="minimal-top-padding"]');
    const actualSpacer = spacerEl ? spacerEl.getBoundingClientRect().height : 0;
    const contentHeight = container.scrollHeight - actualSpacer;
    const ideal = Math.max(0, pinPosition + container.clientHeight - contentHeight);
    if (Math.abs(actualSpacer - ideal) > 1) {
      setTopPaddingPx(ideal);
    }
  }

  useEffect(() => {
    const container = containerRef.current;
    const rowsWrapper = rowsWrapperRef.current;
    if (!container || !rowsWrapper) return;

    function handleResize(): void {
      if (expandSettlingRef.current) return;
      if (!isMinimal) return;
      const pin = pinRef.current;
      switch (pin.phase) {
        case 'pinned': {
          const turnEl = container!.querySelector(`[data-turn-id="${pin.turnId}"]`);
          if (!turnEl) break;
          // Pin turn to viewport top.
          const pinPosition =
            turnEl.getBoundingClientRect().top -
            container!.getBoundingClientRect().top +
            container!.scrollTop;
          container!.scrollTop = pinPosition;
          refinePinSpacer(container!, pin.turnId);
          break;
        }
        case 'following': {
          // Ride the content bottom (spacer excluded).
          if (!autoScrollRef.current) break;
          container!.scrollTop =
            container!.scrollHeight - topPaddingPxRef.current - container!.clientHeight;
          break;
        }
        // 'idle' / 'scrolled' / 'ending': don't touch scrollTop (idle is
        // virtualizer-owned in normal mode; minimal mode has nothing to pin
        // when no turn is active).
      }
    }

    const rowsWrapperRo = new ResizeObserver(handleResize);
    rowsWrapperRo.observe(rowsWrapper);

    const containerRo = new ResizeObserver(() => {
      handleResize();
      // Normal-mode viewport resize: re-pin to the bottom while auto-follow
      // is engaged (see the observer comment above).
      if (!isMinimal && autoScrollRef.current) {
        container!.scrollTop = container!.scrollHeight;
      }
      setContainerWidth(container!.clientWidth);
    });
    containerRo.observe(container);
    setContainerWidth(container.clientWidth);

    function handleWheel(event: WheelEvent): void {
      restoreAnimRef.current?.cancel();
      restoreAnimRef.current = null;
      const pin = pinRef.current;
      if (pin.phase === 'pinned' && event.deltaY < 0) {
        // Only scrolling UP releases the pin (user wants to see history).
        // Scrolling down is blocked by the scroll clamp.
        pinRef.current = { phase: 'scrolled', turnId: pin.turnId };
      } else if (pin.phase === 'following') {
        pinRef.current = { phase: 'scrolled', turnId: pin.turnId };
      }
      if (event.deltaY < 0) {
        autoScrollRef.current = false;
      } else if (event.deltaY > 0 && !autoScrollRef.current && isAtBottom(container!)) {
        autoScrollRef.current = true;
      }
    }

    function handleScroll(): void {
      // While pinned, clamp scrollTop so the user cannot scroll past the
      // turn header — the spacer adjustment is async (React state), so this
      // synchronous clamp covers the gap.
      const pin = pinRef.current;
      if (pin.phase === 'pinned') {
        const turnEl = container!.querySelector(`[data-turn-id="${pin.turnId}"]`);
        if (turnEl) {
          const pinPosition =
            turnEl.getBoundingClientRect().top -
            container!.getBoundingClientRect().top +
            container!.scrollTop;
          if (container!.scrollTop > pinPosition) {
            container!.scrollTop = pinPosition;
          }
        }
      }
      const distanceFromBottom =
        container!.scrollHeight - container!.scrollTop - container!.clientHeight;
      setShowScrollButton(
        distanceFromBottom > container!.clientHeight * SCROLL_BUTTON_VIEWPORT_MULTIPLIER,
      );
    }

    container.addEventListener('wheel', handleWheel, { capture: true, passive: true });
    container.addEventListener('scroll', handleScroll, { passive: true });

    handleResize();

    return () => {
      rowsWrapperRo.disconnect();
      containerRo.disconnect();
      container.removeEventListener('wheel', handleWheel, { capture: true });
      container.removeEventListener('scroll', handleScroll);
    };
  }, [containerRef, isMinimal, rowsWrapperRef]);

  // Save scroll position to store on every scroll event.
  // If user is at the bottom, save sentinel -1 so restore knows to auto-scroll.
  // Mount-time observers can scroll before restoration runs, so saving remains
  // disabled until the current session's initial position has been applied.
  const restoredScrollSessionRef = useRef<string | null>(null);
  useEffect(() => {
    const container = containerRef.current;
    if (!container || !sessionPath) return;

    function savePosition(): void {
      if (restoredScrollSessionRef.current !== sessionPath) return;
      const atBottom = isAtBottom(container!);
      const next = atBottom ? -1 : container!.scrollTop;
      // Skip redundant writes (e.g. staying pinned at the bottom during the
      // terminal open/close animation) so we don't allocate a new Map and
      // re-render store subscribers on every scroll frame.
      if (useAppStore.getState().scrollPositions.get(sessionPath) === next) return;
      useAppStore.getState().setScrollPosition(sessionPath, next);
    }

    container.addEventListener('scroll', savePosition, { passive: true });
    return () => container.removeEventListener('scroll', savePosition);
  }, [containerRef, sessionPath]);

  // Restore saved scroll position on session change, or auto-scroll to bottom.
  // -1 sentinel means user was at bottom → enable auto-scroll so ResizeObserver
  // tracks the true bottom even if content height changed.
  // Guarded to run only on an actual session change: the restore logic reads
  // lastMinimalTurn/isLastMinimalTurnActive, which change on every streaming
  // commit — re-running it there would re-pin and yank the viewport mid-stream.
  const prevSessionPathRef = useRef<string | null>(null);
  useEffect(() => {
    if (prevSessionPathRef.current === sessionPath) return;
    prevSessionPathRef.current = sessionPath;
    restoredScrollSessionRef.current = null;
    // Cancel the previous session's turn-end animation before establishing a
    // new pin. Its cleanup is ownership-checked and cannot clear the new turn.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;

    // Re-pin a still-running minimal turn: switching away and back while a
    // turn executes must keep the working area pinned (padding and all).
    // Resolve the turn itself rather than using the last transcript node:
    // while tools or assistant output stream, that node is not the user node
    // used by data-turn-id.
    if (isMinimal && lastMinimalTurn && isLastMinimalTurnActive) {
      pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
      autoScrollRef.current = false;
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
      }
      // A running turn takes over the viewport: skip the saved-position
      // restore entirely (it would override the re-pin).
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          restoredScrollSessionRef.current = sessionPath;
        }
      });
      return;
    }
    clearTopPin();

    const savedPosition = sessionPath
      ? useAppStore.getState().scrollPositions.get(sessionPath)
      : undefined;

    if (savedPosition === -1) {
      // Was at bottom: let ResizeObserver handle it
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    } else if (savedPosition !== undefined) {
      autoScrollRef.current = false;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          containerRef.current.scrollTop = savedPosition;
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    } else {
      autoScrollRef.current = true;
      requestAnimationFrame(() => {
        if (prevSessionPathRef.current === sessionPath && containerRef.current) {
          // No saved position: land at the bottom like a fresh mount would.
          // The virtualizer only follows on appends/resizes from here on, so
          // the initial position must be written explicitly.
          containerRef.current.scrollTop = containerRef.current.scrollHeight;
          restoredScrollSessionRef.current = sessionPath;
        }
      });
    }
  }, [
    containerRef,
    isLastMinimalTurnActive,
    isMinimal,
    lastMinimalTurn,
    pinTopToViewport,
    sessionPath,
  ]);

  // View-mode switch swaps the content layout entirely, so a pixel scrollTop
  // (and the pin flag) carried over from the other mode is meaningless —
  // re-derive pinning from where the viewport actually landed.
  // Guarded to run only on an actual mode change: on mount the restore effect
  // owns the pin, and deriving here would clobber a restored mid-scroll
  // position (this effect runs after restore but before its rAF applies,
  // while the observer effect's mount-time scrollToBottom still has the
  // container at the bottom → isAtBottom wrongly reads true).
  const prevIsMinimalRef = useRef(isMinimal);
  useLayoutEffect(() => {
    if (prevIsMinimalRef.current === isMinimal) return;
    prevIsMinimalRef.current = isMinimal;
    // A mode switch must not be clobbered by an in-flight restore glide.
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;
    clearTopPin();
    const container = containerRef.current;
    if (!container) return;

    if (isMinimal) {
      if (lastMinimalTurn && isLastMinimalTurnActive) {
        pinRef.current = { phase: 'pinned', turnId: lastMinimalTurn.id };
        autoScrollRef.current = false;
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
        return;
      }
    }

    autoScrollRef.current = isAtBottom(container);
  }, [containerRef, isLastMinimalTurnActive, isMinimal, lastMinimalTurn, pinTopToViewport]);

  function clearTopPin(): void {
    pinRef.current = { phase: 'idle' };
    setTopPaddingPx(0);
  }

  const handleMinimalTurnEnd = useCallback(
    (turnId: string) => {
      const pin = pinRef.current;
      // Pin already released (details expanded, turn ended mid-collapse).
      if (pin.phase === 'idle' || pin.turnId !== turnId) {
        setTopPaddingPx(0);
        return;
      }
      const container = containerRef.current;
      if (!container) {
        clearTopPin();
        return;
      }

      switch (pin.phase) {
        case 'scrolled':
          // User scrolled: their position wins, just drop everything.
          clearTopPin();
          return;

        case 'following': {
          // Viewport was riding content bottom. Drop spacer, stand there.
          const contentBottom =
            container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
          pinRef.current = { phase: 'idle' };
          setTopPaddingPx(0);
          container.scrollTop = contentBottom;
          autoScrollRef.current = true;
          return;
        }

        case 'pinned': {
          // Content still fits viewport. Glide to content bottom.
          const scrollContainer = container;
          pinRef.current = { phase: 'ending', turnId };
          autoScrollRef.current = false;
          const target = Math.max(
            0,
            scrollContainer.scrollHeight - topPaddingPxRef.current - scrollContainer.clientHeight,
          );
          // Use native smooth scroll (compositor-driven, jank-free).
          scrollContainer.scrollTo({ top: target, behavior: 'smooth' });
          // Clean up when the smooth scroll finishes or when user input
          // interrupts it. Cancellation preserves the user's current position
          // and disables auto-follow, but must still release ending + spacer.
          function finish(shouldAutoScroll: boolean): void {
            scrollContainer.removeEventListener('scrollend', onEnd);
            if (restoreAnimRef.current?.cancel === cancel) {
              restoreAnimRef.current = null;
            }
            if (pinRef.current.phase !== 'ending' || pinRef.current.turnId !== turnId) {
              return;
            }
            pinRef.current = { phase: 'idle' };
            setTopPaddingPx(0);
            autoScrollRef.current = shouldAutoScroll;
          }
          function onEnd(): void {
            finish(true);
          }
          function cancel(): void {
            finish(false);
          }
          scrollContainer.addEventListener('scrollend', onEnd, { once: true });
          restoreAnimRef.current = { cancel };
          return;
        }
      }
    },
    [containerRef],
  );

  function handleScrollToBottom(): void {
    const container = containerRef.current;
    if (!container) return;
    clearTopPin();
    autoScrollRef.current = true;
    container.scrollTop = container.scrollHeight;
    setShowScrollButton(false);
  }

  const releaseAutoScrollPin = useCallback((isActive: boolean) => {
    const pin = pinRef.current;
    if (pin.phase !== 'idle') {
      lastPinnedTurnIdRef.current = pin.turnId;
    }
    restoreAnimRef.current?.cancel();
    restoreAnimRef.current = null;

    if (isActive) {
      // Preserve pinned/following/scrolled so expanded details use the same
      // fill-then-follow behavior as normal streaming output.
      return;
    }

    // Finished turn: release the pin and drop the spacer after commit.
    autoScrollRef.current = false;
    pinRef.current = { phase: 'idle' };
    expandSettlingRef.current = true;
    requestAnimationFrame(() => {
      expandSettlingRef.current = false;
      setTopPaddingPx(0);
    });
  }, []);

  // Content growth handler: transitions pinned → following when the turn's
  // content exceeds the viewport, then rides the content bottom.
  const handleOutputGrowth = useCallback(
    (sectionHeight: number) => {
      const container = containerRef.current;
      if (!container) return;
      const pin = pinRef.current;
      if (pin.phase !== 'pinned' && pin.phase !== 'following') return;
      const exceedsViewport = sectionHeight > container.clientHeight;
      if (exceedsViewport) {
        // Transition pinned → following: content outgrew the viewport.
        // Drop the spacer (no longer needed) and ride content bottom.
        if (pin.phase === 'pinned') {
          pinRef.current = { phase: 'following', turnId: pin.turnId };
          autoScrollRef.current = true;
          setTopPaddingPx(0);
        }
        const contentBottom =
          container.scrollHeight - topPaddingPxRef.current - container.clientHeight;
        container.scrollTop = contentBottom;
      } else if (pin.phase === 'pinned') {
        // Content still fits viewport: size the spacer so maxScroll exactly
        // equals the pinned position (user cannot scroll past the turn).
        refinePinSpacer(container, pin.turnId);
      }
    },
    [containerRef],
  );

  const handleCollapseChange = useCallback((isCollapsing: boolean) => {
    // The collapse animation owns the viewport for its whole duration:
    // stand the auto-scroll ResizeObserver down and drop the auto-scroll
    // flag (the commit that starts the animation would otherwise scroll the
    // viewport to the bottom, then the fold would fight it). On end, let
    // the observer resume next frame (after the collapsed layout has
    // committed, so its mount cannot fight the animation).
    if (isCollapsing) {
      expandSettlingRef.current = true;
      autoScrollRef.current = false;
    } else {
      requestAnimationFrame(() => {
        expandSettlingRef.current = false;
      });
    }
  }, []);

  // Re-pin on collapse of active turn's details.
  const handleCollapseDetails = useCallback(
    (isActive: boolean) => {
      if (!isActive) return;
      const turnId = lastPinnedTurnIdRef.current;
      if (!turnId) return;
      pinRef.current = { phase: 'pinned', turnId };
      autoScrollRef.current = false;
      const container = containerRef.current;
      if (container) {
        setTopPaddingPx(container.clientHeight);
        pinTopToViewport();
      }
    },
    [containerRef, pinTopToViewport],
  );

  /** Disables bottom auto-follow (search jump, minimap jump, group toggle...). */
  const suspendAutoScroll = useCallback(() => {
    autoScrollRef.current = false;
  }, []);

  return {
    topPaddingPx,
    showScrollButton,
    containerWidth,
    suspendAutoScroll,
    handleScrollToBottom,
    handleMinimalTurnEnd,
    releaseAutoScrollPin,
    handleOutputGrowth,
    handleCollapseChange,
    handleCollapseDetails,
  };
}
