import { createContext, memo, useContext, type ReactNode } from 'react';
import { IconCheck, IconCopy } from '@tabler/icons-react';
import Markdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import SyntaxHighlightedCode from './syntaxHighlightedCode';
import { useCopyFeedback } from '../hooks/useCopyFeedback';

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
const IsInCodeBlockContext = createContext(false);

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
  // react-markdown gives the code element no way to tell block code from
  // inline code, so the pre override broadcasts it via context.
  pre: ({ children }) => (
    <IsInCodeBlockContext.Provider value={true}>
      <pre>{children}</pre>
    </IsInCodeBlockContext.Provider>
  ),
  code: MarkdownCode,
};

function MarkdownCode({
  className,
  children,
}: {
  className?: string;
  children?: ReactNode;
}): React.JSX.Element {
  const isCodeBlock = useContext(IsInCodeBlockContext);
  if (!isCodeBlock) {
    return <code className={className}>{children}</code>;
  }

  const language = getCodeLanguage(className);
  const code = getCodeText(children);
  if (language) {
    return (
      <>
        <span className="markdown-code-header" data-search-ignore>
          <span className="markdown-code-label">{getCodeLanguageLabel(language)}</span>
          <CodeCopyButton code={code} />
        </span>
        <SyntaxHighlightedCode code={code} language={language} />
      </>
    );
  }

  return (
    <>
      <CodeCopyButton code={code} overlay />
      <code className={className}>{children}</code>
    </>
  );
}

function CodeCopyButton({
  code,
  overlay = false,
}: {
  code: string;
  /** Float over the code in the corner instead of sitting in a header row. */
  overlay?: boolean;
}): React.JSX.Element {
  const { copied, copy } = useCopyFeedback(code);

  return (
    <button
      type="button"
      className={
        overlay
          ? 'markdown-code-copy-button markdown-code-copy-button-overlay'
          : 'markdown-code-copy-button'
      }
      onClick={copy}
      title="Copy code"
    >
      {copied ? <IconCheck size={14} /> : <IconCopy size={14} />}
    </button>
  );
}

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
