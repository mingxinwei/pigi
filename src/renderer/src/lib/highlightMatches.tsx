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
  const lowerQuery = query.toLowerCase();

  // Collect all text nodes with their accumulated offsets
  interface Entry {
    node: Text;
    offset: number;
  }
  const entries: Entry[] = [];
  let totalOffset = 0;

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
    entries.push({ node: textNode, offset: totalOffset });
    totalOffset += textNode.textContent?.length ?? 0;
  }

  if (entries.length === 0) return [];

  // Build concatenated text and find all match positions
  const fullText = entries.map((e) => e.node.textContent ?? '').join('');
  const lowerFull = fullText.toLowerCase();

  const ranges: Range[] = [];
  let searchPos = 0;

  while (searchPos < fullText.length) {
    const matchStart = lowerFull.indexOf(lowerQuery, searchPos);
    if (matchStart === -1) break;

    // Map concatenated position back to text nodes
    let remaining = query.length;
    let pos = matchStart;

    for (const entry of entries) {
      const nodeLen = entry.node.textContent?.length ?? 0;
      if (pos + remaining <= entry.offset) break;
      if (pos >= entry.offset + nodeLen) continue;

      const localStart = Math.max(0, pos - entry.offset);
      const localEnd = Math.min(nodeLen, pos + remaining - entry.offset);

      const range = new Range();
      range.setStart(entry.node, localStart);
      range.setEnd(entry.node, localEnd);
      ranges.push(range);

      const taken = localEnd - localStart;
      remaining -= taken;
      pos += taken;
      if (remaining <= 0) break;
    }

    searchPos = matchStart + query.length;
    if (remaining > 0) searchPos = matchStart + 1; // safety: partial match at end, advance by 1
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
          try {
            existing.delete(range);
          } catch {
            /* detached */
          }
        }
      }
      ownedRangesRef.current = [];
    }

    if (!trimmed || !available) return;

    const apply = (): void => {
      // Remove previous ranges (ignore errors from detached text nodes)
      const existing = CSS.highlights.get(HIGHLIGHT_NAME);
      if (existing) {
        for (const range of ownedRangesRef.current) {
          try {
            existing.delete(range);
          } catch {
            /* text node detached by async render */
          }
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

    observerRef.current = new MutationObserver(() => {
      // Defer to next frame so Shiki async render has completed
      requestAnimationFrame(() => apply());
    });
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
            try {
              existing.delete(range);
            } catch {
              /* detached */
            }
          }
        }
        ownedRangesRef.current = [];
      }
    };
  }, [containerRef, query]);
}
