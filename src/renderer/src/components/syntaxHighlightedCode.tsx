import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import {
  bundledLanguages,
  createHighlighter,
  type BundledLanguage,
  type Highlighter,
} from 'shiki/bundle/web';

interface SyntaxHighlightedCodeProps {
  code: string;
  language: string;
}

interface HighlightedToken {
  content: string;
  color?: string;
  fontStyle?: number;
}

type HighlightedLine = HighlightedToken[];

interface HighlightedState {
  key: string;
  lines: HighlightedLine[] | null;
}

const SHIKI_THEME = 'github-light';
const MAX_HIGHLIGHTED_CODE_LENGTH = 80_000;
const MAX_HIGHLIGHT_CACHE_SIZE = 100;
const MAX_TOKENIZED_LINE_LENGTH = 2_000;
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

export default function SyntaxHighlightedCode({
  code,
  language,
}: SyntaxHighlightedCodeProps): React.JSX.Element {
  const normalizedLanguage = useMemo(() => normalizeLanguage(language), [language]);
  const currentHighlightKey = useMemo(
    () => (normalizedLanguage ? highlightedStateKey(code, normalizedLanguage) : null),
    [code, normalizedLanguage],
  );
  const [highlightedState, setHighlightedState] = useState<HighlightedState | null>(null);
  const highlightedLines =
    currentHighlightKey && highlightedState?.key === currentHighlightKey
      ? highlightedState.lines
      : null;

  useEffect(() => {
    let cancelled = false;

    if (!normalizedLanguage || !currentHighlightKey) {
      return () => {
        cancelled = true;
      };
    }

    void cacheHighlightedCode(code, normalizedLanguage)
      .then((lines) => {
        if (!cancelled) {
          setHighlightedState({ key: currentHighlightKey, lines });
        }
      })
      .catch(() => {
        if (!cancelled) {
          setHighlightedState({ key: currentHighlightKey, lines: null });
        }
      });

    return () => {
      cancelled = true;
    };
  }, [code, currentHighlightKey, normalizedLanguage]);

  if (!highlightedLines) {
    return <code className="bg-transparent p-0 font-mono text-[14px]">{code}</code>;
  }

  return (
    <code className="bg-transparent p-0 font-mono text-[14px]">
      {highlightedLines.map((line, lineIndex) => (
        <span key={lineIndex} className="block min-h-5">
          {line.map((token, tokenIndex) => (
            <span key={tokenIndex} style={tokenStyle(token)}>
              {token.content}
            </span>
          ))}
        </span>
      ))}
    </code>
  );
}
