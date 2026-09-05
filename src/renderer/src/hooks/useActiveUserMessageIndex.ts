import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { VirtualItem, Virtualizer } from '@tanstack/react-virtual';
import type { RenderItem } from '../lib/readGrouping';
import type { TranscriptNode } from '../state/transcriptController';

/**
 * Derives the minimap's active user message (the one closest to the viewport
 * center) for both view modes:
 * - Virtualized mode: computed from the virtualizer's measurement cache, so
 *   ALL user messages are considered — not just visible ones — keeping the
 *   last user message highlighted when scrolled to the bottom.
 * - Minimal mode: turns render unvirtualized, so the active index comes from
 *   DOM positions instead of the measurement cache.
 */
interface ActiveUserMessageIndexOptions {
  isMinimal: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  renderItems: RenderItem[];
  /** Transcript-driven re-derivation trigger for minimal mode. */
  displayNodes: TranscriptNode[];
  nodeToDisplayIndex: WeakMap<TranscriptNode, number>;
  virtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Included as a dependency so the index re-derives on scroll. */
  virtualItems: VirtualItem[];
}

export function useActiveUserMessageIndex({
  isMinimal,
  containerRef,
  renderItems,
  displayNodes,
  nodeToDisplayIndex,
  virtualizer,
  virtualItems,
}: ActiveUserMessageIndexOptions): number {
  // Derive active user message from visible virtual items — no scroll listener
  // needed because the virtualizer already triggers re-renders on scroll.
  // Returns a displayNodes index (what the MiniMap uses).
  // Uses measurement cache to check ALL user messages, not just visible ones,
  // so the last user message stays highlighted when scrolled to the bottom.
  const virtualActiveUserMessageIndex = useMemo(() => {
    if (virtualItems.length === 0) return -1;
    // Read the viewport from the virtualizer instance instead of the DOM ref:
    // it mirrors container.scrollTop/clientHeight and keeps this memo pure.
    const scrollOffset =
      virtualizer.scrollOffset ??
      (virtualItems[0].start + virtualItems[virtualItems.length - 1].end) / 2;
    const viewportCenter = scrollOffset + (virtualizer.scrollRect?.height ?? 0) / 2;
    let closestDisplayIndex = -1;
    let closestDistance = Infinity;
    const measurements = virtualizer.measurementsCache;
    for (let renderIndex = 0; renderIndex < renderItems.length; renderIndex++) {
      const item = renderItems[renderIndex];
      if (item.type !== 'node' || item.node.role !== 'user') continue;
      const measurement = measurements[renderIndex];
      if (!measurement) continue;
      const itemCenter = measurement.start + measurement.size / 2;
      const distance = Math.abs(itemCenter - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestDisplayIndex = nodeToDisplayIndex.get(item.node) ?? -1;
      }
    }
    return closestDisplayIndex;
    // virtualItems included as dependency to re-derive on scroll
  }, [virtualItems, renderItems, nodeToDisplayIndex, virtualizer, containerRef]);

  const [minimalActiveUserMessageIndex, setMinimalActiveUserMessageIndex] = useState(-1);

  const updateMinimalActiveUserMessage = useCallback(() => {
    const container = containerRef.current;
    if (!container) return;
    const elements = container.querySelectorAll<HTMLElement>('[data-display-index]');
    const containerRect = container.getBoundingClientRect();
    const viewportCenter = containerRect.top + containerRect.height / 2;
    let closestIndex = -1;
    let closestDistance = Infinity;
    for (const element of elements) {
      const rect = element.getBoundingClientRect();
      const distance = Math.abs(rect.top + rect.height / 2 - viewportCenter);
      if (distance < closestDistance) {
        closestDistance = distance;
        closestIndex = Number(element.dataset.displayIndex);
      }
    }
    setMinimalActiveUserMessageIndex(closestIndex);
  }, [containerRef]);

  // Scroll-driven updates: stable listener, rAF-throttled so a scroll burst
  // (e.g. continuous auto-scroll pinning) costs at most one pass per frame.
  const minimalMinimapRafRef = useRef(0);
  useEffect(() => {
    if (!isMinimal) return;
    const container = containerRef.current;
    if (!container) return;
    function handleScroll(): void {
      cancelAnimationFrame(minimalMinimapRafRef.current);
      minimalMinimapRafRef.current = requestAnimationFrame(updateMinimalActiveUserMessage);
    }
    container.addEventListener('scroll', handleScroll, { passive: true });
    return () => {
      container.removeEventListener('scroll', handleScroll);
      cancelAnimationFrame(minimalMinimapRafRef.current);
    };
  }, [isMinimal, containerRef, updateMinimalActiveUserMessage]);

  // Transcript-driven updates: a new turn mounted or content grew. Routed
  // through the same rAF throttle so a streaming delta burst costs at most
  // one layout pass per frame.
  useEffect(() => {
    if (!isMinimal) return;
    cancelAnimationFrame(minimalMinimapRafRef.current);
    minimalMinimapRafRef.current = requestAnimationFrame(updateMinimalActiveUserMessage);
  }, [isMinimal, displayNodes, updateMinimalActiveUserMessage]);

  return isMinimal ? minimalActiveUserMessageIndex : virtualActiveUserMessageIndex;
}
