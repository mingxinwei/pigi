import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { RefObject } from 'react';
import type { Virtualizer } from '@tanstack/react-virtual';
import type { RenderItem } from '../lib/readGrouping';
import type { OccurrenceResult } from '../components/MessageSearch';
import { buildSearchTargets } from '../components/messageSearchTargets';
import { findOccurrenceRanges } from '../lib/highlightMatches';

/**
 * Owns the in-message search feature: query/open/occurrence state, search
 * target building, the Cmd/Ctrl+F entry point, jump handling (including
 * auto-expanding overflow-hidden tool content around a match), and scrolling
 * the active occurrence into view.
 *
 * Not search-owned: `searchQuery` and `activeOccurrenceInfo` are consumed by
 * row rendering for match highlighting, so they are returned to the caller
 * and threaded into row props there. Group expansion state likewise stays
 * with the caller — the hook only requests expansions through `expandGroup`.
 */

export interface ActiveOccurrenceInfo {
  itemId: string;
  toolNodeId: string | null;
  occurrenceIndex: number;
}

interface MessageSearchControllerOptions {
  isMinimal: boolean;
  containerRef: RefObject<HTMLDivElement | null>;
  rowVirtualizer: Virtualizer<HTMLDivElement, Element>;
  /** Suspends bottom auto-follow before jumping (from the scroll controller). */
  suspendAutoScroll: () => void;
  renderItems: RenderItem[];
  /** Expands a collapsed read group so a match inside it becomes reachable. */
  expandGroup: (groupId: string) => void;
}

export interface MessageSearchController {
  searchOpen: boolean;
  setSearchOpen: (open: boolean | ((prev: boolean) => boolean)) => void;
  searchRefocus: number;
  searchQuery: string;
  setSearchQuery: (query: string | ((prev: string) => string)) => void;
  searchTargets: ReturnType<typeof buildSearchTargets>;
  activeOccurrenceInfo: ActiveOccurrenceInfo | null;
  handleSearchJump: (result: OccurrenceResult) => void;
}

