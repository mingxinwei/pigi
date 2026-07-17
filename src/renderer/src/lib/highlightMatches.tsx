import React, { useEffect, useRef } from 'react';

/**
 * Highlight case-insensitive query matches in plain text.
 * Returns React nodes with matches wrapped in <mark>.
 */
export function highlightMatches(
  text: string,
  query: string,
  activeOccurrenceIndex: number | null = null,
): React.ReactNode {
  if (!query.trim() || !text) return text;
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  const nodes: React.ReactNode[] = [];
  let cursor = 0;
  let key = 0;
  let occurrenceCount = -1;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);
    if (index === -1) {
      nodes.push(text.slice(cursor));
      break;
    }
    if (index > cursor) {
      nodes.push(text.slice(cursor, index));
    }
    occurrenceCount++;
    const isActive = activeOccurrenceIndex !== null && occurrenceCount === activeOccurrenceIndex;
    nodes.push(
      <mark
        key={key++}
        className="rounded-sm text-foreground"
        style={{
          backgroundColor: isActive
            ? 'color-mix(in srgb, var(--system-accent) 70%, transparent)'
            : 'var(--search-highlight-bg)',
        }}
      >
        {text.slice(index, index + query.length)}
      </mark>,
    );
    cursor = index + query.length;
  }
  return nodes.length > 0 ? nodes : text;
}

const HIGHLIGHT_NAME = 'pi-search-highlights';
const ACTIVE_HIGHLIGHT_NAME = 'pi-search-active';

/**
 * Ownership token for the shared ACTIVE highlight registry entry. Only the
 * hook instance that most recently set the active highlight may clear it.
 * Without this, every other instance (virtualized list mounts, mutation
 * observer re-applies) would wipe the entry with its own re-apply, since all
 * instances share the same global CSS.highlights registry.
 */
let activeHighlightOwner: symbol | null = null;

/** Collect text nodes eligible for search highlighting, in tree order. */
function collectSearchableTextNodes(container: HTMLElement): Text[] {
  const nodes: Text[] = [];
  const walker = document.createTreeWalker(container, NodeFilter.SHOW_TEXT, {
    acceptNode(node) {
      const parent = node.parentElement;
      if (parent?.closest('button,input,textarea,select,[contenteditable],[data-search-ignore]')) {
        return NodeFilter.FILTER_REJECT;
      }
      return NodeFilter.FILTER_ACCEPT;
    },
  });
  while (walker.nextNode()) {
    nodes.push(walker.currentNode as Text);
  }
  return nodes;
}

/**
 * Find all case-insensitive, non-overlapping matches of query inside a
 * container. Returns one entry per match; each entry holds one Range per text
 * node the match spans. Splitting is required so that text between the nodes
 * which is not part of the concatenated search text (e.g. inside rejected
 * button subtrees) is not painted as part of the match.
 */
function findMatchesInContainer(container: HTMLElement, query: string): Range[][] {
  const lowerQuery = query.toLowerCase();
  const nodes = collectSearchableTextNodes(container);
  if (nodes.length === 0) return [];

  // Accumulated offsets of each text node in the concatenated search text
  const offsets: number[] = [];
  let totalOffset = 0;
  for (const node of nodes) {
    offsets.push(totalOffset);
    totalOffset += node.textContent?.length ?? 0;
  }

  const fullText = nodes.map((node) => node.textContent ?? '').join('');
  const lowerFull = fullText.toLowerCase();

  const matches: Range[][] = [];
  let searchPos = 0;

  while (searchPos < fullText.length) {
    const matchStart = lowerFull.indexOf(lowerQuery, searchPos);
    if (matchStart === -1) break;

    // Map concatenated position back to text nodes
    let remaining = query.length;
    let pos = matchStart;
    const segments: Range[] = [];

    for (let index = 0; index < nodes.length && remaining > 0; index++) {
      const node = nodes[index];
      const nodeLength = node.textContent?.length ?? 0;
      const nodeStart = offsets[index];
      if (pos >= nodeStart + nodeLength) continue;

      const localStart = Math.max(0, pos - nodeStart);
      const localEnd = Math.min(nodeLength, pos + remaining - nodeStart);
      if (localEnd <= localStart) continue;

      const range = new Range();
      range.setStart(node, localStart);
      range.setEnd(node, localEnd);
      segments.push(range);

      remaining -= localEnd - localStart;
      pos += localEnd - localStart;
    }

    if (segments.length > 0) {
      matches.push(segments);
    }
    searchPos = matchStart + query.length;
  }

  return matches;
}

