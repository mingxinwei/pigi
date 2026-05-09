import { useState, useEffect, useRef, useMemo } from 'react';
import { cn } from '../lib/utils';
import type { ToolNode } from '../state/transcriptController';
import { MESSAGE_CONTENT_MAX_WIDTH } from '../lib/layoutConstants';
import SyntaxHighlightedCode from './syntaxHighlightedCode';
import DiffView from './DiffView';
import type { EditEntry } from '../lib/diffUtils';
import ImagePreview from './ImagePreview';

interface ToolBlockProps {
  node: ToolNode;
}

interface ToolCommandParts {
  prefix: string;
  body: string;
}

const STATUS_CONFIG = {
  running: {
    label: 'Running',
    className: 'bg-yellow-50 text-yellow-700',
  },
  success: {
    label: 'Succeeded',
    className: 'bg-green-50 text-green-700',
  },
  error: {
    label: 'Failed',
    className: 'bg-red-50 text-red-700',
  },
  cancelled: {
    label: 'Cancelled',
    className: 'bg-muted/60 text-muted-foreground',
  },
} as const;

function ElapsedTimer(): React.JSX.Element {
  const [elapsed, setElapsed] = useState(0);
  const startRef = useRef(0);

  useEffect(() => {
    startRef.current = Date.now();
    const interval = setInterval(() => {
      setElapsed((Date.now() - startRef.current) / 1000);
    }, 1000);
    return () => clearInterval(interval);
  }, []);

  return <span className="tabular-nums">Elapsed {elapsed.toFixed(1)}s</span>;
}

/** Min height for running tool blocks to reserve space and reduce layout shift */
const TOOL_BLOCK_RUNNING_MIN_HEIGHT = '80px';

/** Max height for tool block content before showing expand button */
const TOOL_BLOCK_MAX_HEIGHT = 300;

/** Tools that stream output while running (shown immediately, not gated on completion) */
const STREAMING_OUTPUT_TOOLS = new Set(['bash', 'read']);

const READ_MORE_LINES_RE = /^\[\d+ more lines in file\. Use offset=\d+ to continue\.\]$/;
const READ_IMAGE_RE = /^Read image file \[(.+)\]$/;

const SECONDS_PER_MILLISECOND = 1 / 1000;

const TOOL_OUTPUT_LANGUAGE_BY_NAME: Record<string, string> = {
  bash: 'bash',
};

const FILE_EXTENSION_LANGUAGE_MAP: Record<string, string> = {
  c: 'c',
  cc: 'cpp',
  cjs: 'javascript',
  cpp: 'cpp',
  css: 'css',
  cts: 'typescript',
  h: 'c',
  hpp: 'cpp',
  html: 'html',
  java: 'java',
  js: 'javascript',
  json: 'json',
  jsonc: 'jsonc',
  jsx: 'jsx',
  md: 'markdown',
  mjs: 'javascript',
  mts: 'typescript',
  php: 'php',
  py: 'python',
  scss: 'scss',
  sh: 'bash',
  sql: 'sql',
  ts: 'typescript',
  tsx: 'tsx',
  vue: 'vue',
  xml: 'xml',
  yaml: 'yaml',
  yml: 'yaml',
  zsh: 'zsh',
};

function formatToolArgs(args: unknown): string {
  if (!args || typeof args !== 'object') {
    return '';
  }

  const record = args as Record<string, unknown>;
  if (Object.keys(record).length === 0) {
    return '';
  }

  return JSON.stringify(record, null, 2);
}

function getToolCommandParts(node: ToolNode): ToolCommandParts | null {
  const args = node.args as Record<string, unknown> | undefined;
  if (!args) {
    return null;
  }

  switch (node.name) {
    case 'bash': {
      return { prefix: '$', body: String(args.command ?? '') };
    }
    case 'read':
    case 'write': {
      const path = String(args.path ?? '');
      return path
        ? { prefix: node.name, body: path }
        : { prefix: node.name, body: formatToolArgs(args) };
    }
    case 'edit': {
      const path = String(args.path ?? '');
      return path
        ? { prefix: node.name, body: path }
        : { prefix: node.name, body: formatToolArgs(args) };
    }
    default:
      return { prefix: node.name, body: formatToolArgs(args) };
  }
}

function getToolOutputLanguage(node: ToolNode): string {
  const args = node.args as Record<string, unknown> | undefined;
  const path = typeof args?.path === 'string' ? args.path : '';
  return getLanguageFromPath(path) ?? TOOL_OUTPUT_LANGUAGE_BY_NAME[node.name] ?? 'bash';
}

function getLanguageFromPath(path: string): string | null {
  const fileName = path.split('/').pop() ?? '';
  const extension = fileName.includes('.') ? fileName.split('.').pop()?.toLowerCase() : '';
  if (!extension) {
    return null;
  }

  return FILE_EXTENSION_LANGUAGE_MAP[extension] ?? null;
}

function getEditEntries(node: ToolNode): EditEntry[] | null {
  if (node.name !== 'edit') return null;
  const args = node.args as Record<string, unknown> | undefined;
  if (!args) return null;
  const edits = args.edits as Array<{ oldText?: string; newText?: string }> | undefined;
  if (!Array.isArray(edits) || edits.length === 0) return null;
  return edits
    .filter((e) => typeof e.oldText === 'string' && typeof e.newText === 'string')
    .map((e) => ({ oldText: e.oldText!, newText: e.newText! }));
}

function getWriteEntries(node: ToolNode): EditEntry[] | null {
  if (node.name !== 'write') return null;
  const args = node.args as Record<string, unknown> | undefined;
  const content = typeof args?.content === 'string' ? args.content : null;
  if (!content) return null;
  return [{ oldText: '', newText: content }];
}

