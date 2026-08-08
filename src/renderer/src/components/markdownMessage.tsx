import { memo, type ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import SyntaxHighlightedCode from './syntaxHighlightedCode';

interface MarkdownMessageProps {
  text: string;
}

const LANGUAGE_CLASS_PREFIX = 'language-';
const CODE_LANGUAGE_LABELS: Record<string, string> = {
  bash: 'Bash',
  css: 'CSS',
  html: 'HTML',
  javascript: 'JavaScript',
  js: 'JavaScript',
  json: 'JSON',
  jsx: 'JSX',
  markdown: 'Markdown',
  md: 'Markdown',
  python: 'Python',
  py: 'Python',
  sh: 'Shell',
  shell: 'Shell',
  shellscript: 'Shell',
  ts: 'TypeScript',
  tsx: 'TSX',
  typescript: 'TypeScript',
  xml: 'XML',
  yaml: 'YAML',
  yml: 'YAML',
};

// Only elements needing behavior or structure get an override; all typographic
// styling lives in the `.markdown-body` rules in main.css.
const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        if (href) window.piApi.openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  // Scroll wrapper so wide tables overflow horizontally instead of
  // stretching the message layout.
  table: ({ children }) => (
    <div className="markdown-table-wrapper">
      <table>{children}</table>
    </div>
  ),
  code: ({ className, children }) => {
    const language = getCodeLanguage(className);
    const code = getCodeText(children);
    if (language) {
      return (
        <>
          <span className="markdown-code-label" data-search-ignore>
            {getCodeLanguageLabel(language)}
          </span>
          <SyntaxHighlightedCode code={code} language={language} />
        </>
      );
    }

    return <code className={className}>{children}</code>;
  },
};

function getCodeLanguage(className: string | undefined): string | null {
  const languageClass = className
    ?.split(/\s+/)
    .find((item) => item.startsWith(LANGUAGE_CLASS_PREFIX));
  return languageClass?.slice(LANGUAGE_CLASS_PREFIX.length) ?? null;
}

function getCodeText(children: ReactNode): string {
  return String(children).replace(/\n$/, '');
}

function getCodeLanguageLabel(language: string): string {
  const normalizedLanguage = language.toLowerCase();
  return CODE_LANGUAGE_LABELS[normalizedLanguage] ?? language;
}

// Memoized: the remark/rehype pipeline is expensive, and callers (minimal
// view turns, message rows) re-render for unrelated reasons like scroll
// tracking or timer ticks — the text prop is a stable string in those cases.
export default memo(function MarkdownMessage({ text }: MarkdownMessageProps): React.JSX.Element {
  return (
    <div className="markdown-body">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
      >
        {text}
      </Markdown>
    </div>
  );
});
