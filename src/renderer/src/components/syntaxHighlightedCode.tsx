import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from 'shiki/bundle/full';

interface SyntaxHighlightedCodeProps {
  code: string;
  language: string;
  /**
   * When true, the code is still streaming in. Highlighting is throttled so
   * shiki re-tokenizes at most once per {@link STREAMING_HIGHLIGHT_THROTTLE_MS}
   * instead of on every chunk.
   */
  isStreaming?: boolean;
}

interface HighlightedToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

type HighlightedLine = HighlightedToken[];

interface HighlightedState {
  key: string;
  /** The exact code string these lines were highlighted from. */
  source: string;
  lines: HighlightedLine[] | null;
}

const SHIKI_THEME = 'one-light';
const MAX_HIGHLIGHTED_CODE_LENGTH = 80_000;
const MAX_HIGHLIGHT_CACHE_SIZE = 100;
const MAX_TOKENIZED_LINE_LENGTH = 2_000;
const STREAMING_HIGHLIGHT_THROTTLE_MS = 60;
const TOKENIZE_TIME_LIMIT_MS = 250;
const HIGHLIGHT_STATE_KEY_SEPARATOR = ':';
const FONT_STYLE_ITALIC = 1;
const FONT_STYLE_BOLD = 2;
const FONT_STYLE_UNDERLINE = 4;
const FONT_STYLE_STRIKETHROUGH = 8;

let highlighterPromise: Promise<Highlighter> | null = null;
const loadedLanguages = new Set<BundledLanguage>();
const highlightedCodeCache = new Map<string, Promise<HighlightedLine[] | null>>();

function getHighlighter(): Promise<Highlighter> {
  if (!highlighterPromise) {
    highlighterPromise = createHighlighter({
      themes: [SHIKI_THEME],
      langs: [],
    });
  }

  return highlighterPromise;
}

function isBundledLanguage(language: string): language is BundledLanguage {
  return Object.prototype.hasOwnProperty.call(bundledLanguages, language);
}

function normalizeLanguage(language: string): BundledLanguage | null {
  const normalized = language.trim().toLowerCase();
  if (!normalized || !isBundledLanguage(normalized)) {
    return null;
  }
  return normalized;
}

function tokenStyle(token: HighlightedToken): CSSProperties {
  const style: CSSProperties = {};
  if (token.color) {
    style.color = token.color;
  }
  if (token.fontStyle !== undefined) {
    if (token.fontStyle & FONT_STYLE_ITALIC) {
      style.fontStyle = 'italic';
    }
    if (token.fontStyle & FONT_STYLE_BOLD) {
      style.fontWeight = 600;
    }
    const decorations: string[] = [];
    if (token.fontStyle & FONT_STYLE_UNDERLINE) {
      decorations.push('underline');
    }
    if (token.fontStyle & FONT_STYLE_STRIKETHROUGH) {
      decorations.push('line-through');
    }
    if (decorations.length > 0) {
      style.textDecoration = decorations.join(' ');
    }
  }
  return style;
}

function cacheKey(code: string, language: BundledLanguage): string {
  return `${language}\n${code}`;
}

function highlightedStateKey(code: string, language: BundledLanguage): string {
  return [language, code.length, hashString(code)].join(HIGHLIGHT_STATE_KEY_SEPARATOR);
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = Math.imul(31, hash) + value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}

function cacheHighlightedCode(
  code: string,
  language: BundledLanguage,
): Promise<HighlightedLine[] | null> {
  const key = cacheKey(code, language);
  const cached = highlightedCodeCache.get(key);
  if (cached) {
    return cached;
  }

  const highlighted = highlightCode(code, language);
  highlightedCodeCache.set(key, highlighted);
  if (highlightedCodeCache.size > MAX_HIGHLIGHT_CACHE_SIZE) {
    const oldestKey = highlightedCodeCache.keys().next().value;
    if (oldestKey) {
      highlightedCodeCache.delete(oldestKey);
    }
  }
  return highlighted;
}

async function highlightCode(
  code: string,
  language: BundledLanguage,
): Promise<HighlightedLine[] | null> {
  if (code.length > MAX_HIGHLIGHTED_CODE_LENGTH) {
    return null;
  }

  const highlighter = await getHighlighter();
  if (!loadedLanguages.has(language)) {
    await highlighter.loadLanguage(language);
    loadedLanguages.add(language);
  }

  const result = highlighter.codeToTokens(code, {
    lang: language,
    theme: SHIKI_THEME,
    tokenizeMaxLineLength: MAX_TOKENIZED_LINE_LENGTH,
    tokenizeTimeLimit: TOKENIZE_TIME_LIMIT_MS,
  });

  return result.tokens.map((line) =>
    line.map((token) => ({
      content: token.content,
      color: token.color,
      fontStyle: token.fontStyle,
    })),
  );
}