/**
 * Locate the ranges of one specific occurrence (0-based, tree order) of query
 * inside a container. Uses the same occurrence indexing as
 * useHighlightTextNodes, so scroll targets stay aligned with highlights.
 * Returns null when the occurrence does not exist.
 */
export function findOccurrenceRanges(
  container: HTMLElement,
  query: string,
  occurrenceIndex: number,
): Range[] | null {
  const trimmed = query.trim();
  if (!trimmed || occurrenceIndex < 0) return null;
  return findMatchesInContainer(container, trimmed)[occurrenceIndex] ?? null;
}

/**
 * Hook that uses the CSS Custom Highlights API to highlight query matches
 * across all text content inside a container. Multiple instances share the
 * same highlight registry — each adds its own ranges without overwriting
 * others. The active occurrence highlight is owned: only the instance that
 * set it may replace or clear it. Falls back to a no-op if the API is
 * unavailable.
 */
export function useHighlightTextNodes(
  containerRef: React.RefObject<HTMLElement | null>,
  query: string,
  activeOccurrenceIndex: number | null = null,
): void {
  // Track ranges owned by this hook instance so we can remove them on cleanup
  const ownedRangesRef = useRef<Range[]>([]);
  const ownerTokenRef = useRef<symbol | null>(null);
  if (ownerTokenRef.current === null) {
    ownerTokenRef.current = Symbol('search-active-highlight-owner');
  }

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    const trimmed = query.trim();
    const available = typeof CSS !== 'undefined' && 'highlights' in CSS;
    const ownerToken = ownerTokenRef.current;

    // Remove this instance's ranges from the shared highlight
    const removeOwnedRanges = (): void => {
      if (!available) return;
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
      ownedRangesRef.current = [];
    };

    // Clear the shared active highlight, but only if this instance owns it
    const releaseActiveIfOwner = (): void => {
      if (!available || activeHighlightOwner !== ownerToken) return;
      activeHighlightOwner = null;
      try {
        CSS.highlights.delete(ACTIVE_HIGHLIGHT_NAME);
      } catch {
        /* CSS.highlights not supported */
      }
    };

    const apply = (): void => {
      removeOwnedRanges();

      if (!trimmed || !available) {
        releaseActiveIfOwner();
        return;
      }

      const matches = findMatchesInContainer(container, trimmed);
      const ranges = matches.flat();
      ownedRangesRef.current = ranges;

      if (ranges.length > 0) {
        // Add to shared highlight, creating it if needed
        let highlight = CSS.highlights.get(HIGHLIGHT_NAME);
        if (!highlight) {
          highlight = new Highlight();
          CSS.highlights.set(HIGHLIGHT_NAME, highlight);
        }
        for (const range of ranges) {
          highlight.add(range);
        }
      }

      // Apply active occurrence highlight and take ownership
      const activeSegments =
        activeOccurrenceIndex !== null && activeOccurrenceIndex >= 0
          ? matches[activeOccurrenceIndex]
          : undefined;
      if (activeSegments) {
        CSS.highlights.set(ACTIVE_HIGHLIGHT_NAME, new Highlight(...activeSegments));
        activeHighlightOwner = ownerToken;
      } else {
        releaseActiveIfOwner();
      }
    };

    apply();

    const observer = new MutationObserver((mutations) => {
      // Skip mutations inside ignored chrome (e.g. status footers with
      // ticking timers) — they cannot change the searchable text.
      const onlyIgnored = mutations.every((mutation) => {
        const target = mutation.target;
        const element = target instanceof Element ? target : target.parentElement;
        return element?.closest('[data-search-ignore]') != null;
      });
      if (onlyIgnored) return;
      // Defer to next frame so Shiki async render has completed
      requestAnimationFrame(() => apply());
    });
    observer.observe(container, {
      childList: true,
      subtree: true,
      characterData: true,
    });

    return () => {
      observer.disconnect();
      removeOwnedRanges();
      releaseActiveIfOwner();
    };
  }, [containerRef, query, activeOccurrenceIndex]);
}
