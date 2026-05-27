import type { ReactNode } from 'react';
import Markdown, { type Components } from 'react-markdown';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import { cn } from '../lib/utils';
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

const markdownComponents: Components = {
  a: ({ href, children }) => (
    <a
      href={href}
      className="font-medium text-ring no-underline hover:text-ring/80 transition-colors"
      rel="noreferrer"
      onClick={(e) => {
        e.preventDefault();
        if (href) window.piApi.openExternal(href);
      }}
    >
      {children}
    </a>
  ),
  p: ({ children }) => <p className="mb-3 break-words last:mb-0">{children}</p>,
  ul: ({ children }) => <ul className="mb-3 list-disc pl-5 last:mb-0">{children}</ul>,
  ol: ({ children }) => <ol className="mb-3 list-decimal pl-5 last:mb-0">{children}</ol>,
  li: ({ children }) => <li className="pl-1">{children}</li>,
  blockquote: ({ children }) => (
    <blockquote className="mb-3 border-l-2 border-border pl-3 text-muted-foreground last:mb-0">
      {children}
    </blockquote>
  ),
  hr: () => <hr className="my-4 border-border" />,
  h1: ({ children }) => (
    <h1 className="mb-4 text-[26px] font-semibold leading-9 last:mb-0">{children}</h1>
  ),
  h2: ({ children }) => (
    <h2 className="mb-3 text-[19px] font-semibold leading-7 last:mb-0">{children}</h2>
  ),
  h3: ({ children }) => (
    <h3 className="mb-2 text-[17px] font-semibold leading-6 last:mb-0">{children}</h3>
  ),
  pre: ({ children }) => (
    <pre className="mb-3 w-full max-w-full overflow-x-auto rounded-md bg-muted px-3 py-2 font-mono text-[14px] leading-5 text-foreground last:mb-0 [&_code]:bg-transparent [&_code]:p-0">
      {children}
    </pre>
  ),
  code: ({ className, children }) => {
    const language = getCodeLanguage(className);
    const code = getCodeText(children);
    if (language) {
      return (
        <>
          <span className="mb-2 block text-[12px] font-normal text-muted-foreground">
            {getCodeLanguageLabel(language)}
          </span>
          <SyntaxHighlightedCode code={code} language={language} />
        </>
      );
    }

    return (
      <code className={cn('rounded bg-muted px-1 py-0.5 font-mono text-[14px]', className)}>
        {children}
      </code>
    );
  },
  table: ({ children }) => (
    <div className="mb-3 overflow-x-auto last:mb-0">
      <table className="w-full border-collapse text-left text-[14px]">{children}</table>
    </div>
  ),
  th: ({ children }) => (
    <th className="border border-border bg-muted/60 px-2 py-1 font-medium">{children}</th>
  ),
  td: ({ children }) => <td className="border border-border px-2 py-1">{children}</td>,
  strong: ({ children }) => <strong className="font-medium">{children}</strong>,
  img: ({ src, alt, title }) => (
    <img src={src} alt={alt ?? ''} title={title} className="my-3 max-w-full rounded-md" />
  ),
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

export default function MarkdownMessage({ text }: MarkdownMessageProps): React.JSX.Element {
  return (
    <div className="w-full min-w-0 break-words">
      <Markdown
        remarkPlugins={[remarkGfm]}
        rehypePlugins={[rehypeSanitize]}
        components={markdownComponents}
      >
        {text}
      </Markdown>
    </div>
  );
}