/**
 * Throttles code updates so a downstream (expensive) computation runs at most
 * once per interval while streaming. Passes the value through immediately when
 * not streaming, and flushes the latest value once streaming stops.
 */
function useStreamingThrottledCode(code: string, isStreaming: boolean, intervalMs: number): string {
  const [throttledCode, setThrottledCode] = useState(code);
  const latestCodeRef = useRef(code);
  const lastEmitAtRef = useRef(0);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // Refs are written here (in an effect), never during render.
    latestCodeRef.current = code;
    if (!isStreaming) {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
      return;
    }
    // Trailing throttle: coalesce bursts into at most one emit per interval.
    // setState runs only inside the timer (async), never synchronously here.
    if (timerRef.current === null) {
      const wait = Math.max(0, intervalMs - (Date.now() - lastEmitAtRef.current));
      timerRef.current = setTimeout(() => {
        timerRef.current = null;
        lastEmitAtRef.current = Date.now();
        setThrottledCode(latestCodeRef.current);
      }, wait);
    }
  }, [code, isStreaming, intervalMs]);

  useEffect(
    () => () => {
      if (timerRef.current !== null) clearTimeout(timerRef.current);
    },
    [],
  );

  // While streaming, return the throttled value; otherwise pass the latest
  // through immediately so the final content highlights without delay.
  return isStreaming ? throttledCode : code;
}

export default function SyntaxHighlightedCode({
  code,
  language,
  isStreaming = false,
}: SyntaxHighlightedCodeProps): React.JSX.Element {
  const normalizedLanguage = useMemo(() => normalizeLanguage(language), [language]);
  const highlightInput = useStreamingThrottledCode(
    code,
    isStreaming,
    STREAMING_HIGHLIGHT_THROTTLE_MS,
  );
  const currentHighlightKey = useMemo(
    () => (normalizedLanguage ? highlightedStateKey(highlightInput, normalizedLanguage) : null),
    [highlightInput, normalizedLanguage],
  );
  const [highlightedState, setHighlightedState] = useState<HighlightedState | null>(null);
  // Stale-while-revalidate: keep the last successful highlight on screen while
  // the next one computes, so streaming updates never flash back to plain text.
  const highlightedLines = highlightedState?.lines ?? null;

  useEffect(() => {
    let cancelled = false;

    if (!normalizedLanguage || !currentHighlightKey) {
      return () => {
        cancelled = true;
      };
    }

    void cacheHighlightedCode(highlightInput, normalizedLanguage)
      .then((lines) => {
        if (!cancelled) {
          setHighlightedState({ key: currentHighlightKey, source: highlightInput, lines });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedState({ key: currentHighlightKey, source: highlightInput, lines: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [highlightInput, currentHighlightKey, normalizedLanguage]);

  if (!highlightedLines) {
    return (
      <code className="block min-w-full w-max bg-transparent p-0 font-mono text-[14px]">
        {code}
      </code>
    );
  }

  // The stale highlight covers `source`; anything the live `code` has appended
  // since then is rendered as a plain tail so the latest content is always
  // visible. It gets highlighted on the next tick. The last highlighted line is
  // moved into the tail too, since streaming may have extended it.
  const source = highlightedState?.source ?? '';
  const isAppendOfSource = code.length > source.length && code.startsWith(source);
  let renderedLines = highlightedLines;
  let plainTail = '';
  if (isAppendOfSource) {
    const lastLineStart = source.lastIndexOf('\n') + 1;
    plainTail = code.slice(lastLineStart);
    renderedLines = highlightedLines.slice(0, highlightedLines.length - 1);
  } else if (code !== source && !code.startsWith(source)) {
    // Content diverged (not a simple append); avoid showing a mismatched
    // highlight and fall back to plain until the next highlight lands.
    return (
      <code className="block min-w-full w-max bg-transparent p-0 font-mono text-[14px]">
        {code}
      </code>
    );
  }

  return (
    <code className="block min-w-full w-max bg-transparent p-0 font-mono text-[14px]">
      {renderedLines.map((line, lineIndex) => (
        <span
          key={lineIndex}
          // Skip layout/paint/raster for lines clipped by the clamp or scrolled
          // out of view; they render lazily when revealed.
          className="block min-h-5 [content-visibility:auto] [contain-intrinsic-size:auto_20px]"
        >
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))}
        </span>
      ))}
      {plainTail !== '' && <span className="block whitespace-pre-wrap">{plainTail}</span>}
    </code>
  );
}
