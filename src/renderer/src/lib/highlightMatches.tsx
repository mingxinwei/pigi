import React, { useEffect, useRef } from 'react';

/**
 * Highlight case-insensitive query matches in plain text.
 * Returns React nodes with matches wrapped in <mark>.
 */
export function highlightMatches(text: string, query: string): React.ReactNode {
  if (!query.trim() || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    nodes.push(
      <mark key={key++} className="rounded-sm bg-amber-300/70 text-foreground">
        {text.slice(index, index + query.length)}
      </mark>,
    );
    cursor = index + query.length;
  }
  return nodes.length > 0 ? nodes : text;
}

const HIGHLIGHT_NAME = 'pi-search-highlights';

function findRangesInContainer(container: HTMLElement, query: string): Range[] {
  const ranges: Range[] = [];
  const lowerQuery = query.toLowerCase();

  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent?.closest('button,input,textarea,select,[contenteditable]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });

  while (walker.nextNode()) {
    const textNode = walker.currentNode as Text;
    const text = textNode.textContent || '';
    const lowerText = text.toLowerCase();
    let start = 0;

    while (start < text.length) {
      const index = lowerText.indexOf(lowerQuery, start);
      if (index === -1) break;
      const range = new Range();
      range.setStart(textNode, index);
      range.setEnd(textNode, index + query.length);
      ranges.push(range);
      start = index + query.length;
    }
  }

  return ranges;
}

/**
 * Hook that uses the CSS Custom Highlights API to highlight query matches
 * across all text content inside a container. Multiple instances share the
 * same highlight registry — each adds its own ranges without overwriting
 * others. Falls back to a no-op if the API is unavailable.
 */
export function useHighlightTextNodes(
  containerRef: React.RefObject<HTMLElement | null>,
  query: string,
): void {
  // Track ranges owned by this hook instance so we can remove them on cleanup
  const ownedRangesRef = useRef<Range[]>([]);
  const observerRef = useRef<MutationObserver | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const trimmed = query.trim();
    const available = typeof CSS !== 'undefined' && 'highlights' in CSS;

    // Remove this instance's old ranges from the shared highlight
    if (available && ownedRangesRef.current.length > 0) {
      const existing = CSS.highlights.get(HIGHLIGHT_NAME);
      if (existing) {
        for (const range of ownedRangesRef.current) {
          existing.delete(range);
        }
      }
      ownedRangesRef.current = [];
    }

    if (!trimmed || !available) return;

    const apply = (): void => {
      // Remove previous ranges
      const existing = CSS.highlights.get(HIGHLIGHT_NAME);
      if (existing) {
        for (const range of ownedRangesRef.current) {
          existing.delete(range);
        }
      }

      // Find new ranges
      const ranges = findRangesInContainer(container, trimmed);
      ownedRangesRef.current = ranges;

      if (ranges.length === 0) return;

      // Add to shared highlight, creating it if needed
      let highlight = CSS.highlights.get(HIGHLIGHT_NAME);
      if (!highlight) {
        highlight = new Highlight();
        CSS.highlights.set(HIGHLIGHT_NAME, highlight);
      }
      for (const range of ranges) {
        highlight.add(range);
      }
    };

    apply();

    observerRef.current = new MutationObserver(() => apply());
    observerRef.current.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observerRef.current?.disconnect();
      // Remove this instance's ranges
      if (available) {
        const existing = CSS.highlights.get(HIGHLIGHT_NAME);
        if (existing) {
          for (const range of ownedRangesRef.current) {
            existing.delete(range);
          }
        }
        ownedRangesRef.current = [];
      }
    };
  }, [containerRef, query]);
}