export function useMessageSearchController({
  isMinimal,
  containerRef,
  rowVirtualizer,
  suspendAutoScroll,
  renderItems,
  expandGroup,
}: MessageSearchControllerOptions): MessageSearchController {
  const [searchOpen, setSearchOpen] = useState(false);
  const [searchRefocus, setSearchRefocus] = useState(0);
  const [searchQuery, setSearchQuery] = useState('');
  // Always reflects latest searchQuery so expandIfHidden's deferred callback
  // doesn't read a stale closure value if the query changed in the meantime.
  // Updated in an effect (not during render); the deferred callbacks that
  // read it run 100ms+ later, long after effects have flushed.
  const searchQueryRef = useRef(searchQuery);
  useEffect(() => {
    searchQueryRef.current = searchQuery;
  }, [searchQuery]);
  const [activeOccurrenceInfo, setActiveOccurrenceInfo] = useState<ActiveOccurrenceInfo | null>(
    null,
  );

  // Targets are only needed while the search UI is open: gating on searchOpen
  // keeps streaming commits (renderItems changes every delta) from rebuilding
  // the full-target list when nobody is searching.
  const searchTargets = useMemo(() => {
    if (isMinimal || !searchOpen) return [];
    return buildSearchTargets(renderItems);
  }, [renderItems, isMinimal, searchOpen]);

  // Search is unavailable in minimal mode; drop any stale search state so it
  // doesn't resurface with outdated targets when switching back. Adjusted
  // during render (documented prop-change pattern) rather than in an effect,
  // so no cascading render is needed.
  const [prevIsMinimal, setPrevIsMinimal] = useState(isMinimal);
  if (prevIsMinimal !== isMinimal) {
    setPrevIsMinimal(isMinimal);
    if (isMinimal) {
      setSearchOpen(false);
      setSearchQuery('');
      setActiveOccurrenceInfo(null);
    }
  }

  const handleSearchJump = useCallback(
    (result: OccurrenceResult): void => {
      const target = result.target;
      suspendAutoScroll();
      if (target.groupId) {
        expandGroup(target.groupId);
      }
      rowVirtualizer.scrollToIndex(target.renderIndex, { align: 'start', behavior: 'auto' });
      setActiveOccurrenceInfo({
        itemId: target.itemId,
        toolNodeId: target.toolNodeId ?? null,
        occurrenceIndex: result.occurrenceIndex,
      });

      // Auto-expand overflow-hidden tool content when a match is inside
      if (target.role === 'tool') {
        const expandIfHidden = (): void => {
          const container = containerRef.current;
          if (!container) return;
          const toolSelector = target.toolNodeId
            ? `[data-tool-node-id="${target.toolNodeId}"]`
            : `[data-index="${target.renderIndex}"]`;
          const root = container.querySelector(toolSelector);
          if (!(root instanceof HTMLElement)) return;

          const overflowEl = root.querySelector<HTMLElement>('[style*="max-height"]');
          if (!overflowEl) return;

          // Read from ref to avoid stale closure if query changed after this
          // deferred callback was scheduled.
          const query = searchQueryRef.current.trim();
          if (!query) return;
          const segments = findOccurrenceRanges(root, query, result.occurrenceIndex);
          if (!segments || segments.length === 0) return;

          // Check if the match is fully visible (both ends within the overflow container).
          // Content is tail-anchored (overflow clipped at the TOP), so we check
          // the first segment's top and the last segment's bottom.
          const firstSegment = segments[0];
          const lastSegment = segments[segments.length - 1];
          const firstRect = firstSegment.getBoundingClientRect();
          const lastRect = lastSegment.getBoundingClientRect();
          const overflowRect = overflowEl.getBoundingClientRect();
          if (firstRect.top >= overflowRect.top && lastRect.bottom <= overflowRect.bottom) return;

          // relies on [data-action="expand-overflow"] on overflow buttons
          const expandButton = root.querySelector<HTMLButtonElement>(
            '[data-action="expand-overflow"]',
          );
          if (!expandButton) return;
          expandButton.click();

          //     After the expand animation, scroll to the matched text
          const scrollToMatch = (): void => {
            const freshSegments = findOccurrenceRanges(root, query, result.occurrenceIndex);
            const firstSegment = freshSegments?.[0];
            if (!firstSegment || !container) return;
            const rect = firstSegment.getBoundingClientRect();
            const containerRect = container.getBoundingClientRect();
            container.scrollTo({
              top: container.scrollTop + rect.top - containerRect.top - containerRect.height / 2,
              behavior: 'auto',
            });
          };
          requestAnimationFrame(() => requestAnimationFrame(scrollToMatch));
        };
        // Delay for scroll + expand animations to settle, then check
        requestAnimationFrame(() => setTimeout(expandIfHidden, 100));
      }
    },
    [rowVirtualizer, containerRef, suspendAutoScroll, expandGroup],
  );

  // Scroll to active occurrence within the message
  useEffect(() => {
    if (!activeOccurrenceInfo) return;
    const container = containerRef.current;
    if (!container) return;
    const query = searchQuery.trim();
    if (!query) return;

    requestAnimationFrame(() => {
      const itemEl = container.querySelector(
        `[data-item-id="${CSS.escape(activeOccurrenceInfo.itemId)}"]`,
      );
      if (!(itemEl instanceof HTMLElement)) return;

      // Scope to the specific tool node when the match is inside a read group
      const scopeEl = activeOccurrenceInfo.toolNodeId
        ? (itemEl.querySelector<HTMLElement>(
            `[data-tool-node-id="${CSS.escape(activeOccurrenceInfo.toolNodeId)}"]`,
          ) ?? itemEl)
        : itemEl;

      const segments = findOccurrenceRanges(scopeEl, query, activeOccurrenceInfo.occurrenceIndex);
      const firstSegment = segments?.[0];
      if (!firstSegment) return;

      const rect = firstSegment.getBoundingClientRect();
      const containerRect = container.getBoundingClientRect();
      container.scrollTo({
        top: container.scrollTop + rect.top - containerRect.top - containerRect.height / 2,
        behavior: 'auto',
      });
    });
  }, [activeOccurrenceInfo, searchQuery, containerRef]);

  // Cmd/Ctrl+F opens search (not supported in minimal mode)
  useEffect(() => {
    function handleKeyDown(event: KeyboardEvent): void {
      if (isMinimal) return;
      if ((event.metaKey || event.ctrlKey) && !event.altKey && event.key.toLowerCase() === 'f') {
        event.preventDefault();
        if (searchOpen) {
          setSearchRefocus((prev) => prev + 1);
        } else {
          setSearchOpen(true);
        }
      }
    }
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [searchOpen, isMinimal]);

  return {
    searchOpen,
    setSearchOpen,
    searchRefocus,
    searchQuery,
    setSearchQuery,
    searchTargets,
    activeOccurrenceInfo,
    handleSearchJump,
  };
}