function formatDuration(durationMs: number | undefined): string | null {
  if (durationMs === undefined || !Number.isFinite(durationMs)) {
    return null;
  }

  const seconds = Math.max(0.1, durationMs * SECONDS_PER_MILLISECOND);
  const formattedSeconds = seconds < 10 ? seconds.toFixed(1) : Math.round(seconds).toString();
  return `Took ${formattedSeconds}s`;
}

function cleanReadOutput(node: ToolNode): string {
  if (node.name !== 'read') return node.output;
  const lines = node.output.split('\n');
  if (lines[0]?.match(READ_IMAGE_RE)) return '';
  return lines.filter((line) => !READ_MORE_LINES_RE.test(line)).join('\n');
}

function getReadImagePath(node: ToolNode): string | null {
  if (node.name !== 'read') return null;
  const lines = node.output.split('\n');
  if (!lines[0]?.match(READ_IMAGE_RE)) return null;
  const args = node.args as Record<string, unknown> | undefined;
  return typeof args?.path === 'string' ? args.path : null;
}

export default function ToolBlock({ node }: ToolBlockProps): React.JSX.Element {
  const [expanded, setExpanded] = useState(false);
  const contentRef = useRef<HTMLDivElement>(null);
  const [isOverflowing, setIsOverflowing] = useState(false);
  const { className: statusClassName } = STATUS_CONFIG[node.status];
  const command = getToolCommandParts(node);
  const editEntries = getEditEntries(node);
  const writeEntries = getWriteEntries(node);
  const diffEntries = editEntries ?? writeEntries;

  // For read tool: filter hint lines and detect images
  const cleanedOutput = useMemo(() => cleanReadOutput(node), [node]);
  const imagePath = useMemo(() => getReadImagePath(node), [node]);

  const hasOutput = cleanedOutput.length > 0;
  const outputLanguage = getToolOutputLanguage(node);
  const durationLabel = formatDuration(node.durationMs);
  const args = node.args as Record<string, unknown> | undefined;
  const timeout = typeof args?.timeout === 'number' ? args.timeout : undefined;

  useEffect(() => {
    if (!contentRef.current) return;
    setIsOverflowing(contentRef.current.scrollHeight > TOOL_BLOCK_MAX_HEIGHT);
  }, [node]);

  return (
    <>
      <div
        className="overflow-hidden rounded-md border border-border/60 bg-muted/25 px-3 py-2 text-sm text-muted-foreground"
        style={{
          maxWidth: `${MESSAGE_CONTENT_MAX_WIDTH}px`,
          minHeight: node.status === 'running' ? TOOL_BLOCK_RUNNING_MIN_HEIGHT : undefined,
        }}
        data-testid={`tool-block-${node.toolCallId}`}
      >
        {command ? (
          <div className="flex items-start gap-1 rounded bg-background/75 py-1.5 font-mono text-[14px] font-semibold leading-5 text-foreground">
            <span className="shrink-0">{command.prefix}</span>
            <span className="min-w-0 whitespace-pre-wrap break-words [overflow-wrap:anywhere]">
              {command.body}
            </span>
            {timeout !== undefined && (
              <span className="ml-auto shrink-0 text-xs font-normal text-muted-foreground">
                timeout {timeout}s
              </span>
            )}
          </div>
        ) : (
          <div className="flex items-start gap-1 rounded bg-background/75 py-1.5 font-mono text-[14px] font-semibold leading-5 text-foreground">
            <span className="shrink-0">{node.name}</span>
            <span className="min-w-0 text-muted-foreground">…</span>
          </div>
        )}

        <div
          ref={contentRef}
          className="overflow-hidden"
          style={{
            maxHeight: expanded ? undefined : `${TOOL_BLOCK_MAX_HEIGHT}px`,
            maskImage:
              !expanded && isOverflowing
                ? 'linear-gradient(to bottom, black calc(100% - 16px), transparent)'
                : undefined,
            WebkitMaskImage:
              !expanded && isOverflowing
                ? 'linear-gradient(to bottom, black calc(100% - 16px), transparent)'
                : undefined,
          }}
        >
          {node.status !== 'running' &&
            diffEntries &&
            diffEntries.length > 0 &&
            node.status !== 'error' && <DiffView edits={diffEntries} />}

          {(node.status !== 'running' || STREAMING_OUTPUT_TOOLS.has(node.name)) &&
            hasOutput &&
            ((node.name !== 'edit' && node.name !== 'write') || node.status === 'error') && (
              <pre className="mt-2 overflow-hidden whitespace-pre-wrap break-words font-mono text-[14px] leading-5 text-muted-foreground [overflow-wrap:anywhere]">
                <SyntaxHighlightedCode code={cleanedOutput} language={outputLanguage} />
              </pre>
            )}
        </div>

        {isOverflowing && (
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="mt-1 text-left text-xs text-muted-foreground hover:text-foreground"
          >
            {expanded ? 'Show less' : 'Show more'}
          </button>
        )}

        <div
          className={cn(
            '-mx-3 -mb-2 mt-2 flex items-center justify-start gap-1.5 px-3 py-1.5 text-xs',
            statusClassName,
          )}
        >
          {node.status === 'running' ? (
            <ElapsedTimer />
          ) : (
            <>{durationLabel && <span>{durationLabel}</span>}</>
          )}
        </div>
      </div>
      {imagePath && <ImagePreview src={`local-file://${imagePath}`} alt={imagePath} />}
    </>
  );
}
